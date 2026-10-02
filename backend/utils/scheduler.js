/**
 * Daily email scheduler.
 *
 * Runs at 08:00 every morning and sends two types of alerts:
 *   1. "Return due tomorrow" - to both the STUDENT and the issuing ADMIN.
 *   2. "Overdue" alerts     - to both the STUDENT and the issuing ADMIN.
 *
 * Uses node-cron. If not installed, logs a warning and does nothing.
 */

const { db } = require('../firebase');
const { sendMail, templates } = require('./mailer');
const { overdueInfo } = require('./dates');

async function adminEmail(username) {
  if (!username) return null;
  try {
    const s = await db.collection('users').where('username', '==', username).where('role', '==', 'admin').limit(1).get();
    if (s.empty) return null;
    const e = s.docs[0].data().email || null;
    return e && /^[^@]+@[^@]+\.[^@]+$/.test(e) ? e : null;
  } catch { return null; }
}

async function runDailyAlerts() {
  console.log('[Scheduler] Running daily email alerts...');
  try {
    const snap = await db.collection('issues').where('status', 'in', ['ISSUED', 'PARTIAL_RETURN']).get();
    const now = Date.now();
    const MS_48H = 48 * 60 * 60 * 1000;
    let deadlineSent = 0, overdueSent = 0;

    for (const doc of snap.docs) {
      const i = doc.data();
      const dueMs = i.dueDate?.toMillis ? i.dueDate.toMillis() : (i.dueDate ? new Date(i.dueDate).getTime() : 0);
      const cfg = require('../config');
      const { overdue, daysLate, fine } = overdueInfo(dueMs, cfg.finePerDay);
      const timeUntilDue = dueMs - now;
      const isDueTomorrow = timeUntilDue > 0 && timeUntilDue <= MS_48H;
      const aEmail = await adminEmail(i.issuedBy);

      if (isDueTomorrow && templates.deadline) {
        if (i.studentEmail) await sendMail({ to: i.studentEmail, ...templates.deadline(i) });
        if (aEmail && templates.deadlineAdmin) await sendMail({ to: aEmail, ...templates.deadlineAdmin(i) });
        deadlineSent++;
      }

      if (overdue && templates.overdue) {
        const studentTo = i.studentEmail || `${(i.enrollmentNo || '').toLowerCase()}@scet.ac.in`;
        await sendMail({ to: studentTo, ...templates.overdue(i, daysLate, fine) });
        if (aEmail && templates.overdueAdmin) await sendMail({ to: aEmail, ...templates.overdueAdmin(i, daysLate, fine) });
        overdueSent++;
      }
    }
    console.log(`[Scheduler] Done - deadline reminders: ${deadlineSent}, overdue alerts: ${overdueSent}.`);
  } catch (e) {
    console.error('[Scheduler] Daily alerts failed:', e.message);
  }
}

function startScheduler() {
  try {
    const cron = require('node-cron');
    cron.schedule('0 8 * * *', runDailyAlerts, { timezone: 'Asia/Kolkata' });
    console.log('[Scheduler] Daily email job registered - fires at 08:00 IST every day.');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.warn('[Scheduler] node-cron not installed - daily reminders disabled. Run: npm install node-cron');
    } else {
      console.warn('[Scheduler] Failed to initialize cron:', e.message);
    }
  }
}

module.exports = { startScheduler, runDailyAlerts };
