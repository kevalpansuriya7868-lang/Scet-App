const router = require('express').Router({ mergeParams: true });
const students = require('express').Router({ mergeParams: true });
const cfg = require('../config');
const { db, FieldValue, Timestamp } = require('../firebase');
const { httpErr, clean } = require('../utils/http');
const { computeDue, overdueInfo } = require('../utils/dates');
const { present, gatePassNo } = require('../utils/issues');
const { sendMail, templates } = require('../utils/mailer');
const pdf = require('../utils/pdf');
const { audited } = require('../middleware/audit');

const MOBILE_RE = /^\d{10}$/;
const EMAIL_RE = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const CONDITIONS = ['Working', 'Damaged', 'Burnt', 'Lost'];
const iRef = (code, seq) => db.doc(`issues/${code}__${seq}`);
const cRef = (code, id) => db.doc(`components/${code}__${id}`);
const stock = (qty) => ({ issuedQty: FieldValue.increment(qty), availableQty: FieldValue.increment(-qty), updatedAt: FieldValue.serverTimestamp() });

/**
 * Parse & validate the student fields from request body.
 * Returns { studentFields, items, days }.
 * `items` is an array of { compId, qty } — at least one required.
 */
function parse(b) {
  const studentFields = {
    enrollmentNo: clean(b.enrollmentNo).toUpperCase(),
    studentName: clean(b.studentName),
    studentBranch: clean(b.studentBranch),
    studentMobile: clean(b.studentMobile),
    studentEmail: clean(b.studentEmail),
  };
  if (!studentFields.enrollmentNo || !studentFields.studentName || !studentFields.studentBranch || !studentFields.studentMobile || !studentFields.studentEmail)
    throw httpErr(400, 'All student fields are required.');
  if (!MOBILE_RE.test(studentFields.studentMobile)) throw httpErr(400, 'Mobile number must be exactly 10 digits.');
  if (!EMAIL_RE.test(studentFields.studentEmail)) throw httpErr(400, 'Invalid email address format.');

  const days = b.days === '' || b.days == null ? 0 : Number(b.days);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw httpErr(400, 'Duration must be a whole number of days (0-365).');

  // Support multi-item: body.items = [{compId, qty}, ...] OR legacy body.compId/body.qty
  let items;
  if (Array.isArray(b.items) && b.items.length > 0) {
    items = b.items.map((it, idx) => {
      const compId = clean(it.compId);
      const qty = Number(it.qty);
      if (!compId) throw httpErr(400, `Item ${idx + 1}: compId is required.`);
      if (!Number.isInteger(qty) || qty <= 0) throw httpErr(400, `Item ${idx + 1} (${compId}): quantity must be a positive integer.`);
      return { compId, qty };
    });
  } else if (clean(b.compId)) {
    // Legacy single-component form
    const compId = clean(b.compId);
    const qty = Number(b.qty);
    if (!Number.isInteger(qty) || qty <= 0) throw httpErr(400, 'Quantity must be a positive integer.');
    items = [{ compId, qty }];
  } else {
    throw httpErr(400, 'At least one component is required.');
  }

  // No duplicate compIds
  const ids = items.map((it) => it.compId);
  if (new Set(ids).size !== ids.length) throw httpErr(400, 'Duplicate components are not allowed. Adjust the quantity instead.');

  return { studentFields, items, days };
}

/** Look up an admin's real email by username. Returns null if not found or no email set. */
async function adminEmail(username) {
  if (!username) return null;
  try {
    const s = await db.collection('users').where('username', '==', username).where('role', '==', 'admin').limit(1).get();
    if (s.empty) return null;
    const email = s.docs[0].data().email || null;
    return email && /^[^@]+@[^@]+\.[^@]+$/.test(email) ? email : null;
  } catch { return null; }
}

/**
 * Email the student a PDF proof AND silently CC the issuing admin.
 * Never throws.
 */
async function mailProof(rec, tpl, label) {
  try {
    const buf = await pdf.toBuffer(pdf.gatePass(rec));
    const adminAddr = await adminEmail(rec.issuedBy);
    const to = adminAddr ? [rec.studentEmail, adminAddr].join(',') : rec.studentEmail;
    const r = await sendMail({ to, ...tpl, attachments: [{ filename: `${label}_${gatePassNo(rec)}.pdf`, content: buf }] });
    return { emailed: r.ok, emailError: r.ok ? undefined : r.error };
  } catch (e) {
    return { emailed: false, emailError: e.message };
  }
}
const mailNote = (m) => (m.emailed ? '; proof emailed to student + admin' : `; EMAIL FAILED (${m.emailError})`);

