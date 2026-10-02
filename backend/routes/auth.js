const router = require('express').Router();
const cfg = require('../config');
const { auth, db, FieldValue } = require('../firebase');
const { safeEqual } = require('../utils/crypto');
const { httpErr, clean } = require('../utils/http');
const { COOKIE, BRANCH_COOKIE, cookieOpts, requireRole, activeBranch } = require('../middleware/auth');
const { audited, writeAudit } = require('../middleware/audit');
const rateLimit = require('../middleware/rateLimit');
const { sendMail, templates } = require('../utils/mailer');

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
// Firebase Auth is email-based; usernames are mapped to a synthetic, never-mailed address.
const toEmail = (u) => `${u}@lab-users.scet.invalid`;

const loginLimit = rateLimit({ max: 5, key: (r) => `${r.ip}|${clean(r.body?.username).toLowerCase()}` });
const signupLimit = rateLimit({ max: 10, key: (r) => r.ip });
const forgotLimit = rateLimit({ max: 5, key: (r) => r.ip });

async function createAccount({ username, password, role, profile }) {
  username = clean(username).toLowerCase();
  if (!USERNAME_RE.test(username)) throw httpErr(400, 'Username must be 3-32 characters: letters, digits, dot, dash, underscore.');
  if (typeof password !== 'string' || password.length < 8) throw httpErr(400, 'Password must be at least 8 characters.');
  let rec;
  try {
    rec = await auth.createUser({ email: toEmail(username), password, displayName: profile.displayName });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw httpErr(409, 'That username is already taken.');
    throw e;
  }
  await auth.setCustomUserClaims(rec.uid, { role, username });
  await db.doc(`users/${rec.uid}`).set({ username, role, ...profile, isActive: true, createdAt: FieldValue.serverTimestamp() });
  return { uid: rec.uid, username, role };
}

/* ---------- Student sign-up (username = enrollment number) ---------- */
router.post('/signup/student', signupLimit, async (req, res) => {
  const b = req.body || {};
  const enrollmentNo = clean(b.enrollmentNo).toUpperCase();
  const p = { displayName: clean(b.fullName), enrollmentNo, branch: clean(b.branch), mobile: clean(b.mobile), email: clean(b.email) };
  if (!enrollmentNo || !p.displayName || !p.branch) throw httpErr(400, 'Enrollment number, full name and branch are required.');
  if (!/^\d{10}$/.test(p.mobile)) throw httpErr(400, 'Mobile must be exactly 10 digits.');
  if (!EMAIL_RE.test(p.email)) throw httpErr(400, 'Enter a valid email address.');
  if (!p.email.toLowerCase().endsWith('@scet.ac.in')) throw httpErr(400, 'Only @scet.ac.in email addresses are permitted for student accounts.');

  // Uniqueness: one account per email address
  const emailSnap = await db.collection('users')
    .where('role', '==', 'student')
    .where('email', '==', p.email.toLowerCase())
    .limit(1).get();
  if (!emailSnap.empty) throw httpErr(409, 'An account with this email address already exists.');

  // Uniqueness: one account per mobile number
  const mobileSnap = await db.collection('users')
    .where('role', '==', 'student')
    .where('mobile', '==', p.mobile)
    .limit(1).get();
  if (!mobileSnap.empty) throw httpErr(409, 'An account with this mobile number already exists.');

  // Normalise email to lowercase before storing
  p.email = p.email.toLowerCase();

  await createAccount({ username: enrollmentNo, password: b.password, role: 'student', profile: p });
  res.status(201).json({ ok: true });
});

/* ---------- List all students (for ledger auto-fill) ---------- */
router.get('/students', requireRole('admin'), async (req, res) => {
  const s = await db.collection('users').where('role', '==', 'student').get();
  res.json(s.docs.map(d => {
    const data = d.data();
    return { enrollmentNo: data.enrollmentNo, displayName: data.displayName, branch: data.branch, mobile: data.mobile, email: data.email || '' };
  }));
});

/* ---------- First-admin bootstrap (master credentials, one time only) ---------- */
router.get('/bootstrap-status', async (req, res) => {
  res.json({ firstAdminExists: (await db.doc('meta/bootstrap').get()).exists });
});

router.post('/signup/admin', signupLimit, async (req, res) => {
  const b = req.body || {};
  const userOk = safeEqual(clean(b.masterUsername), cfg.masterUser);
  const passOk = safeEqual(String(b.masterPassword ?? ''), cfg.masterPass);
  if (!(userOk && passOk)) throw httpErr(403, 'Invalid master admin credentials.');

  // Atomic one-time claim: create() fails if the document already exists.
  const slot = db.doc('meta/bootstrap');
  try {
    await slot.create({ startedAt: FieldValue.serverTimestamp() });
  } catch (e) {
    if (e.code === 6) throw httpErr(403, 'The initial admin already exists. Ask a current admin to create your account from the Admins tab after signing in.');
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
    await slot.delete().catch(() => { }); // release the slot if creation failed
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
    const snap = await db.collection('users')
      .where('username', '==', portal === 'student' ? username.toUpperCase() : username)
      .where('role', '==', role)
      .limit(1)
      .get();

    // Specific error if username doesn't exist (per user request)
    if (snap.empty) {
      return res.status(404).json({ error: 'This username does not exist. Please sign up to continue.' });
    }

    const data = snap.docs[0].data();
    const realEmail = data.email;
    if (realEmail && EMAIL_RE.test(realEmail)) {
      // Firebase generates a link valid for 1 hour
      const resetLink = await auth.generatePasswordResetLink(toEmail(data.username));
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
  const username = clean(req.body?.username).toLowerCase();
  const { password, portal } = req.body || {};
  if (!username || typeof password !== 'string' || !password || !['admin', 'student'].includes(portal)) {
    throw httpErr(400, 'Username, password and portal are required.');
  }
  const fail = () => res.status(401).json({ error: 'Invalid credentials or inactive account.' });
  // For students: allow logging in with their @scet.ac.in email or enrollment number
  let loginUsername = username;
  if (portal === 'student' && username.includes('@')) {
    if (!username.endsWith('@scet.ac.in')) {
      return res.status(403).json({ error: 'Student login is only permitted for @scet.ac.in email accounts.' });
    }
    const snap = await db.collection('users').where('role', '==', 'student').where('email', '==', username).limit(1).get();
    if (snap.empty) return fail();
    loginUsername = snap.docs[0].data().username;
  }

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.firebaseWebApiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: toEmail(loginUsername), password, returnSecureToken: true }),
  });
  const data = await r.json();
  if (!r.ok) return fail();

  const decoded = await auth.verifyIdToken(data.idToken);
  if (decoded.role !== portal) return fail(); // students cannot use the admin door and vice versa

  // Students must have a verified @scet.ac.in email on their profile
  if (portal === 'student') {
    const userDoc = await db.doc(`users/${decoded.uid}`).get();
    const profileEmail = (userDoc.data()?.email || '').toLowerCase();
    if (!profileEmail.endsWith('@scet.ac.in')) {
      return res.status(403).json({ error: 'Student login is only permitted for @scet.ac.in email accounts.' });
    }
  }

  const session = await auth.createSessionCookie(data.idToken, { expiresIn: cfg.sessionHours * 3600e3 });
  res.cookie(COOKIE, session, cookieOpts);
  if (portal === 'admin') await writeAudit({ adminUid: decoded.uid, adminUsername: decoded.username, action: 'ADMIN_LOGIN', ip: req.ip });
  res.json({ user: { uid: decoded.uid, username: decoded.username, role: decoded.role } });
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
