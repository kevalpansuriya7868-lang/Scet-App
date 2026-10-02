const nodemailer = require('nodemailer');
const cfg = require('../config');
const { fmt } = require('./dates');
const { gatePassNo } = require('./issues');

// SMTP is only truly enabled if credentials are present
const smtpReady = cfg.smtp.enabled && cfg.smtp.user && cfg.smtp.pass;

const transport = smtpReady
  ? nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.port === 465,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  })
  : null;

async function sendMail({ to, subject, text, attachments }) {
  if (!to) return { ok: false, error: 'Recipient email address is required.' };

  // 1. HTTP-based email delivery (Port 443 - works everywhere including Render free tier)
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.SMTP_FROM || 'SCET Lab Portal <onboarding@resend.dev>',
          to: [to],
          subject,
          text
        })
      });
      const data = await res.json();
      if (res.ok) return { ok: true, provider: 'resend', id: data.id };
      console.warn('[Resend API Error]:', data);
    } catch (e) {
      console.warn('[Resend API Network Error]:', e.message);
    }
  }

  if (process.env.BREVO_API_KEY) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { email: cfg.smtp.user || process.env.SMTP_FROM || 'admin@scet.ac.in', name: 'SCET Lab Portal' },
          to: [{ email: to }],
          subject,
          textContent: text
        })
      });
      const data = await res.json();
      if (res.ok) return { ok: true, provider: 'brevo', messageId: data.messageId };
      console.warn('[Brevo API Error]:', data);
    } catch (e) {
      console.warn('[Brevo API Network Error]:', e.message);
    }
  }

  if (process.env.HTTP_EMAIL_URL) {
    try {
      const payload = {
        to,
        subject,
        text,
        attachments: attachments && Array.isArray(attachments)
          ? attachments.map(a => ({
              filename: a.filename,
              content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : (typeof a.content === 'string' ? a.content : '')
            }))
          : undefined
      };
      const res = await fetch(process.env.HTTP_EMAIL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });
      let json = null;
      try { json = await res.json(); } catch { /* non-json */ }
      if (res.ok && (!json || json.ok !== false)) {
        return { ok: true, provider: 'google_script_webhook' };
      }
      if (json && json.error) {
        console.warn('[HTTP Email Webhook Error]:', json.error);
        return { ok: false, error: json.error };
      }
    } catch (e) {
      console.warn('[HTTP Email Webhook Network Error]:', e.message);
    }
  }

  // 2. Standard Nodemailer SMTP
  if (!transport) {
    if (!cfg.isProd) {
      console.log('\n========== [DEV EMAIL FALLBACK] ==========');
      console.log(`TO      : ${to}`);
      console.log(`SUBJECT : ${subject}`);
      console.log(`BODY    :\n${text}`);
      console.log('==========================================\n');
      return { ok: true, devFallback: true };
    }
    return { ok: false, error: 'SMTP is not configured. Set SMTP_USER and SMTP_PASS to enable email delivery.' };
  }

  try {
    await transport.sendMail({ from: cfg.smtp.from || cfg.smtp.user, to, subject, text, attachments });
    return { ok: true, provider: 'smtp' };
  } catch (e) {
    console.warn('[Mailer] SMTP delivery failed:', e.message);
    return { ok: false, error: e.message };
  }
}

const SIGN = 'Best Regards,\nLaboratory In-Charge & Faculty Staff\nSarvajanik College of Engineering & Technology (SCET), Surat';
const GREET = 'Greetings from Sarvajanik College of Engineering & Technology (SCET)!';

/** Format items list for email body — multi-item aware, backward compat with legacy single-component records. */
function formatItems(i) {
  const items = Array.isArray(i.items) && i.items.length > 0
    ? i.items
    : [{ compId: i.compId, compName: i.compName, qty: i.issueQty }];
  return items.map((it, idx) => `    ${idx + 1}. ${it.compId}${it.compName ? ` - ${it.compName}` : ''} (Qty: ${it.qty})`).join('\n');
}

const toDateObj = (t) => {
  if (!t) return new Date();
  if (typeof t.toDate === 'function') return t.toDate();
  if (t instanceof Date) return t;
  return new Date(t);
};