const loadIssue = async (code, seq) => {
  const s = await iRef(code, seq).get();
  if (!s.exists) throw httpErr(404, 'Issue record not found.');
  return s.data();
};

/* List / search (search doubles as the Student History view) */
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const s = await db.collection('issues').where('branchCode', '==', req.branch).get();
  let rows = s.docs.map((d) => present(d.data()));
  if (req.query.overdue === '1') rows = rows.filter((r) => r.status === 'ISSUED' && r.overdue);
  if (q) rows = rows.filter((r) => r.enrollmentNo.toLowerCase().includes(q) || r.studentName.toLowerCase().includes(q));
  res.json(rows.sort((a, b) => b.seq - a.seq));
});

/**
 * Issue: stock checks for ALL items, borrow-limit check, and sequence number all in ONE transaction.
 * One gate pass = one issue record regardless of how many component types are in it.
 */
router.post('/', audited('ITEM_ISSUED'), async (req, res) => {
  const code = req.branch;
  const { studentFields, items, days } = parse(req.body);

  const issue = await db.runTransaction(async (tx) => {
    // Check borrow limit (counts open issue records, not individual components)
    const active = await tx.get(db.collection('issues').where('enrollmentNo', '==', studentFields.enrollmentNo).where('status', '==', 'ISSUED'));
    if (active.size >= cfg.borrowLimit)
      throw httpErr(409, `Student ${studentFields.enrollmentNo} already has ${active.size} active issue record(s). Max limit is ${cfg.borrowLimit} gate passes.`);

    const [b, ...compSnaps] = await Promise.all([
      tx.get(db.doc(`branches/${code}`)),
      ...items.map((it) => tx.get(cRef(code, it.compId))),
    ]);

    // Validate stock for every item
    const enrichedItems = compSnaps.map((c, idx) => {
      if (!c.exists) throw httpErr(404, `Component ${items[idx].compId} not found.`);
      if (c.data().availableQty < items[idx].qty)
        throw httpErr(409, `Not enough available units for ${items[idx].compId} in [${code}] (need ${items[idx].qty}, have ${c.data().availableQty}).`);
      return { compId: items[idx].compId, compName: c.data().name, qty: items[idx].qty };
    });

    const seq = (b.data().issueSeq || 0) + 1;
    const rec = {
      seq, branchCode: code, ...studentFields,
      // Multi-item storage
      items: enrichedItems,
      // Legacy compat fields (first item) so old code/PDFs/reports don't break
      compId: enrichedItems[0].compId, compName: enrichedItems[0].compName, issueQty: enrichedItems[0].qty,
      issueDate: Timestamp.now(), dueDate: Timestamp.fromDate(computeDue(days)),
      status: 'ISSUED', returnDate: null, returnedQty: 0, returnCondition: 'Pending', penaltyFee: 0,
      issuedBy: req.user.username,
    };

    tx.update(db.doc(`branches/${code}`), { issueSeq: seq });
    // Decrement stock for every item
    enrichedItems.forEach((it) => tx.update(cRef(code, it.compId), stock(it.qty)));
    tx.create(iRef(code, seq), rec);
    return rec;
  });

  const itemsSummary = issue.items.map((it) => `${it.qty} x ${it.compName || it.compId} (${it.compId})`).join(', ');
  const mail = await mailProof(issue, templates.issued(issue), 'GatePass');
  res.locals.auditDetail = `Issued [${itemsSummary}] to ${studentFields.enrollmentNo} (${studentFields.studentName}) for ${days} day(s) - ${gatePassNo(issue)}${mailNote(mail)}`;
  res.status(201).json({ ...present(issue), ...mail });
});

/**
 * Edit: ONLY the duration (days / dueDate) can be updated after issue.
 * All other fields (student, components) are locked once the gate pass is created.
 */
router.put('/:seq', audited('ISSUE_RECORD_EDITED'), async (req, res) => {
  const code = req.branch;
  const seq = req.params.seq;
  const days = req.body.days === '' || req.body.days == null ? 0 : Number(req.body.days);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw httpErr(400, 'Duration must be a whole number of days (0-365).');

  await db.runTransaction(async (tx) => {
    const ref = iRef(code, seq);
    const s = await tx.get(ref);
    if (!s.exists) throw httpErr(404, 'Issue record not found.');
    const old = s.data();
    if (old.status !== 'ISSUED' && old.status !== 'PARTIAL_RETURN')
      throw httpErr(409, 'Only active (ISSUED) records can have their duration updated.');
    tx.update(ref, { dueDate: Timestamp.fromDate(computeDue(days)) });
  });

  const fresh = await loadIssue(code, seq);
  const freshPresented = present(fresh);
  const mail = await mailProof(freshPresented, templates.updated(freshPresented, req.user.username), 'UpdatedGatePass');
  res.locals.auditDetail = `Updated duration of issue #${seq} to ${days} day(s)${mailNote(mail)}`;
  res.json({ ok: true, ...mail });
});

