const router = require('express').Router();
const cfg = require('../config');
const { auth, db, FieldValue } = require('../firebase');
const { safeEqual, hmac, newOtp } = require('../utils/crypto');
const { httpErr, clean } = require('../utils/http');
const { COOKIE, BRANCH_COOKIE, cookieOpts, requireRole, activeBranch } = require('../middleware/auth');
const { audited, writeAudit } = require('../middleware/audit');
const rateLimit = require('../middleware/rateLimit');
const { sendMail, templates } = require('../utils/mailer');
const { sendAutomatedWhatsApp } = require('../utils/whatsapp');

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
// Firebase Auth is email-based; usernames are mapped to a synthetic, role-scoped, never-mailed address.
const toEmail = (u, role = 'student') => `${role}__${clean(u).toLowerCase()}@lab-users.scet.invalid`;
const legacyEmail = (u) => `${clean(u).toLowerCase()}@lab-users.scet.invalid`;

const loginLimit = rateLimit({ max: 5, key: (r) => `${r.ip}|${clean(r.body?.username).toLowerCase()}` });
const signupLimit = rateLimit({ max: 10, key: (r) => r.ip });
const forgotLimit = rateLimit({ max: 5, key: (r) => r.ip });

async function createAccount({ username, password, role, profile }) {
  username = clean(username).toLowerCase();
  if (!USERNAME_RE.test(username)) throw httpErr(400, 'Username must be 3-32 characters: letters, digits, dot, dash, underscore.');
  if (typeof password !== 'string' || password.length < 8) throw httpErr(400, 'Password must be at least 8 characters.');
  let rec;
  try {
    rec = await auth.createUser({ email: toEmail(username, role), password, displayName: profile.displayName });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw httpErr(409, `An account with this ${role === 'student' ? 'enrollment number' : 'ID'} already exists.`);
    throw e;
  }
  await auth.setCustomUserClaims(rec.uid, { role, username });
  await db.doc(`users/${rec.uid}`).set({ username, role, ...profile, isActive: true, createdAt: FieldValue.serverTimestamp() });
  return { uid: rec.uid, username, role };
}

