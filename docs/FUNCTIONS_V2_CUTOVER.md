# Cloud Functions v2 cutover

The Functions source exports all 69 endpoints as second-generation functions.
Callable and HTTP endpoint names remain unchanged, so the web app and desktop
client do not need a compatibility layer.

## Runtime policy

- Region: `us-central1`
- Minimum instances: `0`
- Callable and HTTP functions: concurrency `40`, maximum `10` instances
- Archive validation and collaboration storage cleanup: concurrency `2`,
  maximum `5` instances, 1 GiB memory
- Firestore triggers: `gcf_gen1` CPU, concurrency `1`, maximum `10` instances
  for the initial migration
- Scheduled maintenance: maximum `1` instance to prevent overlapping runs
- Execution identity: the established
  `planetcreationsdotnet@appspot.gserviceaccount.com` service account

## Dependency cleanup

- `firebase-functions` is pinned to the current v2-capable 7.x line.
- `firebase-admin` stays on the newest 13.x release accepted by that Functions
  SDK. Do not apply npm's suggested downgrade to Admin 10.
- `adm-zip` and Express use patched releases; both process or route untrusted
  input in production.
- Linting uses the maintained ESLint 10 flat configuration. Functions
  development, emulation and deployment use Node 22.
- The production audit currently has no high or critical findings. Its remaining
  moderate findings come from the `uuid` 9 dependency chain inside Firebase
  Admin 13. Recheck them when Firebase Functions officially accepts Admin 14.

## Preflight

1. Coordinate a short maintenance window. No collaboration builds, uploads,
   account changes, community changes, or creation changes may run during the
   cutover.
2. Confirm the Firebase CLI is at least version 12 and the selected project is
   `planetcreationsdotnet`.
3. Run `npm ci`, `npm run lint`, and `npm test` inside `functions`.
4. Confirm all required Secret Manager values exist:
   `DISCORD_CLIENT_SECRET`, `BACKUP_SIGNING_KEY`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and
   `YOUTUBE_API_KEY`.
5. Confirm `functions/.env` contains the non-secret values documented in
   `functions/.env.example`.
6. Save the output of `firebase functions:list` and verify that every deployed
   v1 function is represented by one of the 69 local exports.
7. Verify that the configured execution service account still has the
   permissions currently used by Firebase Admin and Secret Manager.

## Cutover

Firebase cannot change an existing function from v1 to v2 under the same name
in one deployment. During the maintenance window:

1. Delete the verified v1 functions in `us-central1`.
2. Immediately deploy the local source with `firebase deploy --only functions`.
3. Do not re-enable writes until all 69 functions are visible as
   second-generation functions and the scheduled jobs are present.

The first v2 deployment can take longer while Google Cloud enables or prepares
Cloud Run, Eventarc, Artifact Registry, and their service agents.

## Smoke test

Verify at least:

- API public-key retrieval and signing
- Discord link start/callback and server refresh
- creation upload, validation, signed download, and deletion
- collaboration creation with initial save
- build start/end, changelog update, version upload, and member-only download
- public/unlisted collaboration visibility
- one harmless Firestore update for search-index and notification triggers
- scheduler configuration without manually executing destructive maintenance

After verification, configure an Artifact Registry cleanup policy and watch
Cloud Run error rate, instance count, memory, latency, and App Check failures.

## Production cutover result

The production migration completed on 2026-07-28:

- all 69 endpoints are active as second-generation functions in `us-central1`
- all 69 endpoints use the Node 22 runtime
- the established endpoint names remained unchanged
- the production smoke test covered signing, R2 upload/download and deletion,
  required initial collaboration saves, public views, and member-only downloads
- App Check enforcement remains disabled until monitoring shows that supported
  web and desktop clients consistently send valid tokens
