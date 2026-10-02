const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let credential;

// 1. Try loading via direct environment variables first (most reliable on Render)
if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PROJECT_ID) {
  credential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
} else {
  // 2. Fall back to physical JSON files (checking root and backend folders)
  const rootPath = path.join(__dirname, '../serviceAccountKey.json');
  const localPath = path.join(__dirname, 'serviceAccountKey.json');

  if (fs.existsSync(rootPath)) {
    credential = admin.credential.cert(require(rootPath));
  } else if (fs.existsSync(localPath)) {
    credential = admin.credential.cert(require(localPath));
  } else {
    throw new Error('Firebase service account key not found in environment variables or file paths.');
  }
}

admin.initializeApp({ credential });

module.exports = admin;