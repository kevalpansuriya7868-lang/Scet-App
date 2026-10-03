const router = require('express').Router({ mergeParams: true });
const { db, FieldValue, Timestamp } = require('../firebase');
const { httpErr, clean } = require('../utils/http');
const { computeDue } = require('../utils/dates');
const { gatePassNo } = require('../utils/issues');
const { sendMail, templates } = require('../utils/mailer');
const pdf = require('../utils/pdf');
const { audited } = require('../middleware/audit');

const cRef = (code, id) => db.doc(`components/${code}__${id}`);
const stock = (qty) => ({ issuedQty: FieldValue.increment(qty), availableQty: FieldValue.increment(-qty), updatedAt: FieldValue.serverTimestamp() });

async function adminEmail(username) {
  if (!username) return null;
  try {
    const s = await db.collection('users').where('username', '==', username).where('role', '==', 'admin').limit(1).get();
    if (s.empty) return null;
    const email = s.docs[0].data().email || null;
    return email && /^[^@]+@[^@]+\.[^@]+$/.test(email) ? email : null;
  } catch { return null; }
}

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

// GET /api/branches/:code/requests
router.get('/', async (req, res) => {
  const code = req.branch;
  const s = await db.collection('requests').where('branchCode', '==', code).get();
  const list = s.docs.map(d => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return tb - ta;
  });
  res.json(list);
});

// GET /api/branches/:code/requests/:id/idcard
router.get('/:id/idcard', async (req, res) => {
  const snap = await db.doc(`requests/${req.params.id}`).get();
  if (!snap.exists) throw httpErr(404, 'Request not found.');
  const r = snap.data();
  if (r.idCardImage) return res.json({ idCardImage: r.idCardImage, idCardVerified: r.idCardVerified !== false });
  // Fallback to user doc if not stored directly on request
  if (r.studentUid) {
    const uSnap = await db.doc(`users/${r.studentUid}`).get();
    if (uSnap.exists && uSnap.data().idCardImage) {
      return res.json({ idCardImage: uSnap.data().idCardImage, idCardVerified: uSnap.data().idCardVerified !== false });
    }
  }
  if (r.enrollmentNo) {
    const uSnap = await db.collection('users').where('enrollmentNo', '==', r.enrollmentNo).limit(1).get();
    if (!uSnap.empty && uSnap.docs[0].data().idCardImage) {
      return res.json({ idCardImage: uSnap.docs[0].data().idCardImage, idCardVerified: uSnap.docs[0].data().idCardVerified !== false });
    }
  }
  res.json({ idCardImage: null, idCardVerified: false });
});

