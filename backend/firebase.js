const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let credential;

// Explicitly use environment variables if configured on Render
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
  credential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Safely replace escaped newlines in the private key string
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
} else {
  // Fallback to local service account file if running locally
  const rootPath = path.join(__dirname, '../serviceAccountKey.json');
  const localPath = path.join(__dirname, 'serviceAccountKey.json');

  if (fs.existsSync(rootPath)) {
    credential = admin.credential.cert(require(rootPath));
  } else if (fs.existsSync(localPath)) {
    credential = admin.credential.cert(require(localPath));
  } else {
    throw new Error('Firebase service account key not found in environment variables or paths.');
  }
}

if (!admin.apps.length) {
  admin.initializeApp({ credential });
}

module.exports = {
  admin,
  auth: admin.auth(),
  db: admin.firestore(),
  FieldValue: admin.firestore.FieldValue,
};