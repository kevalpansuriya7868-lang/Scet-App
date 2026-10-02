const httpErr = (status, message, code) => Object.assign(new Error(message), { status, code });
const clean = (v) => String(v ?? '').trim();
module.exports = { httpErr, clean };