// POST /api/branches/:code/requests/:id/accept (Step 2: Admin sets collection time slot)
router.post('/:id/accept', audited('STUDENT_REQUEST_ACCEPTED'), async (req, res) => {
  const code = req.branch, id = req.params.id;
  const ref = db.doc(`requests/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw httpErr(404, 'Request not found.');
  const data = snap.data();
  if (data.branchCode !== code) throw httpErr(403, 'Permission denied for this branch.');
  if (data.status === 'ISSUED') throw httpErr(409, 'This request has already been issued.');

  const collectionTime = clean(req.body.collectionTime);
  if (!collectionTime) throw httpErr(400, 'Collection time is required.');
  const collectionLocation = clean(req.body.collectionLocation) || clean(req.body.location) || 'Hardware Lab Counter';
  const collectionNote = clean(req.body.collectionNote) || '';

  await ref.update({
    status: 'ACCEPTED',
    collectionTime,
    collectionLocation,
    collectionNote,
    acceptedBy: req.user.username,
    acceptedAt: Timestamp.now(),
  });

  const studentEmail = data.studentEmail;
  if (studentEmail && templates.requestAccepted) {
    try {
      await sendMail({ to: studentEmail, ...templates.requestAccepted(data, collectionTime, `${collectionLocation}${collectionNote ? ' · ' + collectionNote : ''}`) });
    } catch (mailErr) {
      console.error('[Accept Request] Mail delivery failed:', mailErr.message);
    }
  }

  res.locals.auditDetail = `Accepted request #${id} for ${data.enrollmentNo}; collection time: ${collectionTime}; location: ${collectionLocation}`;
  res.json({ ok: true, collectionTime, collectionLocation, collectionNote });
});

// POST /api/branches/:code/requests/:id/issue (Step 3: ⚡ ONE-CLICK ISSUE)
router.post('/:id/issue', audited('ITEM_ISSUED'), async (req, res) => {
  const code = req.branch, id = req.params.id;
  const reqRef = db.doc(`requests/${id}`);
  const bRef = db.doc(`branches/${code}`);

  let issueRecord, gp;

  await db.runTransaction(async (tx) => {
    const [reqSnap, bSnap] = await Promise.all([tx.get(reqRef), tx.get(bRef)]);
    if (!reqSnap.exists) throw httpErr(404, 'Request not found.');
    if (!bSnap.exists) throw httpErr(404, 'Branch not found.');

    const reqData = reqSnap.data();
    if (reqData.branchCode !== code) throw httpErr(403, 'Permission denied for this branch.');
    if (reqData.status === 'ISSUED') throw httpErr(409, 'This request has already been issued.');

    // Check stock for all items
    const items = Array.isArray(reqData.items) && reqData.items.length > 0 ? reqData.items : [];
    if (!items.length) throw httpErr(400, 'Request has no components listed.');

    const compSnaps = await Promise.all(items.map(it => tx.get(cRef(code, it.compId))));
    compSnaps.forEach((cs, idx) => {
      const it = items[idx];
      if (!cs.exists) throw httpErr(404, `Component ${it.compId} not found in catalog.`);
      const c = cs.data();
      if (c.availableQty < it.qty)
        throw httpErr(409, `Insufficient stock for ${it.compName || it.compId}: ${c.availableQty} available, requested ${it.qty}.`);
    });

    // Increment branch sequence number
    const seq = (bSnap.data().issueSeq || 0) + 1;
    tx.update(bRef, { issueSeq: seq });

    // Deduct stock for all components
    items.forEach(it => tx.update(cRef(code, it.compId), stock(it.qty)));

    const now = Timestamp.now();
    const days = Number(reqData.days) || 7;
    const dueDate = Timestamp.fromDate(computeDue(days));

    // Construct full issue record
    issueRecord = {
      seq,
      branchCode: code,
      enrollmentNo: reqData.enrollmentNo,
      studentName: reqData.studentName,
      studentBranch: reqData.studentBranch || code,
      studentMobile: reqData.studentMobile || '',
      studentEmail: reqData.studentEmail || '',
      compId: items[0].compId,
      compName: items[0].compName || items[0].compId,
      issueQty: items[0].qty,
      items: items.map(it => ({
        compId: it.compId,
        compName: it.compName || it.compId,
        qty: it.qty,
        returnedQty: 0,
        remainingQty: it.qty
      })),
      issueDate: now,
      dueDate,
      penaltyFee: 0,
      issuedBy: req.user.username,
      status: 'ISSUED',
      returnedQty: 0,
      remainingQty: items.reduce((s, it) => s + it.qty, 0),
      fromRequestId: id,
    };

    tx.create(db.doc(`issues/${code}__${seq}`), issueRecord);

    gp = gatePassNo(issueRecord);
    tx.update(reqRef, {
      status: 'ISSUED',
      issuedBy: req.user.username,
      issuedAt: now,
      issueSeq: seq,
      gatePassNo: gp,
    });
  });


  const mail = await mailProof(issueRecord, templates.issued(issueRecord), 'GatePass');
  const itemsSummary = issueRecord.items.map(it => `${it.qty} x ${it.compName || it.compId} (${it.compId})`).join(', ');
  res.locals.auditDetail = `Issued [${itemsSummary}] to ${issueRecord.enrollmentNo} (${issueRecord.studentName}) via request #${id} - ${gp}${mailNote(mail)}`;

  res.json({ ok: true, issue: issueRecord, gatePassNo: gp, ...mail });
});

// POST /api/branches/:code/requests/:id/reject
router.post('/:id/reject', audited('STUDENT_REQUEST_REJECTED'), async (req, res) => {
  const code = req.branch, id = req.params.id;
  const ref = db.doc(`requests/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw httpErr(404, 'Request not found.');
  const data = snap.data();
  if (data.branchCode !== code) throw httpErr(403, 'Permission denied.');
  if (data.status === 'ISSUED') throw httpErr(409, 'Cannot reject an issued request.');

  const reason = clean(req.body.reason) || 'Item unavailable or allocation limit reached.';
  await ref.update({
    status: 'REJECTED',
    rejectionReason: reason,
    rejectedBy: req.user.username,
    rejectedAt: Timestamp.now()
  });


  if (data.studentEmail && templates.requestRejected) {
    try {
      await sendMail({ to: data.studentEmail, ...templates.requestRejected(data, reason) });
    } catch (mailErr) {
      console.error('[Reject Request] Mail delivery failed:', mailErr.message);
    }
  }

  res.locals.auditDetail = `Rejected request #${id} for ${data.enrollmentNo}: ${reason}`;
  res.json({ ok: true });
});

module.exports = router;
