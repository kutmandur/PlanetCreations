import { initializeApp } from 'firebase/app';
import {
    initializeAppCheck,
    ReCaptchaEnterpriseProvider,
} from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
// ✅ 1. Import the correctly named function: enableIndexedDbPersistence
import {
    connectFirestoreEmulator,
    getFirestore,
    enableIndexedDbPersistence
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { getMessaging, isSupported } from 'firebase/messaging';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export const isConfigured = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "DEIN_API_KEY"
);

const useFirebaseEmulators =
    import.meta.env.DEV &&
    import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

let app, auth, db, appCheck;

if (isConfigured) {
    app = initializeApp(firebaseConfig);
    const appCheckSiteKey =
        import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
    if (!useFirebaseEmulators && appCheckSiteKey) {
        if (import.meta.env.DEV &&
            import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG === 'true' &&
            typeof window !== 'undefined') {
            window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        try {
            appCheck = initializeAppCheck(app, {
                provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
                isTokenAutoRefreshEnabled: true,
            });
        } catch (error) {
            console.error('Firebase App Check could not be initialized:', error);
        }
    }
    auth = getAuth(app);
    db = getFirestore(app);

    if (useFirebaseEmulators) {
        const emulatorHost =
            import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';
        connectAuthEmulator(
            auth,
            `http://${emulatorHost}:${
                import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || '9099'
            }`,
            { disableWarnings: true }
        );
        connectFirestoreEmulator(
            db,
            emulatorHost,
            Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080)
        );
        connectFunctionsEmulator(
            getFunctions(app),
            emulatorHost,
            Number(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || 5001)
        );
    } else {
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
}

// --- Web Push (Firebase Cloud Messaging) ---
// Messaging only works in a supported secure-context browser and must be skipped
// in the Electron desktop client (no service worker / push there). getMessaging()
// throws in unsupported environments, so gate it behind isSupported().
const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');
let messagingInstance = null;

// NOTE: a hoisted function declaration (not a const arrow) so importing modules
// can access it even during webpack HMR re-evaluation (avoids "Cannot access
// 'getMessagingIfSupported' before initialization").
export async function getMessagingIfSupported() {
    if (!isConfigured || isElectron) return null;
    if (messagingInstance) return messagingInstance;
    try {
        if (await isSupported()) {
            messagingInstance = getMessaging(app);
        }
    } catch (err) {
        console.warn('FCM messaging is not available in this environment:', err);
    }
    return messagingInstance;
}

export { app, appCheck, auth, db };