/* ---------- Student sign-up: Send Verification OTP ---------- */
router.post('/signup/student/send-otp', signupLimit, async (req, res) => {
  const b = req.body || {};
  const email = clean(b.email).toLowerCase();
  const enrollmentNo = clean(b.enrollmentNo).toUpperCase();
  const mobile = clean(b.mobile);
  const fullName = clean(b.fullName);

  if (!enrollmentNo) throw httpErr(400, 'Enrollment number is required.');
  if (!fullName) throw httpErr(400, 'Full name is required.');
  if (!email) throw httpErr(400, 'Email address is required.');
  if (!EMAIL_RE.test(email)) throw httpErr(400, 'Please enter a valid email address.');
  if (!email.endsWith('@scet.ac.in')) throw httpErr(400, 'Only official @scet.ac.in email addresses are permitted for student accounts.');
  if (mobile && !/^\d{10}$/.test(mobile)) throw httpErr(400, 'Mobile must be exactly 10 digits.');

  // Uniqueness: one account per email address within student role (faculty accounts with same email allowed)
  const emailSnap = await db.collection('users')
    .where('role', '==', 'student')
    .where('email', '==', email)
    .limit(1).get();
  if (!emailSnap.empty) throw httpErr(409, 'A student account with this email address already exists. Please sign in instead.');

  // Uniqueness: one account per enrollment number
  const enSnap = await db.collection('users')
    .where('role', '==', 'student')
    .where('enrollmentNo', '==', enrollmentNo)
    .limit(1).get();
  if (!enSnap.empty) throw httpErr(409, 'A student account with this enrollment number already exists. Please sign in instead.');

  // Uniqueness: one account per mobile number within student role
  if (mobile) {
    const mobileSnap = await db.collection('users')
      .where('role', '==', 'student')
      .where('mobile', '==', mobile)
      .limit(1).get();
    if (!mobileSnap.empty) throw httpErr(409, 'A student account with this mobile number already exists.');
  }

  // Generate 6-digit OTP scoped specifically to student signup (expires in 5 minutes)
  const otp = newOtp();
  const otpDocId = `signup_student__${email.replace(/[^a-z0-9]/g, '_')}`;
  await db.doc(`otps/${otpDocId}`).set({
    hash: hmac(otp, cfg.sessionSecret),
    exp: Date.now() + 5 * 60e3,
    attempts: 0,
    email,
  });

  // Send verification email
  let mailResult = { ok: false, error: 'Not sent' };
  try {
    mailResult = await sendMail({
      to: email,
      subject: 'SCET Lab Portal - Student Account Verification Code',
      text: `Dear ${fullName},\n\nGreetings from Sarvajanik College of Engineering & Technology (SCET)!\n\nYour 6-digit verification code to create your SCET Lab Portal student account is:\n\n    ${otp}\n\nThis verification code is valid for 5 minutes. Do not share this code with anyone.\n\nBest Regards,\nSCET Lab Administration\nSarvajanik College of Engineering & Technology (SCET), Surat`,
    });
  } catch (err) {
    mailResult = { ok: false, error: err.message };
  }

  // Also dispatch automated WhatsApp / mobile notification if mobile provided
  if (mobile) {
    sendAutomatedWhatsApp({
      to: mobile,
      studentName: fullName,
      reqId: 'OTP',
      time: 'Valid for 5 minutes',
      note: `Your SCET Student Verification Code is: ${otp}`,
      itemsSummary: `Student OTP: ${otp}`,
      type: 'OTP_VERIFICATION'
    }).catch(e => console.warn('[OTP WhatsApp dispatch error]:', e.message));
  }

  if (!mailResult.ok) {
    console.error('[Send OTP] Email delivery failed:', mailResult.error);
    throw httpErr(502, `Email delivery failed: ${mailResult.error || 'Unable to deliver verification code to @scet.ac.in email'}. Please check your email address and try again.`);
  }

  res.json({
    ok: true,
    message: `Verification code sent to ${email}! Valid for 5 minutes.`
  });
});

/* ---------- Student sign-up: Complete Registration with OTP ---------- */
router.post('/signup/student', signupLimit, async (req, res) => {
  const b = req.body || {};
  const enrollmentNo = clean(b.enrollmentNo).toUpperCase();
  const p = { displayName: clean(b.fullName), enrollmentNo, branch: clean(b.branch), mobile: clean(b.mobile), email: clean(b.email).toLowerCase() };
  if (!enrollmentNo || !p.displayName || !p.branch) throw httpErr(400, 'Enrollment number, full name and branch are required.');
  if (!/^\d{10}$/.test(p.mobile)) throw httpErr(400, 'Mobile must be exactly 10 digits.');
  if (!EMAIL_RE.test(p.email)) throw httpErr(400, 'Enter a valid email address.');
  if (!p.email.endsWith('@scet.ac.in')) throw httpErr(400, 'Only @scet.ac.in email addresses are permitted for student accounts.');

  // Validate OTP
  const otp = clean(b.otp);
  if (!otp) throw httpErr(400, 'Verification code (OTP) is required. Please verify your email first.');
  const otpDocId = `signup_student__${p.email.replace(/[^a-z0-9]/g, '_')}`;
  const otpRef = db.doc(`otps/${otpDocId}`);
  const otpSnap = await otpRef.get();
  if (!otpSnap.exists) throw httpErr(400, 'Verification code not found or expired. Please click "Send Verification Code".');
  const otpData = otpSnap.data();
  if (otpData.exp < Date.now()) {
    await otpRef.delete().catch(() => {});
    throw httpErr(400, 'Verification code has expired. Please request a new code.');
  }
  if (otpData.attempts >= 5) {
    await otpRef.delete().catch(() => {});
    throw httpErr(429, 'Too many wrong verification code attempts. Please request a new code.');
  }
  if (hmac(otp, cfg.sessionSecret) !== otpData.hash) {
    await otpRef.update({ attempts: FieldValue.increment(1) });
    throw httpErr(400, 'Invalid verification code. Please check your email and try again.');
  }
  // OTP is verified - consume it
  await otpRef.delete().catch(() => {});

  // Uniqueness: one account per email address within student role
  const emailSnap = await db.collection('users')
    .where('role', '==', 'student')
    .where('email', '==', p.email)
    .limit(1).get();
  if (!emailSnap.empty) throw httpErr(409, 'A student account with this email address already exists. Please sign in instead.');

  // Uniqueness: one account per enrollment number within student role
  const enSnap = await db.collection('users')
    .where('role', '==', 'student')
    .where('enrollmentNo', '==', enrollmentNo)
    .limit(1).get();
  if (!enSnap.empty) throw httpErr(409, 'A student account with this enrollment number already exists. Please sign in instead.');

  // Uniqueness: one account per mobile number within student role
  if (p.mobile) {
    const mobileSnap = await db.collection('users')
      .where('role', '==', 'student')
      .where('mobile', '==', p.mobile)
      .limit(1).get();
    if (!mobileSnap.empty) throw httpErr(409, 'A student account with this mobile number already exists.');
  }

  await createAccount({ username: enrollmentNo, password: b.password, role: 'student', profile: p });
  res.status(201).json({ ok: true, message: 'Student account created successfully!' });
});

