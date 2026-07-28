# Security deployment

The OAuth and Firestore-rule changes are safe to deploy without App Check
enforcement. App Check itself must be enabled in this order so existing clients
are not locked out:

1. Create a reCAPTCHA Enterprise site key for `planetcreations.net` and
   `www.planetcreations.net`, then register it for the Firebase web app under
   App Check.
2. Set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` for the IONOS web build and as
   a GitHub Actions repository secret.
3. Deploy the web app and release the desktop client containing the
   App-Check-token IPC support. Signed packages use this path.
4. Confirm valid App Check requests in the Firebase metrics.
5. Set `ENFORCE_APP_CHECK=true` in the non-secret Functions environment and
   deploy Functions again.
6. Enable enforcement for the required Firebase products in the Firebase
   console only after the metrics show that supported clients send tokens.

Until step 5, callable and Express endpoints continue accepting authenticated
legacy clients. CORS, OAuth state validation, private OAuth credential storage,
Firestore field protection and server-side rate limits do not depend on App
Check and are active as soon as their Functions/Rules are deployed.

The scheduled `maintainSecurityState` function migrates legacy Discord refresh
tokens out of `users/{uid}` and removes expired OAuth/rate-limit records. Run it
once manually after the first deployment if migration must happen immediately;
otherwise it runs daily at 03:30 Europe/Berlin.

GitHub secret scanning and push protection should remain enabled. A token found
in Git history must be revoked or rotated before an alert is resolved; rewriting
history alone cannot invalidate copies that were already cloned.
