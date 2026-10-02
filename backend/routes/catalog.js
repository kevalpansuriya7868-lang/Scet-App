const router = require('express').Router();
const { db } = require('../firebase');
const { overdueInfo } = require('../utils/dates');
const cfg = require('../config');

const code = (r) => String(r.params.code).toUpperCase();
const row = (x) => ({
  compId: x.compId, name: x.name, category: x.category, specifications: x.specifications || '',
  totalQty: x.totalQty, issuedQty: x.issuedQty, availableQty: x.availableQty, imageCount: x.imageCount || 0,
});

// Read-only catalogue: available to any logged-in student or admin (mirrors the old student portal).
router.get('/branches', async (req, res) => {
  const s = await db.collection('branches').get();
  res.json(s.docs.map((d) => ({ code: d.id, name: d.data().name })).sort((a, b) => a.code.localeCompare(b.code)));
});

router.get('/:code/components', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const s = await db.collection('components').where('branchCode', '==', code(req)).get();
  let rows = s.docs.map((d) => row(d.data()));
  if (q) rows = rows.filter((r) => [r.compId, r.name, r.category].some((v) => v.toLowerCase().includes(q)));
  res.json(rows.sort((a, b) => a.compId.localeCompare(b.compId)));
});

router.get('/:code/stats', async (req, res) => {
  const [c, i] = await Promise.all([
    db.collection('components').where('branchCode', '==', code(req)).get(),
    db.collection('issues').where('branchCode', '==', code(req)).where('status', '==', 'ISSUED').get(),
  ]);
  const sum = (f) => c.docs.reduce((n, d) => n + (d.data()[f] || 0), 0);
  res.json({
    totalItems: c.size, totalQty: sum('totalQty'), totalIssued: sum('issuedQty'),
    totalOverdue: i.docs.filter((d) => overdueInfo(d.data().dueDate.toMillis(), cfg.finePerDay).overdue).length,
  });
});

router.get('/:code/components/:cid/images', async (req, res) => {
  const s = await db.collection('componentImages').where('branchCode', '==', code(req)).where('compId', '==', req.params.cid).get();
  res.json(s.docs.map((d) => d.data()).sort((a, b) => a.order - b.order).map((d) => d.data));
});

module.exports = router;