/* ---------- Faculty / Admin sign-up: Send Verification OTP ---------- */
router.post('/signup/admin/send-otp', signupLimit, async (req, res) => {
  const b = req.body || {};
  const email = clean(b.email).toLowerCase();
  const username = clean(b.username).toLowerCase();
  const mobile = clean(b.mobile);
  const fullName = clean(b.fullName);
  const branch = clean(b.branch).toUpperCase();

  // Validate Master credentials (Master ID: admin, Master Password: admin123)
  const masterUser = cfg.masterUser || 'admin';
  const masterPass = cfg.masterPass || 'admin123';
  const userOk = safeEqual(clean(b.masterUsername), masterUser);
  const passOk = safeEqual(String(b.masterPassword ?? ''), masterPass);
  if (!(userOk && passOk)) {
    throw httpErr(403, 'Invalid Master Admin credentials (Master ID or Master Password).');
  }

  if (!username) throw httpErr(400, 'Faculty / Admin ID is required.');
  if (!USERNAME_RE.test(username)) throw httpErr(400, 'Faculty ID must be 3-32 characters: letters, digits, dot, dash, underscore.');
  if (!fullName) throw httpErr(400, 'Full name is required.');
  if (!branch) throw httpErr(400, 'Department / Branch is required.');
  if (!email) throw httpErr(400, 'Email address is required.');
  if (!EMAIL_RE.test(email)) throw httpErr(400, 'Please enter a valid email address.');
  if (!email.endsWith('@scet.ac.in')) throw httpErr(400, 'Only official @scet.ac.in email addresses are permitted for faculty accounts.');
  if (mobile && !/^\d{10}$/.test(mobile)) throw httpErr(400, 'Mobile must be exactly 10 digits.');

  // Uniqueness: check email within faculty/admin accounts only (student accounts with same email permitted)
  const emailSnap = await db.collection('users')
    .where('role', '==', 'admin')
    .where('email', '==', email)
    .limit(1).get();
  if (!emailSnap.empty) throw httpErr(409, 'A faculty / admin account with this email address already exists. Please sign in instead.');

  // Uniqueness: check username within admin accounts only
  const userSnap = await db.collection('users')
    .where('role', '==', 'admin')
    .where('username', '==', username)
    .limit(1).get();
  if (!userSnap.empty) throw httpErr(409, 'An account with this Faculty / Admin ID already exists. Please choose another ID or sign in.');

  // Uniqueness: check mobile if provided
  if (mobile) {
    const mobileSnap = await db.collection('users')
      .where('role', '==', 'admin')
      .where('mobile', '==', mobile)
      .limit(1).get();
    if (!mobileSnap.empty) throw httpErr(409, 'A faculty account with this mobile number already exists.');
  }

  // Generate 6-digit OTP scoped specifically to admin signup (expires in 5 minutes)
  const otp = newOtp();
  const otpDocId = `signup_admin__${email.replace(/[^a-z0-9]/g, '_')}`;
  await db.doc(`otps/${otpDocId}`).set({
    hash: hmac(otp, cfg.sessionSecret),
    exp: Date.now() + 5 * 60e3,
    attempts: 0,
    email,
  });

  // Send verification email
  let mailResult = { ok: false, error: 'Not sent' };
  try {
    mailResult = await sendMail({
      to: email,
      subject: 'SCET Lab Portal - Faculty Account Verification Code',
      text: `Dear ${fullName},\n\nGreetings from Sarvajanik College of Engineering & Technology (SCET)!\n\nYour 6-digit verification code to create your SCET Lab Portal Faculty / Admin account is:\n\n    ${otp}\n\nThis verification code is valid for 5 minutes. Do not share this code with anyone.\n\nBest Regards,\nSCET Lab Administration\nSarvajanik College of Engineering & Technology (SCET), Surat`,
    });
  } catch (err) {
    mailResult = { ok: false, error: err.message };
  }

  // Also dispatch automated WhatsApp / mobile notification if mobile provided
  if (mobile) {
    sendAutomatedWhatsApp({
      to: mobile,
      studentName: fullName,
      reqId: 'OTP',
      time: 'Valid for 5 minutes',
      note: `Your SCET Faculty Verification Code is: ${otp}`,
      itemsSummary: `Faculty OTP: ${otp}`,
      type: 'OTP_VERIFICATION'
    }).catch(e => console.warn('[Admin OTP WhatsApp dispatch error]:', e.message));
  }

  if (!mailResult.ok) {
    console.error('[Send Admin OTP] Email delivery failed:', mailResult.error);
    throw httpErr(502, `Email delivery failed: ${mailResult.error || 'Unable to deliver verification code to @scet.ac.in email'}. Please check your email address and try again.`);
  }

  res.json({
    ok: true,
    message: `Verification code sent to ${email}! Valid for 5 minutes.`
  });
});

