const router = require('express').Router();
const { db } = require('../firebase');
const { iso } = require('../utils/issues');

// Read-only view of the append-only audit trail (no update/delete route exists).
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const s = await db.collection('auditLogs').orderBy('ts', 'desc').limit(limit).get();
  res.json(s.docs.map((d) => { const x = d.data(); return { ...x, ts: iso(x.ts) }; }));
});
module.exports = router;
