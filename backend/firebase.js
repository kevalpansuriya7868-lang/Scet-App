const path = require('path');
const admin = require('firebase-admin');

const credential = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  ? admin.credential.cert(require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)))
  : admin.credential.applicationDefault();

admin.initializeApp({ credential });

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = {
  admin,
  db,
  auth: admin.auth(),
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
};