/* ---------- Admin sign-up: Faculty Self-Registration with OTP or Master Bootstrap ---------- */
router.post('/signup/admin', signupLimit, async (req, res) => {
  const b = req.body || {};

  // Flow A: Faculty account registration via @scet.ac.in OTP
  if (b.otp) {
    // Validate Master credentials
    const masterUser = cfg.masterUser || 'admin';
    const masterPass = cfg.masterPass || 'admin123';
    const userOk = safeEqual(clean(b.masterUsername), masterUser);
    const passOk = safeEqual(String(b.masterPassword ?? ''), masterPass);
    if (!(userOk && passOk)) {
      throw httpErr(403, 'Invalid Master Admin credentials (Master ID or Master Password).');
    }

    const email = clean(b.email).toLowerCase();
    const username = clean(b.username).toLowerCase();
    const fullName = clean(b.fullName || b.displayName);
    const branch = clean(b.branch).toUpperCase();
    const mobile = clean(b.mobile);
    const password = b.password;
    const otp = clean(b.otp);

    if (!username || !fullName || !branch) throw httpErr(400, 'Faculty ID, full name and department are required.');
    if (!USERNAME_RE.test(username)) throw httpErr(400, 'Faculty ID must be 3-32 characters: letters, digits, dot, dash, underscore.');
    if (!email || !EMAIL_RE.test(email) || !email.endsWith('@scet.ac.in')) throw httpErr(400, 'A valid official @scet.ac.in email address is required.');
    if (typeof password !== 'string' || password.length < 8) throw httpErr(400, 'Password must be at least 8 characters.');
    if (mobile && !/^\d{10}$/.test(mobile)) throw httpErr(400, 'Mobile must be exactly 10 digits.');

    // Validate OTP
    const otpDocId = `signup_admin__${email.replace(/[^a-z0-9]/g, '_')}`;
    const otpRef = db.doc(`otps/${otpDocId}`);
    const otpSnap = await otpRef.get();
    if (!otpSnap.exists) throw httpErr(400, 'Verification code not found or expired. Please click "Send Verification Code".');
    const otpData = otpSnap.data();
    if (otpData.exp < Date.now()) {
      await otpRef.delete().catch(() => {});
      throw httpErr(400, 'Verification code has expired. Please request a new code.');
    }
    if (otpData.attempts >= 5) {
      await otpRef.delete().catch(() => {});
      throw httpErr(429, 'Too many wrong verification code attempts. Please request a new code.');
    }
    if (hmac(otp, cfg.sessionSecret) !== otpData.hash) {
      await otpRef.update({ attempts: FieldValue.increment(1) });
      throw httpErr(400, 'Invalid verification code. Please check your email and try again.');
    }
    await otpRef.delete().catch(() => {});

    // Check duplicate email & username within admin role
    const emailSnap = await db.collection('users')
      .where('role', '==', 'admin')
      .where('email', '==', email)
      .limit(1).get();
    if (!emailSnap.empty) throw httpErr(409, 'A faculty / admin account with this email address already exists. Please sign in instead.');

    const userSnap = await db.collection('users')
      .where('role', '==', 'admin')
      .where('username', '==', username)
      .limit(1).get();
    if (!userSnap.empty) throw httpErr(409, 'An account with this Faculty / Admin ID already exists. Please sign in or choose another ID.');

    const profile = { displayName: fullName, branch, mobile, email };
    const u = await createAccount({ username, password, role: 'admin', profile });
    await writeAudit({ adminUid: u.uid, adminUsername: u.username, action: 'FACULTY_ADMIN_REGISTERED', ip: req.ip });
    return res.status(201).json({ ok: true, message: 'Faculty / Admin account created successfully!' });
  }

  // Flow B: Master admin bootstrap fallback
  const userOk = safeEqual(clean(b.masterUsername), cfg.masterUser);
  const passOk = safeEqual(String(b.masterPassword ?? ''), cfg.masterPass);
  if (!(userOk && passOk)) throw httpErr(403, 'Invalid master admin credentials.');

  const slot = db.doc('meta/bootstrap');
  try {
    await slot.create({ startedAt: FieldValue.serverTimestamp() });
  } catch (e) {
    if (e.code === 6) throw httpErr(403, 'The initial admin already exists. You can sign up using your @scet.ac.in faculty email or ask an existing admin.');
    throw e;
  }
  try {
    const email = clean(b.email || '');
    const profile = { displayName: clean(b.displayName) || clean(b.username), ...(email && EMAIL_RE.test(email) ? { email } : {}) };
    const u = await createAccount({ username: b.username, password: b.password, role: 'admin', profile });
    await slot.update({ firstAdminUid: u.uid, username: u.username });
    await writeAudit({ adminUid: u.uid, adminUsername: u.username, action: 'FIRST_ADMIN_CREATED', ip: req.ip });
    res.status(201).json({ ok: true });
  } catch (e) {
    await slot.delete().catch(() => { });
    throw e;
  }
});

