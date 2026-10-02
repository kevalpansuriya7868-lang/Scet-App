const cfg = require('../config');
const { auth } = require('../firebase');
const { unsign } = require('../utils/crypto');

const COOKIE = 'scet_session';
const BRANCH_COOKIE = 'scet_branch';
const isProd = cfg.isProd;
const cookieOpts = {
  httpOnly: true,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
  path: '/',
  maxAge: cfg.sessionHours * 3600e3,
};

/** Verifies the Firebase session cookie (revocation + disabled-user aware) and attaches req.user. */
async function attachUser(req, res, next) {
  const c = req.cookies?.[COOKIE];
  if (c) {
    try {
      const d = await auth.verifySessionCookie(c, true);
      if (d.role) req.user = { uid: d.uid, role: d.role, username: d.username };
    } catch { /* invalid/expired -> treated as logged out */ }
  }
  next();
}

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Please log in.', code: 'AUTH_REQUIRED' });

const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in.', code: 'AUTH_REQUIRED' });
  if (req.user.role !== role) return res.status(403).json({ error: 'You do not have permission for this action.' });
  next();
};

/** Department isolation: admin must have unlocked THIS branch with its password. */
function requireBranch(req, res, next) {
  const code = String(req.params.code || '').toUpperCase();
  const p = unsign(req.cookies?.[BRANCH_COOKIE], cfg.sessionSecret);
  if (!p || p.uid !== req.user.uid || p.code !== code) {
    return res.status(403).json({ error: `Enter the branch password for ${code} first.`, code: 'BRANCH_LOCKED' });
  }
  req.branch = code;
  next();
}

const activeBranch = (req) => {
  const p = unsign(req.cookies?.[BRANCH_COOKIE], cfg.sessionSecret);
  return p && req.user && p.uid === req.user.uid ? p.code : null;
};

module.exports = { COOKIE, BRANCH_COOKIE, cookieOpts, attachUser, requireAuth, requireRole, requireBranch, activeBranch };
