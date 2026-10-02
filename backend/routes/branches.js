const router = require('express').Router();
const cfg = require('../config');
const { db, FieldValue, Timestamp } = require('../firebase');
const { hashSecret, verifySecret, newOtp, hmac, sign } = require('../utils/crypto');
const { httpErr, clean } = require('../utils/http');
const { deleteWhere } = require('../utils/firestore');
const { sendMail, templates } = require('../utils/mailer');
const { BRANCH_COOKIE, cookieOpts, requireBranch } = require('../middleware/auth');
const { audited } = require('../middleware/audit');
const rateLimit = require('../middleware/rateLimit');

const unlockLimit = rateLimit({ max: 5, key: (r) => `${r.user.uid}|${r.params.code}` });
const otpLimit = rateLimit({ max: 3, key: (r) => `${r.user.uid}|${r.params.code}|otp` });
const upper = (v) => String(v).toUpperCase();

router.param('code', (req, res, next, v) => { req.params.code = upper(v); next(); });

async function getBranch(code) {
  const s = await db.doc(`branches/${code}`).get();
  if (!s.exists) throw httpErr(404, `Branch ${code} not found.`);
  return s.data();
}

/* One-time passwords, 10 min expiry, 5 attempts, stored only as HMAC. */
async function issueOtp(code, purpose, email) {
  const otp = newOtp();
  await db.doc(`otps/${code}__${purpose}`).set({ hash: hmac(otp, cfg.sessionSecret), exp: Date.now() + 10 * 60e3, attempts: 0 });
  const t = templates.otp(code, otp);
  const r = await sendMail({ to: email, ...t });
  if (!r.ok) throw httpErr(502, `Could not send OTP email: ${r.error}`);
  return { ...r, otp };
}
async function consumeOtp(code, purpose, otp) {
  const ref = db.doc(`otps/${code}__${purpose}`);
  const s = await ref.get();
  const d = s.data();
  if (!d || d.exp < Date.now()) throw httpErr(400, 'OTP expired or not requested. Request a new one.');
  if (d.attempts >= 5) throw httpErr(429, 'Too many wrong OTP attempts. Request a new one.');
  if (hmac(clean(otp), cfg.sessionSecret) !== d.hash) {
    await ref.update({ attempts: FieldValue.increment(1) });
    throw httpErr(400, 'Invalid OTP.');
  }
  await ref.delete();
}
const mask = (e) => (e.includes('@') ? `${e.slice(0, 3)}****${e.slice(e.indexOf('@'))}` : e);

router.post('/', audited('BRANCH_CREATED'), async (req, res) => {
  const code = upper(clean(req.body.code));
  const name = clean(req.body.name) || code;
  const password = String(req.body.password || '');
  const recoveryEmail = clean(req.body.recoveryEmail);
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) throw httpErr(400, 'Branch code: 1-20 letters/digits (e.g. CO, IT, EC).');
  if (password.length < 6 || !recoveryEmail.includes('@')) throw httpErr(400, 'Branch password (min 6) and a valid recovery email are required.');
  try {
    await db.doc(`branches/${code}`).create({
      code, name, passwordHash: await hashSecret(password), recoveryEmail, issueSeq: 0, createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    if (e.code === 6) throw httpErr(409, `Branch ${code} already exists.`);
    throw e;
  }
  res.locals.auditDetail = `Registered branch ${code} (${name})`;
  res.status(201).json({ ok: true });
});

router.post('/:code/unlock', unlockLimit, audited('BRANCH_UNLOCKED'), async (req, res) => {
  const b = await getBranch(req.params.code);
  if (!(await verifySecret(String(req.body.password || ''), b.passwordHash))) throw httpErr(401, `Incorrect password for branch ${req.params.code}.`);
  const token = sign({ uid: req.user.uid, code: req.params.code, exp: Date.now() + cfg.sessionHours * 3600e3 }, cfg.sessionSecret);
  res.cookie(BRANCH_COOKIE, token, cookieOpts).json({ ok: true });
});

router.post('/:code/lock', (req, res) => {
  const { maxAge, ...clear } = cookieOpts;
  res.clearCookie(BRANCH_COOKIE, clear).json({ ok: true });
});

router.post('/:code/otp', otpLimit, async (req, res) => {
  const purpose = req.body.purpose;
  if (!['reset', 'delete'].includes(purpose)) throw httpErr(400, 'Invalid OTP purpose.');
  const b = await getBranch(req.params.code);
  const r = await issueOtp(req.params.code, purpose, b.recoveryEmail);
  const resp = { sentTo: mask(b.recoveryEmail) };
  if (!cfg.isProd && r.devFallback) {
    resp.devOtp = r.otp;
    resp.smtpWarning = r.error;
  }
  res.json(resp);
});

router.post('/:code/reset-password', audited('BRANCH_PASSWORD_RESET'), async (req, res) => {
  const { otp, newPassword } = req.body;
  if (String(newPassword || '').length < 6) throw httpErr(400, 'New password must be at least 6 characters.');
  await getBranch(req.params.code);
  await consumeOtp(req.params.code, 'reset', otp);
  await db.doc(`branches/${req.params.code}`).update({ passwordHash: await hashSecret(newPassword) });
  res.locals.auditDetail = `Branch ${req.params.code} password reset via emailed OTP`;
  res.json({ ok: true });
});

router.delete('/:code', audited('BRANCH_DELETED'), async (req, res) => {
  const code = req.params.code;
  const b = await getBranch(code);
  if (!(await verifySecret(String(req.body.password || ''), b.passwordHash))) throw httpErr(401, 'Incorrect branch password.');
  await consumeOtp(code, 'delete', req.body.otp);
  const by = (c) => db.collection(c).where('branchCode', '==', code);
  await Promise.all([deleteWhere(by('componentImages')), deleteWhere(by('issues')), deleteWhere(by('components'))]);
  await db.doc(`branches/${code}`).delete();
  res.locals.auditDetail = `Deleted branch ${code} with all inventory, images and issue records`;
  res.json({ ok: true });
});

/* Branch-isolated modules: require the branch password to have been entered. */
router.use('/:code/components', requireBranch, require('./inventory'));
router.use('/:code/issues', requireBranch, require('./issues'));
router.use('/:code/students', requireBranch, require('./issues').students);
router.use('/:code/reports', requireBranch, require('./reports'));
router.use('/:code/requests', requireBranch, require('./requests'));

module.exports = router;

