try { require('dotenv').config(); } catch { /* dotenv optional */ }
const crypto = require('crypto');
const webpush = require('web-push');
const { db, FieldValue } = require('../firebase');
const { sendAutomatedWhatsApp } = require('./whatsapp');

let vapidInitialized = false;
let vapidKeys = null;

/**
 * Ensures VAPID keys are loaded and webpush is initialized.
 * Persistent across server restarts via Firestore 'meta/vapid' or .env.
 */
async function ensureVapid() {
  if (vapidInitialized && vapidKeys) return vapidKeys;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  } else {
    try {
      const docRef = db.doc('meta/vapid');
      const snap = await docRef.get();
      if (snap.exists && snap.data()?.publicKey && snap.data()?.privateKey) {
        vapidKeys = {
          publicKey: snap.data().publicKey,
          privateKey: snap.data().privateKey,
        };
      } else {
        const generated = webpush.generateVAPIDKeys();
        vapidKeys = {
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
        };
        await docRef.set({
          ...vapidKeys,
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log('[Push Notifier] Generated new VAPID keys and stored in meta/vapid');
      }
    } catch (err) {
      console.error('[Push Notifier] Error reading/saving VAPID in Firestore:', err.message);
      if (!vapidKeys) {
        const generated = webpush.generateVAPIDKeys();
        vapidKeys = {
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
        };
      }
    }
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:lab-admin@scet.ac.in',
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
    vapidInitialized = true;
  } catch (err) {
    console.error('[Push Notifier] Failed to set VAPID details:', err.message);
  }

  return vapidKeys;
}

/** Get public key to send to frontend */
async function getPublicKey() {
  const keys = await ensureVapid();
  return keys.publicKey;
}

/** Hash endpoint to create stable doc ID */
function subDocId(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
}

/**
 * Register or update a student's push subscription
 */
async function saveSubscription({ uid, enrollmentNo, mobile, subscription, userAgent, deviceType }) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('Invalid subscription object.');
  }
  await ensureVapid();

  const id = subDocId(subscription.endpoint);
  const docRef = db.doc(`push_subscriptions/${id}`);
  await docRef.set({
    id,
    uid: uid || null,
    enrollmentNo: String(enrollmentNo || '').toUpperCase(),
    mobile: mobile ? String(mobile).replace(/\D/g, '').slice(-10) : '',
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    userAgent: userAgent || '',
    deviceType: deviceType || 'mobile',
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, id };
}

/**
 * Delete a push subscription
 */
async function removeSubscription(endpoint) {
  if (!endpoint) return { ok: true };
  const id = subDocId(endpoint);
  await db.doc(`push_subscriptions/${id}`).delete().catch(() => {});
  return { ok: true };
}

/**
 * Query all active push subscriptions for a student (by enrollment, uid, or mobile number)
 */
async function getSubscriptionsForStudent(enrollmentNo, uid, mobile) {
  const en = String(enrollmentNo || '').toUpperCase();
  const cleanMob = mobile ? String(mobile).replace(/\D/g, '').slice(-10) : '';
  const subs = new Map();

  if (en) {
    const sSnap = await db.collection('push_subscriptions').where('enrollmentNo', '==', en).get();
    sSnap.forEach(d => subs.set(d.id, { docRef: d.ref, ...d.data() }));
  }

  if (uid) {
    const uSnap = await db.collection('push_subscriptions').where('uid', '==', uid).get();
    uSnap.forEach(d => subs.set(d.id, { docRef: d.ref, ...d.data() }));
  }

  if (cleanMob) {
    const mSnap = await db.collection('push_subscriptions').where('mobile', '==', cleanMob).get();
    mSnap.forEach(d => subs.set(d.id, { docRef: d.ref, ...d.data() }));
  }

  return Array.from(subs.values());
}

/**
 * Send push notification to a specific student's mobile/devices
 */