/* ---------- Additional admins: created by a logged-in admin ---------- */
router.get('/admins', requireRole('admin'), async (req, res) => {
  const s = await db.collection('users').where('role', '==', 'admin').get();
  res.json(s.docs.map((d) => ({ username: d.data().username, displayName: d.data().displayName, isActive: d.data().isActive, email: d.data().email || '' })));
});

router.post('/admins', requireRole('admin'), audited('ADMIN_ACCOUNT_CREATED'), async (req, res) => {
  const b = req.body || {};
  const email = clean(b.email || '');
  const profile = { displayName: clean(b.displayName) || clean(b.username), ...(email && EMAIL_RE.test(email) ? { email } : {}) };
  const u = await createAccount({ username: b.username, password: b.password, role: 'admin', profile });
  res.locals.auditDetail = `Created admin account "${u.username}"`;
  res.status(201).json({ ok: true });
});

router.post('/admins/:username/deactivate', requireRole('admin'), audited('ADMIN_ACCOUNT_DEACTIVATED'), async (req, res) => {
  const target = clean(req.params.username).toLowerCase();
  if (target === req.user.username) throw httpErr(400, 'You cannot deactivate your own account.');
  const s = await db.collection('users').where('username', '==', target).where('role', '==', 'admin').limit(1).get();
  if (s.empty) throw httpErr(404, 'No such admin.');
  const uid = s.docs[0].id;
  await auth.updateUser(uid, { disabled: true });
  await auth.revokeRefreshTokens(uid);
  await s.docs[0].ref.update({ isActive: false });
  res.locals.auditDetail = `Deactivated admin "${target}"`;
  res.json({ ok: true });
});

