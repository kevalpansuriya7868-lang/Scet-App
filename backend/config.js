try { require('dotenv').config(); } catch { /* dotenv optional in tests */ }

const need = (k) => {
  if (!process.env[k]) throw new Error(`Missing required environment variable: ${k}`);
  return process.env[k];
};
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const tp = process.env.TRUST_PROXY;

module.exports = {
  port: Number(process.env.PORT) || 3000,
  isProd: process.env.NODE_ENV === 'production',
  trustProxy: !tp || tp === '0' || tp === 'false' ? false : (Number.isNaN(Number(tp)) ? tp : Number(tp)),
  allowedIps: list(process.env.ALLOWED_IPS || '10.175.212.212'),
  firebaseWebApiKey: need('FIREBASE_WEB_API_KEY'),
  masterUser: need('MASTER_ADMIN_USERNAME'),
  masterPass: need('MASTER_ADMIN_PASSWORD'),
  sessionSecret: need('SESSION_SECRET'),
  sessionHours: Number(process.env.SESSION_HOURS) || 8,
  finePerDay: Number(process.env.FINE_PER_DAY) || 10,
  borrowLimit: 3,
  smtp: {
    enabled: process.env.SMTP_ENABLED === 'true',
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    user: (process.env.SMTP_USER || '').trim(),
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    from: (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
  },
};
