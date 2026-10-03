/**
 * Daily email scheduler.
 *
 * Checks active hardware issues and delivers automated email reminders:
 *   1. "1-Day Before Due Date" reminder:
 *      Sent to BOTH the student and the issuing faculty admin on the day before the due date.
 *      (e.g., if due date is 17th Sept, reminder is sent on 16th Sept).
 *   2. "Overdue" alerts:
 *      Sent when due date has passed.
 */

const { db } = require('../firebase');
const { sendMail, templates } = require('./mailer');
const { overdueInfo } = require('./dates');

const IST_OFFSET = 5.5 * 3600e3;
const DAY_MS = 864e5;

function getIstDateKey(ms) {
  return new Date(ms + IST_OFFSET).toISOString().slice(0, 10);
}

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
  console.log('[Scheduler] Checking hardware issue reminders and alerts...');
  try {
    const snap = await db.collection('issues').where('status', 'in', ['ISSUED', 'PARTIAL_RETURN']).get();
    const now = Date.now();
    const todayIstStr = getIstDateKey(now);
    const todayMidnight = new Date(todayIstStr).getTime();
    let deadlineSent = 0, overdueSent = 0;

    for (const doc of snap.docs) {
      const i = doc.data();
      const dueMs = i.dueDate?.toMillis ? i.dueDate.toMillis() : (i.dueDate ? new Date(i.dueDate).getTime() : 0);
      if (!dueMs) continue;

      const cfg = require('../config');
      const { overdue, daysLate, fine } = overdueInfo(dueMs, cfg.finePerDay, now);
      const aEmail = await adminEmail(i.issuedBy);
      const studentTo = i.studentEmail || (i.enrollmentNo ? `${i.enrollmentNo.toLowerCase()}@scet.ac.in` : null);

      // Check if TODAY is 1 day before due date (e.g. today is 16th, due is 17th)
      const dueIstStr = getIstDateKey(dueMs);
      const dueMidnight = new Date(dueIstStr).getTime();
      const daysUntilDue = Math.round((dueMidnight - todayMidnight) / DAY_MS);
      const timeUntilDue = dueMs - now;

      // Due tomorrow condition: exactly 1 calendar day before due date in IST or within 36 hours before due time
      const isDueTomorrow = (daysUntilDue === 1) || (timeUntilDue > 0 && timeUntilDue <= 36 * 3600e3);

      if (isDueTomorrow && !i.deadlineReminderSent && templates.deadline) {
        let sentAny = false;
        if (studentTo) {
          await sendMail({ to: studentTo, ...templates.deadline(i) });
          sentAny = true;
        }
        if (aEmail && templates.deadlineAdmin) {
          await sendMail({ to: aEmail, ...templates.deadlineAdmin(i) });
          sentAny = true;
        }
        if (sentAny) {
          deadlineSent++;
          await doc.ref.update({
            deadlineReminderSent: true,
            deadlineReminderSentAt: new Date()
          }).catch(() => {});
        }
      }

      if (overdue && templates.overdue) {
        // Send overdue alert if not already sent today
        const lastOverdueStr = i.lastOverdueSentAt ? getIstDateKey(new Date(i.lastOverdueSentAt).getTime()) : null;
        if (lastOverdueStr !== todayIstStr) {
          if (studentTo) await sendMail({ to: studentTo, ...templates.overdue(i, daysLate, fine) });
          if (aEmail && templates.overdueAdmin) await sendMail({ to: aEmail, ...templates.overdueAdmin(i, daysLate, fine) });
          overdueSent++;
          await doc.ref.update({
            lastOverdueSentAt: new Date()
          }).catch(() => {});
        }
      }
    }
    console.log(`[Scheduler] Reminders completed - 1-day deadline reminders: ${deadlineSent}, overdue alerts: ${overdueSent}.`);
    return { deadlineSent, overdueSent };
  } catch (e) {
    console.error('[Scheduler] Alert check failed:', e.message);
    return { error: e.message };
  }
}

function startScheduler() {
  try {
    const cron = require('node-cron');
    // Run daily at 08:00 AM IST
    cron.schedule('0 8 * * *', runDailyAlerts, { timezone: 'Asia/Kolkata' });
    // Also run hourly so sleepy instances or mid-day issues catch reminders
    cron.schedule('0 * * * *', runDailyAlerts);
    console.log('[Scheduler] Email reminders registered - fires daily at 08:00 IST and hourly checks.');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.warn('[Scheduler] node-cron not installed - daily reminders disabled. Run: npm install node-cron');
    } else {
      console.warn('[Scheduler] Failed to initialize cron:', e.message);
    }
  }

  // Also run once on startup after 5s
  setTimeout(() => {
    runDailyAlerts().catch((err) => console.warn('[Scheduler] Initial run error:', err.message));
  }, 5000);
}

module.exports = { startScheduler, runDailyAlerts };