const templates = {
  otp: (branch, otp) => ({
    subject: `SCET Lab Portal - OTP for Branch ${branch}`,
    text: `Hello Faculty Member,\n\nA secure authorization request was initiated for Department/Branch: ${branch}.\nYour 6-digit One-Time Password (OTP) is: ${otp}\n\nIt expires in 5 minutes. Do not share it.\nSarvajanik College of Engineering & Technology (SCET)`,
  }),
  issued: (i) => ({
    subject: `Hardware Issued Receipt - SCET Lab [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nYour laboratory hardware checkout has been registered:\n\n  Transaction Pass : ${gatePassNo(i)}\n  Enrollment No   : ${i.enrollmentNo}\n\nItems Issued:\n${formatItems(i)}\n\n  Issuing Time    : ${fmt(toDateObj(i.issueDate))}\n  Return Due Time : ${fmt(toDateObj(i.dueDate))}\n  Late Return Fine: Rs.${cfg.finePerDay} / day after due time\n\nYour Gate Pass is attached as a PDF.\n\n${SIGN}`,
  }),
  updated: (i, by) => ({
    subject: `Issue Record Updated - SCET Lab [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nYour lab hardware issue record has been UPDATED by ${by}. Current details:\n\n  Transaction Pass : ${gatePassNo(i)}\n  Enrollment No   : ${i.enrollmentNo}\n\nItems Issued:\n${formatItems(i)}\n\n  Return Due Time : ${fmt(toDateObj(i.dueDate))}\n\nThe updated Gate Pass is attached as a PDF. Please keep it as proof.\n\n${SIGN}`,
  }),
  returned: (i, condition, fine) => ({
    subject: `Component Returned Confirmation - SCET Lab [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nYour borrowed hardware has been returned:\n\n  Transaction Pass : ${gatePassNo(i)}\n\nItems Returned:\n${formatItems(i)}\n\n  Returned On     : ${fmt(toDateObj(i.returnDate))}\n  Return Condition: ${condition}\n  Penalty Status  : ${fine > 0 ? `Rs.${fine.toFixed(2)}` : 'ON TIME (Rs.0.00)'}\n\nYour Return Receipt is attached as a PDF. Please keep it as proof.\n\n${SIGN}`,
  }),
  overdue: (i, daysLate, fine) => ({
    subject: `URGENT: Overdue Lab Hardware Return Notice - SCET ${i.branchCode}`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nThis is an automated reminder about an OVERDUE checkout:\n\n  Enrollment No   : ${i.enrollmentNo}\n\nItems Overdue:\n${formatItems(i)}\n\n  Scheduled Return: ${fmt(toDateObj(i.dueDate))}\n  Days Overdue    : ${daysLate}\n  Current Penalty : Rs.${fine} (accruing at Rs.${cfg.finePerDay}/day)\n\nPlease return all items to Department ${i.branchCode} immediately to avoid examination hold and semester clearance suspension.\n\n${SIGN}`,
  }),
  deadline: (i) => ({
    subject: `Reminder: Lab Hardware Return Due Tomorrow - SCET [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nThis is a friendly reminder that your borrowed lab hardware is due for return TOMORROW (by 4:00 PM):\n\n  Transaction Pass : ${gatePassNo(i)}\n  Enrollment No   : ${i.enrollmentNo}\n\nItems to Return:\n${formatItems(i)}\n\n  Return Due Time : ${fmt(toDateObj(i.dueDate))}\n  Late Return Fine: Rs.${cfg.finePerDay} / day after due time\n\nPlease return all items to Department ${i.branchCode} on time to avoid penalty.\n\n${SIGN}`,
  }),
  deadlineAdmin: (i) => ({
    subject: `[ADMIN] Return Due Tomorrow: ${i.enrollmentNo} - SCET ${i.branchCode}`,
    text: `Dear Lab In-Charge,\n\nThis is an automated reminder that the following student's hardware checkout is due for return TOMORROW:\n\n  Gate Pass       : ${gatePassNo(i)}\n  Student         : ${i.studentName} (${i.enrollmentNo})\n  Branch          : ${i.studentBranch || i.branchCode}\n  Mobile          : ${i.studentMobile || 'N/A'}\n  Student Email   : ${i.studentEmail}\n\nItems to Return:\n${formatItems(i)}\n\n  Return Due Time : ${fmt(toDateObj(i.dueDate))}\n\nA reminder email has also been sent to the student.\n\n${SIGN}`,
  }),
  passwordReset: (name, resetLink) => ({
    subject: `Password Reset - SCET Lab Portal`,
    text: `Dear ${name},\n\n${GREET}\n\nA password reset was requested for your SCET Lab Portal account.\n\nClick the link below to set a new password (valid for 1 hour):\n${resetLink}\n\nIf you did NOT request this, please ignore this email. Your password will not change.\n\n${SIGN}`,
  }),
  requestAccepted: (r, collectionTime, note) => ({
    subject: `Hardware Request APPROVED - SCET Lab [Collection Time: ${collectionTime}]`,
    text: `Dear ${r.studentName},\n\n${GREET}\n\nYour hardware request for Department ${r.branchCode} has been APPROVED!\n\nPlease collect your components at the laboratory:\n  Collection Time Slot : ${collectionTime}\n  ${note ? `Instructions         : ${note}\n` : ''}\nItems to Collect:\n${formatItems(r)}\n\nPlease bring your College ID card when you arrive to pick up your components.\n\n${SIGN}`,
  }),
  requestRejected: (r, reason) => ({
    subject: `Update on your Hardware Request - SCET Lab`,
    text: `Dear ${r.studentName},\n\n${GREET}\n\nYour hardware request for Department ${r.branchCode} could not be approved at this time.\n\nReason:\n  ${reason || 'Item unavailable or allocation limit reached.'}\n\nItems Requested:\n${formatItems(r)}\n\nPlease contact your department lab staff if you have any questions.\n\n${SIGN}`,
  }),
};
module.exports = { sendMail, templates };
