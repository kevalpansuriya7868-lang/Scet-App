/**
 * reset-firestore.js
 * ─────────────────────────────────────────────────────────
 * Wipes ALL Firestore data and ALL Firebase Auth users.
 * Run once when you need a clean slate.
 * Usage:  node scripts/reset-firestore.js
 */

try { require('dotenv').config(); } catch {}

const path = require('path');
const admin = require('firebase-admin');

const credential = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  ? admin.credential.cert(require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)))
  : admin.credential.applicationDefault();

admin.initializeApp({ credential });

const db   = admin.firestore();
const auth = admin.auth();

// All known top-level collections
const COLLECTIONS = [
  'users',
  'meta',
  'branches',
  'components',
  'componentImages',
  'issues',
  'auditLogs',
  'otps',
];

async function deleteCollection(name) {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(name).limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    process.stdout.write(`  ${name}: deleted ${deleted} docs so far...\r`);
  }
  console.log(`  ✅ ${name}: ${deleted} docs deleted`);
}

async function deleteAllAuthUsers() {
  let deleted = 0;
  let pageToken;
  while (true) {
    const result = await auth.listUsers(1000, pageToken);
    if (result.users.length === 0) break;
    const uids = result.users.map(u => u.uid);
    await auth.deleteUsers(uids);
    deleted += uids.length;
    pageToken = result.pageToken;
    if (!pageToken) break;
  }
  console.log(`  ✅ Firebase Auth: ${deleted} users deleted`);
}

async function main() {
  console.log('\n🗑️  SCET Lab — Full Firestore + Auth Reset\n');
  console.log('⏳ Deleting Firestore collections...');
  for (const col of COLLECTIONS) {
    await deleteCollection(col);
  }
  console.log('\n⏳ Deleting Firebase Auth users...');
  await deleteAllAuthUsers();
  console.log('\n✅ Done. Database is empty. You can now set up from scratch.\n');
  process.exit(0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
