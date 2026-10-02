const router = require('express').Router();
const { db, FieldValue } = require('../firebase');
const { httpErr, clean } = require('../utils/http');
const { present, gatePassNo } = require('../utils/issues');
const pdf = require('../utils/pdf');
const {
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendTestNotification,
  getSubscriptionsForStudent,
} = require('../utils/notifier');

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
  for (const it of rawItems) {
    const compId = clean(it.compId);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    if (!compId) continue;

    // Look up component to ensure validity & accurate name
    const cSnap = await db.doc(`components/${branchCode}__${compId}`).get();
    if (!cSnap.exists) {
      throw httpErr(404, `Component ${compId} not found in ${branchCode} catalog.`);
    }
    const cData = cSnap.data();
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
  };

  const docRef = await db.collection('requests').add(reqDoc);
  res.status(201).json({ ok: true, id: docRef.id, request: { id: docRef.id, ...reqDoc } });
});

/* ---------- Push Notifications for Student Device/Phone ---------- */

// GET /api/me/push-key - VAPID public key for web push subscription
router.get('/push-key', async (req, res) => {
  const publicKey = await getPublicKey();
  res.json({ publicKey });
});

// GET /api/me/push-status - Check if this student has active push subscriptions
router.get('/push-status', async (req, res) => {
  const en = enrollment(req);
  const uSnap = await db.doc(`users/${req.user.uid}`).get();
  const u = uSnap.exists ? uSnap.data() : {};
  const mobile = u.mobile || '';
  const notificationsEnabled = u.notificationsEnabled !== false;
  const subs = await getSubscriptionsForStudent(en, req.user.uid, mobile);
  res.json({
    subscribed: subs.length > 0 && notificationsEnabled,
    notificationsEnabled,
    mobile: mobile || '',
    devicesCount: subs.length,
    devices: subs.map(s => ({
      id: s.id,
      deviceType: s.deviceType,
      updatedAt: s.updatedAt,
      userAgent: s.userAgent,
    })),
  });
});

// POST /api/me/push-subscribe - Register Web Push Subscription
router.post('/push-subscribe', async (req, res) => {
  const { subscription, deviceType } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw httpErr(400, 'Valid subscription object is required.');
  }
  const en = enrollment(req);
  const uSnap = await db.doc(`users/${req.user.uid}`).get();
  const u = uSnap.exists ? uSnap.data() : {};
  const mobile = u.mobile || '';

  await db.doc(`users/${req.user.uid}`).set({
    notificationsEnabled: true,
    notificationsUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const result = await saveSubscription({
    uid: req.user.uid,
    enrollmentNo: en,
    mobile,
    subscription,
    userAgent: req.headers['user-agent'] || '',
    deviceType: deviceType || 'mobile',
  });
  res.json(result);
});

// POST /api/me/push-unsubscribe - Remove subscription
router.post('/push-unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  await removeSubscription(endpoint);
  await db.doc(`users/${req.user.uid}`).set({
    notificationsEnabled: false,
    notificationsUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  res.json({ ok: true });
});

// POST /api/me/notification-toggle - Toggle mobile notification preference
router.post('/notification-toggle', async (req, res) => {
  const enabled = Boolean(req.body.enabled);
  await db.doc(`users/${req.user.uid}`).set({
    notificationsEnabled: enabled,
    notificationsUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  res.json({ ok: true, enabled });
});

// POST /api/me/push-test - Send immediate test alert to phone
router.post('/push-test', async (req, res) => {
  const en = enrollment(req);
  const result = await sendTestNotification({
    enrollmentNo: en,
    uid: req.user.uid,
  });
  res.json(result);
});

// GET /api/me/notifications - Recent in-app notifications
router.get('/notifications', async (req, res) => {
  const en = enrollment(req);
  const snap = await db.collection('notifications')
    .where('enrollmentNo', '==', en)
    .get();
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return tb - ta;
  });
  res.json(list.slice(0, 30));
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