/* Return: per-item quantities + per-item conditions.
   Client sends itemReturns:[{compId, returnQty, condition}].
   Overall returnCondition is computed as worst (highest severity) among returned items. */
router.post('/:seq/return', audited('ITEM_RETURNED'), async (req, res) => {
  const code = req.branch, seq = req.params.seq;
  // Severity map for computing overall condition
  const SEVERITY = { Working: 0, Damaged: 1, Burnt: 2, Lost: 3 };
  const worstCondition = (conds) => conds.reduce((w, c) => SEVERITY[c] > SEVERITY[w] ? c : w, 'Working');

  let out, fine, totalReturnQty, totalRemainingQty;
  const retTs = Timestamp.now();

  await db.runTransaction(async (tx) => {
    const s = await tx.get(iRef(code, seq));
    if (!s.exists) throw httpErr(404, 'Issue record not found.');
    out = s.data();
    if (out.status === 'RETURNED') throw httpErr(409, 'This record has already been fully returned.');

    fine = overdueInfo(out.dueDate.toMillis(), cfg.finePerDay).fine;

    // Normalise items with per-item return state
    const rawItems = Array.isArray(out.items) && out.items.length > 0
      ? out.items
      : [{ compId: out.compId, compName: out.compName, qty: out.issueQty }];
    const currentItems = rawItems.map((it) => ({
      ...it,
      returnedQty: it.returnedQty || 0,
      remainingQty: it.remainingQty ?? it.qty,
    }));

    // Build a return map: compId -> { qty, condition, conditions }
    let returnMap = {};
    if (Array.isArray(req.body.itemReturns) && req.body.itemReturns.length > 0) {
      req.body.itemReturns.forEach((ir) => {
        const c = clean(ir.condition) || 'Working';
        const q = Number(ir.returnQty);
        let condMap = {};
        if (ir.conditions && typeof ir.conditions === 'object') {
          CONDITIONS.forEach((cd) => {
            const count = Number(ir.conditions[cd]) || 0;
            if (count > 0) condMap[cd] = count;
          });
        }
        if (Object.keys(condMap).length === 0 && q > 0) {
          condMap[c] = q;
        }
        returnMap[ir.compId] = { qty: q, condition: c, conditions: condMap };
      });
    } else if (req.body.returnQty != null && currentItems.length === 1) {
      // Legacy single-component fallback
      const c = clean(req.body.condition) || 'Working';
      const q = Number(req.body.returnQty);
      returnMap[currentItems[0].compId] = { qty: q, condition: c, conditions: { [c]: q } };
    } else {
      // Default: return everything, default condition Working
      currentItems.forEach((it) => { returnMap[it.compId] = { qty: it.remainingQty, condition: 'Working', conditions: { Working: it.remainingQty } }; });
    }

    const cumulativeIssueConditions = { ...(out.conditions || (out.returnCondition && out.returnedQty ? { [out.returnCondition]: out.returnedQty } : {})) };
    totalReturnQty = 0;
    totalRemainingQty = 0;
    const updatedItems = currentItems.map((it) => {
      const entry = returnMap[it.compId] ?? { qty: 0, condition: 'Working', conditions: {} };
      const rQty = entry.qty;
      if (!Number.isInteger(rQty) || rQty < 0) throw httpErr(400, `Return qty for ${it.compId} must be a non-negative integer.`);
      if (rQty > it.remainingQty) throw httpErr(400, `Return qty for ${it.compId} (${rQty}) exceeds remaining (${it.remainingQty}).`);
      const newReturned = it.returnedQty + rQty;
      const newRemaining = it.qty - newReturned;

      // Cumulative condition breakdown for this item
      const itemConds = { ...(it.conditions || (it.returnCondition && it.returnedQty ? { [it.returnCondition]: it.returnedQty } : {})) };
      if (rQty > 0) {
        tx.update(cRef(code, it.compId), stock(-rQty));
        Object.entries(entry.conditions).forEach(([cond, cnt]) => {
          if (cnt > 0) {
            itemConds[cond] = (itemConds[cond] || 0) + cnt;
            cumulativeIssueConditions[cond] = (cumulativeIssueConditions[cond] || 0) + cnt;
          }
        });
      }
      totalReturnQty += rQty;
      totalRemainingQty += newRemaining;

      // Determine worst condition seen on this item so far
      const activeConds = Object.keys(itemConds).filter((k) => itemConds[k] > 0);
      const itemWorst = activeConds.length ? worstCondition(activeConds) : 'Working';

      return {
        ...it,
        returnedQty: newReturned,
        remainingQty: newRemaining,
        returnCondition: itemWorst,
        conditions: itemConds,
      };
    });

    if (totalReturnQty === 0) throw httpErr(400, 'At least one unit must be returned.');

    const allActiveIssueConds = Object.keys(cumulativeIssueConditions).filter((k) => cumulativeIssueConditions[k] > 0);
    const overallCondition = allActiveIssueConds.length ? worstCondition(allActiveIssueConds) : 'Working';

    const totalReturnedSoFar = updatedItems.reduce((s, it) => s + it.returnedQty, 0);
    const isFullReturn = totalRemainingQty === 0;
    tx.update(iRef(code, seq), {
      status: isFullReturn ? 'RETURNED' : 'PARTIAL_RETURN',
      returnDate: retTs,
      returnedQty: totalReturnedSoFar,
      remainingQty: totalRemainingQty,
      returnCondition: overallCondition,
      conditions: cumulativeIssueConditions,
      penaltyFee: fine,
      items: updatedItems,
      returnedBy: req.user.username,
      ...(isFullReturn ? {} : { lastPartialReturn: retTs }),
    });
  });

  const isFullReturn = totalRemainingQty === 0;
  const overallCond = (Array.isArray(req.body.itemReturns) ? req.body.itemReturns : []).map(ir => ir.condition).filter(Boolean);
  const displayCond = overallCond.length ? worstCondition(overallCond) : 'Working';
  const closed = { ...out, status: isFullReturn ? 'RETURNED' : 'PARTIAL_RETURN', returnDate: retTs, returnedQty: (out.returnedQty || 0) + totalReturnQty, remainingQty: totalRemainingQty, returnCondition: displayCond, penaltyFee: fine, returnedBy: req.user.username };
  const mail = isFullReturn ? await mailProof(closed, templates.returned(closed, displayCond, fine), 'ReturnReceipt') : { ok: false, emailed: false };
  let itemsSummary;
  let conditionBreakdownText = displayCond;

  if (Array.isArray(req.body.itemReturns) && req.body.itemReturns.length > 0) {
    const returnedItems = req.body.itemReturns.filter(ir => Number(ir.returnQty) > 0);
    if (returnedItems.length > 0) {
      itemsSummary = returnedItems.map(ir => {
        const itemObj = (out.items || []).find(it => it.compId === ir.compId);
        const name = itemObj?.compName || ir.compId;
        let condsStr = '';
        if (ir.conditions && typeof ir.conditions === 'object') {
          const cParts = Object.entries(ir.conditions)
            .filter(([_, cnt]) => Number(cnt) > 0)
            .map(([k, cnt]) => `${cnt} ${k}`);
          if (cParts.length > 0) condsStr = ` (${cParts.join(', ')})`;
        }
        if (!condsStr && ir.condition) condsStr = ` (${ir.returnQty} ${ir.condition})`;
        return `${ir.returnQty} x ${name} (${ir.compId})${condsStr}`;
      }).join(', ');

      const totalCondCounts = {};
      returnedItems.forEach(ir => {
        if (ir.conditions && typeof ir.conditions === 'object') {
          Object.entries(ir.conditions).forEach(([k, cnt]) => {
            const n = Number(cnt) || 0;
            if (n > 0) totalCondCounts[k] = (totalCondCounts[k] || 0) + n;
          });
        } else if (ir.condition && Number(ir.returnQty) > 0) {
          totalCondCounts[ir.condition] = (totalCondCounts[ir.condition] || 0) + Number(ir.returnQty);
        }
      });
      const condList = Object.entries(totalCondCounts).map(([k, cnt]) => `${cnt} ${k}`);
      if (condList.length > 0) conditionBreakdownText = condList.join(', ');
    }
  }

  if (!itemsSummary) {
    itemsSummary = Array.isArray(out.items) && out.items.length > 0
      ? out.items.map((it) => `${it.compName || it.compId} (${it.compId})`).join(', ')
      : `${out.compName || out.compId} (${out.compId})`;
  }

  res.locals.auditDetail = `Returned ${totalReturnQty} unit(s) of [${itemsSummary}] (${out.enrollmentNo}${out.studentName ? ` - ${out.studentName}` : ''}) as ${conditionBreakdownText}; remaining: ${totalRemainingQty}; fine Rs.${fine}${isFullReturn ? mailNote(mail) : ''}`;
  res.json({ ok: true, fine, totalReturnQty, totalRemainingQty, isFullReturn, ...mail });
});

