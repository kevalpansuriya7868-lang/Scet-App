const test = require('node:test');
const assert = require('node:assert');
const { buildMatcher } = require('../backend/utils/ipMatcher');
const { computeDue, overdueInfo } = require('../backend/utils/dates');
const c = require('../backend/utils/crypto');

test('IP guard allows only the configured address', () => {
  const ok = buildMatcher(['10.175.212.212']);
  assert.ok(ok('10.175.212.212'));
  assert.ok(ok('::ffff:10.175.212.212'));         // IPv4-mapped form Node reports
  assert.ok(!ok('10.175.212.213'));
  assert.ok(!ok('127.0.0.1'));
  assert.ok(!ok('10.175.212.212, 8.8.8.8'));      // garbage / header-injection style values
  assert.ok(!ok(undefined));
});
test('IP guard supports CIDR ranges', () => {
  const ok = buildMatcher(['172.21.252.0/24']);
  assert.ok(ok('172.21.252.9')); assert.ok(!ok('172.21.253.9'));
});

test('due date = 4 PM IST on the due day; fine = whole days x rate', () => {
  const now = Date.parse('2026-09-30T05:00:00Z');   // 10:30 IST, 30 Sep
  assert.strictEqual(computeDue(7, now).toISOString(), '2026-10-07T10:30:00.000Z'); // 16:00 IST
  const due = computeDue(0, now).getTime();
  assert.deepStrictEqual(overdueInfo(due, 10, due - 1000), { overdue: false, daysLate: 0, fine: 0 });
  assert.strictEqual(overdueInfo(due, 10, due + 3600e3).fine, 0);             // <24h late: overdue, Rs.0
  assert.strictEqual(overdueInfo(due, 10, due + 3 * 864e5 + 1).fine, 30);
});

test('scrypt hashing and signed tokens', async () => {
  const h = await c.hashSecret('branch-pass');
  assert.ok(await c.verifySecret('branch-pass', h));
  assert.ok(!(await c.verifySecret('wrong', h)));
  assert.ok(!(await c.verifySecret('admin123', 'admin123')));   // plaintext rows are never accepted
  const t = c.sign({ uid: 'u', code: 'CO', exp: Date.now() + 5000 }, 's');
  assert.strictEqual(c.unsign(t, 's').code, 'CO');
  assert.strictEqual(c.unsign(t, 'other'), null);
  assert.strictEqual(c.unsign(c.sign({ exp: Date.now() - 1 }, 's'), 's'), null);
  assert.strictEqual(c.unsign(t.replace(/^./, 'x'), 's'), null);
  assert.ok(c.safeEqual('abc', 'abc') && !c.safeEqual('abc', 'abd'));
  assert.match(c.newOtp(), /^\d{6}$/);
});

test('mailer gracefully handles delivery in development / fallback', async () => {
  const { sendMail } = require('../backend/utils/mailer');
  const res = await sendMail({ to: 'test@scet.ac.in', subject: 'Test', text: 'OTP 123456' });
  assert.ok(typeof res.ok === 'boolean');
});

