require('dotenv').config();
const { cert, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

try {
  const encodedServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!encodedServiceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 is not set in the .env file.');
  }
  const decodedJson = Buffer.from(encodedServiceAccount, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decodedJson);

  initializeApp({
    credential: cert(serviceAccount)
  });
  
  console.log('✅ Firebase connection initialized successfully!');

} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  process.exit(1);
}

const db = getFirestore();
const messaging = getMessaging();

// Export the initialized services
module.exports = { db, FieldValue, messaging, Timestamp };