async function sendPushToStudent({ enrollmentNo, uid, mobile, payload }) {
  await ensureVapid();
  const subs = await getSubscriptionsForStudent(enrollmentNo, uid, mobile);
  if (!subs.length) {
    console.log(`[Push Notifier] No push subscriptions found for ${enrollmentNo || uid || mobile}`);
    return { ok: true, sent: 0, total: 0, reason: 'No registered devices' };
  }

  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: sub.keys,
      }, payloadStr, {
        TTL: 60 * 60 * 24, // 24 hours
        urgency: 'high',
      });
      sent++;
    } catch (err) {
      failed++;
      console.warn(`[Push Notifier] Delivery failed for ${sub.id}:`, err.statusCode || err.message);
      // Clean up dead subscriptions
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sub.docRef.delete().catch(() => {});
        console.log(`[Push Notifier] Pruned expired subscription ${sub.id}`);
      }
    }
  }));

  return { ok: true, sent, failed, total: subs.length };
}

/**
 * Store in-app notification for student activity center
 */
async function recordNotification({ enrollmentNo, uid, title, body, type, data }) {
  try {
    await db.collection('notifications').add({
      enrollmentNo: String(enrollmentNo || '').toUpperCase(),
      uid: uid || null,
      title,
      body,
      type: type || 'REQUEST_STATUS',
      data: data || {},
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[Push Notifier] Failed to record in-app notification:', err.message);
  }
}

/**
 * Dispatches notification when a request is ACCEPTED
 */
async function notifyStudentRequestAccepted({ request, collectionTime, collectionLocation, collectionNote, acceptedBy }) {
  const reqId = request.id || 'N/A';
  const shortId = reqId.slice(-6);
  const items = Array.isArray(request.items) && request.items.length > 0 ? request.items : [{ compId: request.compId, compName: request.compName, qty: request.qty || 1 }];
  const itemsSummary = items.map(it => `${it.qty}x ${it.compName || it.compId}`).join(', ');
  const location = collectionLocation || collectionNote || 'Hardware Lab Counter';

  const title = '🎉 Request Approved — SCET Lab';
  const body = `Pickup Slot: ${collectionTime} | Location: ${location} (${itemsSummary}). Please bring your College ID to the lab counter.`;

  const payload = {
    title,
    body,
    icon: '/assets/logo-footer.png',
    badge: '/assets/logo-footer.png',
    tag: `request-accepted-${reqId}`,
    data: {
      type: 'REQUEST_ACCEPTED',
      requestId: reqId,
      branchCode: request.branchCode,
      collectionTime,
      collectionLocation: location,
      collectionNote: collectionNote || '',
      url: '/#tab=requests',
    },
    vibrate: [200, 100, 200, 100, 200],
    actions: [
      { action: 'open_requests', title: 'View Pickup Slot 🕒' }
    ]
  };

  const [pushRes, waRes] = await Promise.all([
    sendPushToStudent({
      enrollmentNo: request.enrollmentNo,
      uid: request.studentUid,
      mobile: request.studentMobile,
      payload,
    }),
    sendAutomatedWhatsApp({
      to: request.studentMobile,
      studentName: request.studentName,
      reqId,
      time: collectionTime,
      note: location,
      itemsSummary,
    }),
    recordNotification({
      enrollmentNo: request.enrollmentNo,
      uid: request.studentUid,
      title,
      body: `Your hardware request #${shortId} was approved! Collection time: ${collectionTime}. Location: ${location}. ${collectionNote ? `Note: ${collectionNote}` : ''}`,
      type: 'REQUEST_ACCEPTED',
      data: { requestId: reqId, collectionTime, collectionLocation: location, collectionNote, itemsSummary, acceptedBy },
    })
  ]);

  return { ...pushRes, whatsapp: waRes };
}

/**
 * Dispatches notification when a request is ISSUED (counter checkout)
 */
async function notifyStudentRequestIssued({ request, issueRecord, gatePassNo }) {
  const reqId = request.id || 'N/A';
  const title = '⚡ Hardware Issued — SCET Lab';
  const body = `Gate Pass ${gatePassNo} ready! Please return items on time to avoid fine.`;

  const payload = {
    title,
    body,
    icon: '/assets/logo-footer.png',
    badge: '/assets/logo-footer.png',
    tag: `request-issued-${reqId}`,
    data: {
      type: 'REQUEST_ISSUED',
      requestId: reqId,
      gatePassNo,
      branchCode: request.branchCode,
      url: '/#tab=requests',
    },
    vibrate: [150, 80, 150],
  };

  const [pushRes] = await Promise.all([
    sendPushToStudent({
      enrollmentNo: request.enrollmentNo,
      uid: request.studentUid,
      mobile: request.studentMobile,
      payload,
    }),
    recordNotification({
      enrollmentNo: request.enrollmentNo,
      uid: request.studentUid,
      title,
      body: `Hardware checkout complete! Gate Pass: ${gatePassNo}. Tap to view or download gate pass PDF.`,
      type: 'REQUEST_ISSUED',
      data: { requestId: reqId, gatePassNo, issueSeq: issueRecord.seq, branchCode: request.branchCode },
    })
  ]);

  return pushRes;
}

/**
 * Dispatches notification when a request is REJECTED
 */
async function notifyStudentRequestRejected({ request, reason }) {
  const reqId = request.id || 'N/A';
  const shortId = reqId.slice(-6);
  const title = 'Update on Hardware Request — SCET Lab';
  const body = `Request #${shortId} could not be approved: ${reason || 'Item unavailable'}.`;

  const payload = {
    title,
    body,
    icon: '/assets/logo-footer.png',
    badge: '/assets/logo-footer.png',
    tag: `request-rejected-${reqId}`,
    data: {
      type: 'REQUEST_REJECTED',
      requestId: reqId,
      branchCode: request.branchCode,
      reason,
      url: '/#tab=requests',
    },
    vibrate: [300, 100, 300],
  };

  const [pushRes] = await Promise.all([
    sendPushToStudent({
      enrollmentNo: request.enrollmentNo,
      uid: request.studentUid,
      mobile: request.studentMobile,
      payload,
    }),
    recordNotification({
      enrollmentNo: request.enrollmentNo,
      uid: request.studentUid,
      title,
      body: `Request #${shortId} status update: ${reason || 'Item unavailable'}. Contact faculty if needed.`,
      type: 'REQUEST_REJECTED',
      data: { requestId: reqId, reason, branchCode: request.branchCode },
    })
  ]);

  return pushRes;
}

/**
 * Dispatches instant test notification
 */
async function sendTestNotification({ enrollmentNo, uid }) {
  const payload = {
    title: '🔔 SCET Lab Notifications Active!',
    body: 'Awesome! Your phone is now successfully connected for real-time lab updates and collection slot alerts.',
    icon: '/assets/logo-footer.png',
    badge: '/assets/logo-footer.png',
    tag: 'test-notification',
    data: {
      type: 'TEST_NOTIFICATION',
      url: '/#tab=requests',
    },
    vibrate: [100, 50, 100, 50, 200],
  };

  const pushRes = await sendPushToStudent({ enrollmentNo, uid, payload });
  await recordNotification({
    enrollmentNo,
    uid,
    title: '🔔 Push Notifications Connected',
    body: 'Your device successfully connected to SCET Lab live notification service.',
    type: 'SYSTEM',
    data: { test: true },
  });

  return pushRes;
}

module.exports = {
  getPublicKey,
  saveSubscription,
  removeSubscription,
  getSubscriptionsForStudent,
  sendPushToStudent,
  notifyStudentRequestAccepted,
  notifyStudentRequestIssued,
  notifyStudentRequestRejected,
  sendTestNotification,
  recordNotification,
};