const DELETE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

router.delete('/:seq', audited('ISSUE_RECORD_DELETED'), async (req, res) => {
  const code = req.branch, seq = req.params.seq;
  let out;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(iRef(code, seq));
    if (!s.exists) throw httpErr(404, 'Issue record not found.');
    out = s.data();
    // Enforce 10-minute delete window — server-side hard check
    const issuedMs = out.issueDate?.toMillis?.() || 0;
    if (Date.now() - issuedMs > DELETE_WINDOW_MS)
      throw httpErr(403, 'This record can no longer be deleted. Records may only be deleted within 10 minutes of issue.');
    if (out.status === 'ISSUED') {
      // Restore stock for all items
      const items = Array.isArray(out.items) && out.items.length > 0 ? out.items : [{ compId: out.compId, qty: out.issueQty }];
      items.forEach((it) => tx.update(cRef(code, it.compId), stock(-it.qty)));
    }
    tx.delete(iRef(code, seq));
  });
  const itemsSummary = Array.isArray(out.items) && out.items.length > 0 ? out.items.map((it) => it.compId).join(', ') : out.compId;
  res.locals.auditDetail = `Deleted issue #${seq} (${out.enrollmentNo}, [${itemsSummary}])`;
  res.json({ ok: true });
});

router.get('/:seq/gatepass', async (req, res, next) => {
  try {
    const i = await loadIssue(req.branch, req.params.seq);
    pdf.send(res, pdf.gatePass(i), `${gatePassNo(i)}.pdf`);
  } catch (e) {
    next(e);
  }
});

