/**
 * Firebase Admin initialization.
 *
 * Credentials are loaded in this order of preference:
 *   1. The FIREBASE_SERVICE_ACCOUNT env var (a full JSON string — handy for hosting).
 *   2. A local serviceAccountKey.json file at the project root.
 *
 * See README.md for how to generate the service account credentials.
 */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

function loadServiceAccount() {
  // Option 1: full JSON blob in an environment variable.
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (err) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON: " + err.message
      );
    }
  }

  // Option 2: a serviceAccountKey.json file beside the project.
  const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");
  if (fs.existsSync(keyPath)) {
    return require(keyPath);
  }

  throw new Error(
    "No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT or add serviceAccountKey.json. See README.md."
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

const db = admin.firestore();

// Convenience handles to the three collections.
const collections = {
  users: db.collection("users"),
  matches: db.collection("matches"),
  predictions: db.collection("predictions"),
};

module.exports = { admin, db, collections, Timestamp: admin.firestore.Timestamp };