/* ---------- Forgot password (students + admins) ---------- */
router.post('/forgot-password', forgotLimit, async (req, res) => {
  const username = clean(req.body?.username).toLowerCase();
  const portal = req.body?.portal;
  if (!username || !['student', 'admin'].includes(portal)) {
    return res.json({ ok: true }); // silent fail for bad requests
  }

  try {
    const role = portal === 'student' ? 'student' : 'admin';
    let snap;
    if (username.includes('@')) {
      snap = await db.collection('users')
        .where('email', '==', username)
        .where('role', '==', role)
        .limit(1)
        .get();
    } else {
      snap = await db.collection('users')
        .where('username', '==', portal === 'student' ? username.toUpperCase() : username)
        .where('role', '==', role)
        .limit(1)
        .get();
      if (snap.empty) {
        snap = await db.collection('users')
          .where('username', '==', username)
          .where('role', '==', role)
          .limit(1)
          .get();
      }
    }

    // Specific error if username/email doesn't exist (per user request)
    if (snap.empty) {
      return res.status(404).json({ error: 'This account does not exist. Please check your ID/email or sign up.' });
    }

    const data = snap.docs[0].data();
    const realEmail = data.email;
    if (realEmail && EMAIL_RE.test(realEmail)) {
      // Firebase generates a link valid for 1 hour
      let resetLink;
      try {
        resetLink = await auth.generatePasswordResetLink(toEmail(data.username, role));
      } catch {
        resetLink = await auth.generatePasswordResetLink(legacyEmail(data.username));
      }
      await sendMail({
        to: realEmail,
        ...templates.passwordReset(data.displayName || data.username, resetLink),
      });
    }
  } catch (e) {
    console.error('Forgot-password error:', e.message);
  }

  // Respond OK if the user existed and the email flow reached the end safely
  res.json({ ok: true });
});

