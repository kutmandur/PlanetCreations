require('dotenv').config();
const admin = require('firebase-admin');

try {
  const encodedServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!encodedServiceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 is not set in the .env file.');
  }
  const decodedJson = Buffer.from(encodedServiceAccount, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decodedJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  console.log('✅ Firebase connection initialized successfully!');

} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  process.exit(1);
}

const db = admin.firestore();

// Export the initialized services
module.exports = { admin, db };