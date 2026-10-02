const crypto = require('crypto');

const scrypt = (pw, salt) =>
  new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

/** Salted scrypt hash, format: scrypt$<salt hex>$<hash hex> */
async function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(plain, salt)).toString('hex')}`;
}
async function verifySecret(plain, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const derived = await scrypt(plain, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const hmac = (v, secret) => crypto.createHmac('sha256', secret).update(String(v)).digest('hex');
const newOtp = () => String(crypto.randomInt(100000, 1000000));

/** Compact signed token: base64url(payload).signature; payload carries `exp` (ms epoch). */
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function unsign(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
module.exports = { hashSecret, verifySecret, safeEqual, hmac, newOtp, sign, unsign };
