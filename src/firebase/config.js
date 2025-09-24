import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
// ✅ 1. Import the correctly named function: enableIndexedDbPersistence
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
    measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

export const isConfigured = firebaseConfig.apiKey !== "DEIN_API_KEY";

let app, auth, db;

if (isConfigured) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    
    // ✅ 2. Call the function with its correct name
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code === 'failed-precondition') {
            // Multiple tabs open, persistence can only be enabled in one.
            console.warn("Firestore persistence failed: Multiple tabs open.");
        } else if (err.code === 'unimplemented') {
            // The browser does not support persistence.
            console.error("Firestore persistence is not available in this browser.");
        }
    });
}

export { app, auth, db };