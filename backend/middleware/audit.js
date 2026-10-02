const { db, FieldValue } = require('../firebase');

/** Append-only. Never exposed for update/delete through the API. */
async function writeAudit(entry) {
  try {
    await db.collection('auditLogs').add({ ts: FieldValue.serverTimestamp(), ...entry });
  } catch (err) {
    console.error('AUDIT WRITE FAILED:', err.message, entry);
  }
}

/**
 * Route-level audit hook: records the logged-in admin's username, action, branch,
 * and details (handlers set res.locals.auditDetail) after a SUCCESSFUL response.
 */
const audited = (action) => (req, res, next) => {
  const branchCode = req.params.code ? String(req.params.code).toUpperCase() : null;
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user || req.user.role !== 'admin') return;
    writeAudit({
      adminUid: req.user.uid, adminUsername: req.user.username, action, branchCode,
      details: res.locals.auditDetail || null, method: req.method,
      path: req.originalUrl.split('?')[0], ip: req.ip,
    });
  });
  next();
};
module.exports = { writeAudit, audited };
