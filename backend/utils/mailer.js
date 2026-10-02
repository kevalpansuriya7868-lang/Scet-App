const nodemailer = require('nodemailer');
const cfg = require('../config');
const { fmt } = require('./dates');
const { gatePassNo } = require('./issues');

// SMTP is only truly enabled if credentials are present
const smtpReady = cfg.smtp.enabled && cfg.smtp.user && cfg.smtp.pass;

const transport = smtpReady
  ? nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
  })
  : null;

async function sendMail({ to, subject, text, attachments }) {
  if (!transport || !to) {
    // Dev-mode fallback: print the email to the server console so OTPs are still usable
    if (!cfg.isProd) {
      console.log('\n========== [DEV EMAIL FALLBACK] ==========');
      console.log(`TO      : ${to}`);
      console.log(`SUBJECT : ${subject}`);
      console.log(`BODY    :\n${text}`);
      console.log('==========================================\n');
      return { ok: true };   // treat as sent so the flow continues
    }
    return { ok: false, error: 'SMTP is not configured. Set SMTP_USER and SMTP_PASS in .env to enable email delivery.' };
  }
  try {
    await transport.sendMail({ from: cfg.smtp.from || cfg.smtp.user, to, subject, text, attachments });
    return { ok: true };
  } catch (e) {
    console.error('Mail failed:', e.message);
    if (!cfg.isProd) {
      console.log('\n========== [DEV EMAIL FALLBACK - SMTP SEND FAILED] ==========');
      console.log(`ERROR   : ${e.message}`);
      console.log(`TO      : ${to}`);
      console.log(`SUBJECT : ${subject}`);
      console.log(`BODY    :\n${text}`);
      console.log('=============================================================\n');
      return { ok: true, devFallback: true, error: e.message };
    }
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

const templates = {
  otp: (branch, otp) => ({
    subject: `SCET Lab Portal - OTP for Branch ${branch}`,
    text: `Hello Faculty Member,\n\nA secure authorization request was initiated for Department/Branch: ${branch}.\nYour 6-digit One-Time Password (OTP) is: ${otp}\n\nIt expires in 10 minutes. Do not share it.\nSarvajanik College of Engineering & Technology (SCET)`,
  }),
  issued: (i) => ({
    subject: `Hardware Issued Receipt - SCET Lab [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nYour laboratory hardware checkout has been registered:\n\n  Transaction Pass : ${gatePassNo(i)}\n  Enrollment No   : ${i.enrollmentNo}\n\nItems Issued:\n${formatItems(i)}\n\n  Issuing Time    : ${fmt(i.issueDate.toDate())}\n  Return Due Time : ${fmt(i.dueDate.toDate())}\n  Late Return Fine: Rs.${cfg.finePerDay} / day after due time\n\nYour Gate Pass is attached as a PDF.\n\n${SIGN}`,
  }),
  updated: (i, by) => ({
    subject: `Issue Record Updated - SCET Lab [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nYour lab hardware issue record has been UPDATED by ${by}. Current details:\n\n  Transaction Pass : ${gatePassNo(i)}\n  Enrollment No   : ${i.enrollmentNo}\n\nItems Issued:\n${formatItems(i)}\n\n  Return Due Time : ${fmt(i.dueDate.toDate())}\n\nThe updated Gate Pass is attached as a PDF. Please keep it as proof.\n\n${SIGN}`,
  }),
  returned: (i, condition, fine) => ({
    subject: `Component Returned Confirmation - SCET Lab [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nYour borrowed hardware has been returned:\n\n  Transaction Pass : ${gatePassNo(i)}\n\nItems Returned:\n${formatItems(i)}\n\n  Returned On     : ${fmt(i.returnDate.toDate())}\n  Return Condition: ${condition}\n  Penalty Status  : ${fine > 0 ? `Rs.${fine.toFixed(2)}` : 'ON TIME (Rs.0.00)'}\n\nYour Return Receipt is attached as a PDF. Please keep it as proof.\n\n${SIGN}`,
  }),
  overdue: (i, daysLate, fine) => ({
    subject: `URGENT: Overdue Lab Hardware Return Notice - SCET ${i.branchCode}`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nThis is an automated reminder about an OVERDUE checkout:\n\n  Enrollment No   : ${i.enrollmentNo}\n\nItems Overdue:\n${formatItems(i)}\n\n  Scheduled Return: ${fmt(i.dueDate.toDate())}\n  Days Overdue    : ${daysLate}\n  Current Penalty : Rs.${fine} (accruing at Rs.${cfg.finePerDay}/day)\n\nPlease return all items to Department ${i.branchCode} immediately to avoid examination hold and semester clearance suspension.\n\n${SIGN}`,
  }),
  overdueAdmin: (i, daysLate, fine) => ({
    subject: `[ADMIN ALERT] Overdue Return - ${i.enrollmentNo} - SCET ${i.branchCode}`,
    text: `Dear Lab In-Charge,\n\nThe following student has an OVERDUE hardware checkout:\n\n  Gate Pass       : ${gatePassNo(i)}\n  Student         : ${i.studentName} (${i.enrollmentNo})\n  Branch          : ${i.studentBranch || i.branchCode}\n  Mobile          : ${i.studentMobile || 'N/A'}\n  Student Email   : ${i.studentEmail}\n\nItems Overdue:\n${formatItems(i)}\n\n  Scheduled Return: ${fmt(i.dueDate.toDate())}\n  Days Overdue    : ${daysLate}\n  Current Penalty : Rs.${fine} (accruing at Rs.${cfg.finePerDay}/day)\n\nA reminder email has also been sent to the student.\n\n${SIGN}`,
  }),
  deadline: (i) => ({
    subject: `Reminder: Lab Hardware Return Due Tomorrow - SCET [${gatePassNo(i)}]`,
    text: `Dear ${i.studentName},\n\n${GREET}\n\nThis is a friendly reminder that your borrowed lab hardware is due for return TOMORROW (by 4:00 PM):\n\n  Transaction Pass : ${gatePassNo(i)}\n  Enrollment No   : ${i.enrollmentNo}\n\nItems to Return:\n${formatItems(i)}\n\n  Return Due Time : ${fmt(i.dueDate.toDate())}\n  Late Return Fine: Rs.${cfg.finePerDay} / day after due time\n\nPlease return all items to Department ${i.branchCode} on time to avoid penalty.\n\n${SIGN}`,
  }),
  deadlineAdmin: (i) => ({
    subject: `[ADMIN] Return Due Tomorrow: ${i.enrollmentNo} - SCET ${i.branchCode}`,
    text: `Dear Lab In-Charge,\n\nThis is an automated reminder that the following student's hardware checkout is due for return TOMORROW:\n\n  Gate Pass       : ${gatePassNo(i)}\n  Student         : ${i.studentName} (${i.enrollmentNo})\n  Branch          : ${i.studentBranch || i.branchCode}\n  Mobile          : ${i.studentMobile || 'N/A'}\n  Student Email   : ${i.studentEmail}\n\nItems to Return:\n${formatItems(i)}\n\n  Return Due Time : ${fmt(i.dueDate.toDate())}\n\nA reminder email has also been sent to the student.\n\n${SIGN}`,
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
