const cfg = require('../config');
const { auth } = require('../firebase');
const { unsign } = require('../utils/crypto');

const COOKIE = 'scet_session';
const BRANCH_COOKIE = 'scet_branch';
const isProd = cfg.isProd;
const cookieOpts = {
  httpOnly: true,
  sameSite: 'none',
  secure: true,
  path: '/',
  maxAge: cfg.sessionHours * 3600e3,
};

/** Verifies the Firebase session cookie or Bearer token (revocation + disabled-user aware) and attaches req.user. */
async function attachUser(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = bearerToken || req.cookies?.[COOKIE];

  if (token) {
    try {
      let d;
      try {
        d = await auth.verifySessionCookie(token, true);
      } catch {
        d = await auth.verifyIdToken(token, true);
      }
      if (d) {
        let role = d.role;
        let username = d.username;
        if (!role || !username) {
          try {
            const { db } = require('../firebase');
            const uDoc = await db.doc(`users/${d.uid}`).get();
            const uData = uDoc.data();
            if (uData) {
              role = role || uData.role;
              username = username || uData.username || uData.enrollmentNo;
            }
          } catch {}
        }
        if (role) {
          req.user = { uid: d.uid, role, username: username || d.uid };
        }
      }
    } catch {
      /* invalid/expired -> treated as logged out */
    }
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
  const token = req.headers['x-branch-token'] || req.cookies?.[BRANCH_COOKIE];
  const p = unsign(token, cfg.sessionSecret);
  if (!p || p.uid !== req.user.uid || p.code !== code) {
    return res.status(403).json({ error: `Enter the branch password for ${code} first.`, code: 'BRANCH_LOCKED' });
  }
  req.branch = code;
  next();
}

const activeBranch = (req) => {
  const token = req.headers['x-branch-token'] || req.cookies?.[BRANCH_COOKIE];
  const p = unsign(token, cfg.sessionSecret);
  return p && req.user && p.uid === req.user.uid ? p.code : null;
};

module.exports = { COOKIE, BRANCH_COOKIE, cookieOpts, attachUser, requireAuth, requireRole, requireBranch, activeBranch };