/* Overdue reminders (batch) */
router.post('/reminders/send', audited('OVERDUE_REMINDERS_SENT'), async (req, res) => {
  const s = await db.collection('issues').where('branchCode', '==', req.branch).where('status', 'in', ['ISSUED', 'PARTIAL_RETURN']).get();
  const late = s.docs.map((d) => d.data()).map((x) => ({ x, o: overdueInfo(x.dueDate.toMillis(), cfg.finePerDay) })).filter((r) => r.o.overdue);
  setImmediate(async () => {
    for (const { x, o } of late) {
      const studentTo = x.studentEmail || `${x.enrollmentNo.toLowerCase()}@scet.ac.in`;
      await sendMail({ to: studentTo, ...templates.overdue(x, o.daysLate, o.fine) });
      const aEmail = await adminEmail(x.issuedBy);
      if (aEmail && templates.overdueAdmin) await sendMail({ to: aEmail, ...templates.overdueAdmin(x, o.daysLate, o.fine) });
    }
  });
  res.locals.auditDetail = `Queued ${late.length} overdue reminder email(s)`;
  res.json({ queued: late.length });
});

/* No-dues clearance: ?check=1 returns JSON eligibility, otherwise the certificate PDF. */
students.get('/:enroll/no-dues', audited('NO_DUES_CERTIFICATE'), async (req, res) => {
  const code = req.branch, enroll = clean(req.params.enroll).toUpperCase();
  const s = await db.collection('issues').where('branchCode', '==', code).where('enrollmentNo', '==', enroll).get();
  const all = s.docs.map((d) => d.data());
  const pending = all.filter((x) => x.status === 'ISSUED');
  const name = all[0]?.studentName || 'Enrolled Student';
  if (pending.length) {
    const pendingSummary = pending.map((p) => {
      const items = Array.isArray(p.items) && p.items.length > 0 ? p.items : [{ compId: p.compId, qty: p.issueQty }];
      return items.map((it) => `${it.compId} x${it.qty}`).join(', ');
    }).join(' | ');
    return res.status(409).json({ error: `Student ${enroll} (${name}) has ${pending.length} unreturned gate pass(es): ${pendingSummary}.`, eligible: false });
  }
  if (req.query.check) return res.json({ eligible: true, name });
  res.locals.auditDetail = `Issued no-dues certificate for ${enroll}`;
  pdf.send(res, pdf.noDues(code, enroll, name, all[0]?.studentBranch || code), `NoDues_${enroll}_${code}.pdf`);
});

module.exports = router;
module.exports.students = students;