/* ---------- Login / session ---------- */
router.post('/login', loginLimit, async (req, res) => {
  const rawUsername = clean(req.body?.username);
  const username = rawUsername.toLowerCase();
  const { password, portal } = req.body || {};
  if (!username || typeof password !== 'string' || !password || !['admin', 'student'].includes(portal)) {
    throw httpErr(400, 'Username, password and portal are required.');
  }
  const fail = () => res.status(401).json({ error: 'Invalid credentials or inactive account.' });

  // Allow logging in with @scet.ac.in email or ID (enrollment number or admin ID)
  let loginUsername = username;
  let userProfile = null;

  if (username.includes('@')) {
    if (!username.endsWith('@scet.ac.in')) {
      return res.status(403).json({ error: 'Login with email is only permitted for official @scet.ac.in email accounts.' });
    }
    const snap = await db.collection('users')
      .where('role', '==', portal)
      .where('email', '==', username)
      .limit(1).get();
    if (snap.empty) return fail();
    userProfile = snap.docs[0].data();
    loginUsername = userProfile.username;
  } else {
    const targetUsername = portal === 'student' ? username.toUpperCase() : username;
    let snap = await db.collection('users')
      .where('role', '==', portal)
      .where('username', '==', targetUsername)
      .limit(1).get();
    if (snap.empty) {
      snap = await db.collection('users')
        .where('role', '==', portal)
        .where('username', '==', username)
        .limit(1).get();
    }
    if (snap.empty && portal === 'student') {
      snap = await db.collection('users')
        .where('role', '==', 'student')
        .where('enrollmentNo', '==', rawUsername.toUpperCase())
        .limit(1).get();
    }
    if (!snap.empty) {
      userProfile = snap.docs[0].data();
      loginUsername = userProfile.username;
    }
  }

  // Try role-scoped synthetic email first, then fallback to legacy and lowercase formats
  const candidates = [
    toEmail(loginUsername, portal),
    toEmail(loginUsername.toLowerCase(), portal),
    legacyEmail(loginUsername),
    legacyEmail(loginUsername.toLowerCase()),
    toEmail(rawUsername, portal),
    legacyEmail(rawUsername),
  ];
  if (userProfile?.email) {
    candidates.push(userProfile.email);
    candidates.push(userProfile.email.toLowerCase());
  }
  if (userProfile?.enrollmentNo) {
    candidates.push(toEmail(userProfile.enrollmentNo, portal));
    candidates.push(legacyEmail(userProfile.enrollmentNo));
  }
  const uniqueEmails = [...new Set(candidates.filter(Boolean))];

  let r = { ok: false };
  let data = null;

  for (const candidateEmail of uniqueEmails) {
    try {
      const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.firebaseWebApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: candidateEmail, password, returnSecureToken: true }),
      });
      if (resp.ok) {
        r = resp;
        data = await resp.json();
        break;
      }
    } catch {
      // Continue to next candidate
    }
  }

  if (!r.ok || !data?.idToken) return fail();

  const decoded = await auth.verifyIdToken(data.idToken);

  // Verify profile and role
  const userDoc = await db.doc(`users/${decoded.uid}`).get();
  const docData = userDoc.data() || userProfile || {};
  const effectiveRole = decoded.role || docData.role;
  if (effectiveRole !== portal) return fail(); // students cannot use the admin door and vice versa

  if (docData.isActive === false) {
    return res.status(403).json({ error: 'Your account is currently deactivated. Please contact the administrator.' });
  }

  if (!decoded.role && docData.role) {
    await auth.setCustomUserClaims(decoded.uid, { role: docData.role, username: docData.username || decoded.username }).catch(() => {});
  }

  // Verify @scet.ac.in email on profile
  const profileEmail = (docData.email || '').toLowerCase();
  if (profileEmail && !profileEmail.endsWith('@scet.ac.in')) {
    return res.status(403).json({ error: 'Login is only permitted for @scet.ac.in email accounts.' });
  }

  const session = await auth.createSessionCookie(data.idToken, { expiresIn: cfg.sessionHours * 3600e3 });
  res.cookie(COOKIE, session, cookieOpts);
  if (portal === 'admin') await writeAudit({ adminUid: decoded.uid, adminUsername: decoded.username, action: 'ADMIN_LOGIN', ip: req.ip });

  res.json({
    user: {
      uid: decoded.uid,
      username: decoded.username,
      role: decoded.role,
      displayName: docData.displayName || decoded.username,
      enrollmentNo: docData.enrollmentNo,
      branch: docData.branch
    },
    token: session
  });
});

router.post('/logout', async (req, res) => {
  if (req.user?.role === 'admin') await writeAudit({ adminUid: req.user.uid, adminUsername: req.user.username, action: 'ADMIN_LOGOUT', ip: req.ip });
  const { maxAge, ...clear } = cookieOpts;
  res.clearCookie(COOKIE, clear).clearCookie(BRANCH_COOKIE, clear).json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const doc = await db.doc(`users/${req.user.uid}`).get();
  const p = doc.data() || {};
  res.json({
    user: { ...req.user, displayName: p.displayName, enrollmentNo: p.enrollmentNo, branch: p.branch },
    activeBranch: req.user.role === 'admin' ? activeBranch(req) : null,
  });
});

module.exports = router;