const test = require('node:test');
const assert = require('node:assert');
const notifier = require('../backend/utils/notifier');
const { formatIntlPhone, buildMessage, sendAutomatedWhatsApp } = require('../backend/utils/whatsapp');

test('VAPID public key is returned and is non-empty string', async () => {
  const key = await notifier.getPublicKey();
  assert.strictEqual(typeof key, 'string');
  assert.ok(key.length > 20);
});

test('saveSubscription rejects invalid subscription objects', async () => {
  await assert.rejects(async () => {
    await notifier.saveSubscription({ uid: '123', enrollmentNo: 'TEST', subscription: null });
  }, /Invalid subscription/);

  await assert.rejects(async () => {
    await notifier.saveSubscription({ uid: '123', enrollmentNo: 'TEST', subscription: { endpoint: 'http://test' } });
  }, /Invalid subscription/);
});

test('formatIntlPhone normalizes Indian 10-digit mobile numbers', () => {
  assert.strictEqual(formatIntlPhone('9876543210'), '919876543210');
  assert.strictEqual(formatIntlPhone('+91 98765 43210'), '919876543210');
  assert.strictEqual(formatIntlPhone('09876543210'), '919876543210');
  assert.strictEqual(formatIntlPhone(''), null);
});

test('buildMessage formats notification without token mentions', () => {
  const msg = buildMessage({
    studentName: 'Rahul',
    reqId: 'REQ-123456',
    time: 'Tomorrow 11:00 AM',
    note: 'Lab Counter 1',
    itemsSummary: '2x Arduino Uno',
  });
  assert.ok(msg.includes('SCET Lab Notification'));
  assert.ok(msg.includes('Tomorrow 11:00 AM'));
  assert.ok(msg.includes('College ID'));
  assert.ok(!msg.toLowerCase().includes('token'));
});

