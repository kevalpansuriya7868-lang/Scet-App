const cfg = require('../config');
const { overdueInfo } = require('./dates');

const iso = (t) => (t ? t.toDate().toISOString() : null);
const gatePassNo = (x) => `SCET-GP-${x.branchCode}-${x.seq}`;

/**
 * Normalise a Firestore issue doc so it always exposes the `items` array.
 * Each item gets returnedQty + remainingQty so the frontend can do per-item returns.
 * Old records had flat compId/compName/issueQty — we wrap them transparently.
 */
function normaliseItems(x) {
  if (Array.isArray(x.items) && x.items.length > 0) {
    return x.items.map((it) => {
      const returnedQty = it.returnedQty || 0;
      const conditions = it.conditions || (it.returnCondition && returnedQty ? { [it.returnCondition]: returnedQty } : {});
      return {
        ...it,
        returnedQty,
        remainingQty: it.remainingQty ?? it.qty,
        returnCondition: it.returnCondition || null,
        conditions,
      };
    });
  }
  // Legacy single-component record
  const qty = x.issueQty || 1;
  const returnedQty = x.status === 'RETURNED' ? qty : (x.returnedQty || 0);
  const conditions = x.conditions || (x.returnCondition && returnedQty ? { [x.returnCondition]: returnedQty } : {});
  return [{ compId: x.compId, compName: x.compName, qty, returnedQty, remainingQty: qty - returnedQty, returnCondition: x.returnCondition || null, conditions }];
}

/** Firestore issue doc -> API shape, with live overdue/fine computed server-side. */
function present(x) {
  const open = x.status === 'ISSUED' || x.status === 'PARTIAL_RETURN';
  const info = open ? overdueInfo(x.dueDate.toMillis(), cfg.finePerDay) : { overdue: false, daysLate: 0, fine: x.penaltyFee || 0 };
  const items = normaliseItems(x);
  const conditions = x.conditions || (x.returnCondition && (x.returnedQty || 0) > 0 ? { [x.returnCondition]: x.returnedQty } : {});
  return {
    seq: x.seq, gatePassNo: gatePassNo(x), branchCode: x.branchCode,
    enrollmentNo: x.enrollmentNo, studentName: x.studentName, studentBranch: x.studentBranch,
    studentMobile: x.studentMobile, studentEmail: x.studentEmail,
    // Multi-item fields
    items,
    // Legacy compat: expose first item's fields so old code doesn't break
    compId: items[0]?.compId || x.compId, compName: items[0]?.compName || x.compName,
    issueQty: items[0]?.qty || x.issueQty,
    issueDate: iso(x.issueDate), dueDate: iso(x.dueDate), returnDate: iso(x.returnDate),
    status: x.status, returnedQty: x.returnedQty || 0, remainingQty: x.remainingQty ?? (items[0]?.qty || x.issueQty),
    returnCondition: x.returnCondition,
    conditions,
    issuedBy: x.issuedBy, returnedBy: x.returnedBy || null, overdue: info.overdue, daysLate: info.daysLate,
    fine: open ? info.fine : x.penaltyFee || 0,
  };
}
module.exports = { present, gatePassNo, iso, normaliseItems };
