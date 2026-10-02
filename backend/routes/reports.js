const router = require('express').Router({ mergeParams: true });
const { db } = require('../firebase');
const { httpErr } = require('../utils/http');
const { present } = require('../utils/issues');
const pdf = require('../utils/pdf');
const { audited } = require('../middleware/audit');

const components = async (code) => (await db.collection('components').where('branchCode', '==', code).get()).docs.map((d) => d.data()).sort((a, b) => a.compId.localeCompare(b.compId));

router.get('/inventory.pdf', audited('REPORT_INVENTORY_PDF'), async (req, res) => {
  pdf.send(res, pdf.inventoryReport(req.branch, await components(req.branch)), `SCET_FullStock_${req.branch}.pdf`);
});

router.get('/outstanding.pdf', audited('REPORT_OUTSTANDING_PDF'), async (req, res) => {
  const code = req.branch;
  const s = await db.collection('issues').where('branchCode', '==', code).get();
  const rows = s.docs
    .map((d) => present(d.data()))
    .filter((r) => r.status === 'ISSUED' || r.status === 'PARTIAL_RETURN')
    .sort((a, b) => (a.dueDate ? new Date(a.dueDate) : 0) - (b.dueDate ? new Date(b.dueDate) : 0));
  res.locals.auditDetail = `Outstanding report: ${rows.length} active issue(s)`;
  pdf.send(res, pdf.outstandingReport(code, rows), `SCET_Outstanding_Issued_${code}.pdf`);
});

router.get('/procurement.pdf', audited('REPORT_PROCUREMENT_PDF'), async (req, res) => {
  const th = Number(req.query.threshold ?? 3);
  if (!Number.isInteger(th) || th < 0) throw httpErr(400, 'Threshold must be a non-negative whole number.');
  const low = (await components(req.branch)).filter((c) => c.availableQty <= th).sort((a, b) => a.availableQty - b.availableQty);
  if (!low.length) throw httpErr(404, `All components have more than ${th} units available.`);
  res.locals.auditDetail = `Threshold ${th}: ${low.length} item(s)`;
  pdf.send(res, pdf.procurementSlip(req.branch, th, low), `SCET_Procurement_${req.branch}.pdf`);
});

// Replaces the Oracle dump: a JSON snapshot of this branch (images excluded to keep it small).
router.get('/backup.json', audited('BRANCH_BACKUP_EXPORT'), async (req, res) => {
  const code = req.branch;
  const [b, comps, iss] = await Promise.all([db.doc(`branches/${code}`).get(), components(code), db.collection('issues').where('branchCode', '==', code).get()]);
  const { passwordHash, ...branch } = b.data();
  res.setHeader('Content-Disposition', `attachment; filename="SCET_backup_${code}.json"`);
  res.json({ exportedAt: new Date().toISOString(), branch, components: comps, issues: iss.docs.map((d) => present(d.data())) });
});
module.exports = router;
