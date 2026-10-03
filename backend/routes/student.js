const router = require('express').Router();
const { db, FieldValue } = require('../firebase');
const { httpErr, clean } = require('../utils/http');
const { present, gatePassNo } = require('../utils/issues');
const pdf = require('../utils/pdf');

// A student's username IS their (lower-cased) enrollment number, set at sign-up.
const enrollment = (req) => req.user.username.toUpperCase();

router.get('/issues', async (req, res) => {
  const s = await db.collection('issues').where('enrollmentNo', '==', enrollment(req)).get();
  res.json(s.docs.map((d) => present(d.data())).sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate)));
});

router.get('/issues/:code/:seq/gatepass', async (req, res) => {
  const s = await db.doc(`issues/${String(req.params.code).toUpperCase()}__${req.params.seq}`).get();
  if (!s.exists || s.data().enrollmentNo !== enrollment(req)) throw httpErr(404, 'Record not found.');
  pdf.send(res, pdf.gatePass(s.data()), `${gatePassNo(s.data())}.pdf`);
});

router.get('/requests', async (req, res) => {
  const en = enrollment(req);
  const s = await db.collection('requests').where('enrollmentNo', '==', en).get();
  const list = s.docs.map(d => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return tb - ta;
  });
  res.json(list);
});

router.post('/requests', async (req, res) => {
  const userSnap = await db.doc(`users/${req.user.uid}`).get();
  const u = userSnap.exists ? userSnap.data() : {};
  const en = u.enrollmentNo || enrollment(req);

  const branchCode = clean(req.body.branchCode || u.branch || '').toUpperCase();
  if (!branchCode) throw httpErr(400, 'Branch code is required.');

  // Parse items
  let rawItems = req.body.items;
  if (!Array.isArray(rawItems) || !rawItems.length) {
    if (req.body.compId) {
      rawItems = [{ compId: req.body.compId, compName: req.body.compName, qty: Number(req.body.qty) || 1 }];
    } else {
      throw httpErr(400, 'Please select at least one component to request.');
    }
  }

  const items = [];
  const compTotals = {};
  for (const it of rawItems) {
    const compId = clean(it.compId);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    if (!compId) continue;

    compTotals[compId] = (compTotals[compId] || 0) + qty;

    // Look up component to ensure validity & accurate name
    const cSnap = await db.doc(`components/${branchCode}__${compId}`).get();
    if (!cSnap.exists) {
      throw httpErr(404, `Component ${compId} not found in ${branchCode} catalog.`);
    }
    const cData = cSnap.data();
    const available = typeof cData.availableQty === 'number' ? cData.availableQty : 0;
    if (available <= 0) {
      throw httpErr(409, `Component ${cData.name || compId} is currently out of stock.`);
    }
    if (compTotals[compId] > available) {
      throw httpErr(409, `Requested quantity (${compTotals[compId]}) exceeds available stock (${available}) for ${cData.name || compId}.`);
    }

    items.push({
      compId,
      compName: cData.name || clean(it.compName) || compId,
      qty
    });
  }

  if (!items.length) throw httpErr(400, 'At least one valid component is required.');

  const days = Math.min(30, Math.max(1, parseInt(req.body.days, 10) || 7));
  const purpose = clean(req.body.purpose) || 'Academic / Lab Project';

  const reqDoc = {
    branchCode,
    enrollmentNo: en,
    studentName: u.displayName || u.username || 'Student',
    studentBranch: u.branch || branchCode,
    studentMobile: u.mobile || '',
    studentEmail: u.email || '',
    items,
    days,
    purpose,
    status: 'PENDING',
    createdAt: FieldValue.serverTimestamp(),
    studentUid: req.user.uid,
    idCardImage: u.idCardImage || '',
    idCardVerified: !!u.idCardVerified,
  };

  const docRef = await db.collection('requests').add(reqDoc);
  res.status(201).json({ ok: true, id: docRef.id, request: { id: docRef.id, ...reqDoc } });
});


// GET /api/me/profile - Fetch student profile
router.get('/profile', async (req, res) => {
  if (!req.user) throw httpErr(401, 'Please log in.');
  const userSnap = await db.doc(`users/${req.user.uid}`).get();
  if (!userSnap.exists) throw httpErr(404, 'User not found.');
  const u = userSnap.data();
  res.json({
    displayName: u.displayName || '',
    enrollmentNo: u.enrollmentNo || req.user.username.toUpperCase(),
    email: u.email || '',
    mobile: u.mobile || '',
    branch: u.branch || '',
    createdAt: u.createdAt || null,
  });
});

// PUT /api/me/profile - Update student profile (Full name, mobile, branch)
router.put('/profile', async (req, res) => {
  if (!req.user) throw httpErr(401, 'Please log in.');
  const userRef = db.doc(`users/${req.user.uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw httpErr(404, 'User not found.');
  const u = userSnap.data();

  const displayName = clean(req.body.displayName);
  const branch = clean(req.body.branch).toUpperCase();
  const mobile = clean(req.body.mobile);

  if (!displayName) throw httpErr(400, 'Full name cannot be empty.');
  if (!branch) throw httpErr(400, 'Branch / department cannot be empty.');
  if (!/^\d{10}$/.test(mobile)) throw httpErr(400, 'Mobile number must be exactly 10 digits.');

  // Uniqueness check for mobile number if changed
  if (mobile !== u.mobile) {
    const mobileSnap = await db.collection('users')
      .where('role', '==', 'student')
      .where('mobile', '==', mobile)
      .limit(1).get();
    if (!mobileSnap.empty && mobileSnap.docs[0].id !== req.user.uid) {
      throw httpErr(409, 'Another account is already registered with this mobile number.');
    }
  }

  // NOTE: Enrollment number and Email are locked and cannot be modified
  await userRef.update({
    displayName,
    branch,
    mobile,
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    const { auth } = require('../firebase');
    await auth.updateUser(req.user.uid, { displayName });
  } catch (authErr) {
    console.warn('[Profile Update] Auth update warning:', authErr.message);
  }

  res.json({
    ok: true,
    profile: {
      displayName,
      enrollmentNo: u.enrollmentNo || req.user.username.toUpperCase(),
      email: u.email || '',
      mobile,
      branch,
    },
  });
});

module.exports = router;

