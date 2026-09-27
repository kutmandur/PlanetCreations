# PlanetCreations Client

React/Electron application with an online workshop, local game-file management
and a separate Firebase backend and Discord bot.

## Build and run

Use Node.js 24.18.x for the app and bot; Firebase Functions use Node.js 22.
Copy `.env.example` to `.env.local` and supply your environment configuration.
Keep credentials out of Git.

```sh
npm ci
npm start
npm run electron-dev
```

- `npm run build`: hosted web build with root-relative assets.
- `npm run build:electron`: bundled desktop fallback with relative assets.
- `npm run package`: desktop packages; publishing is configured in GitHub Actions.
- `npm run package:store`: Store package with the built-in updater disabled.
- `npm run verify:store-package`: inspect the generated Store package.
- `npm test`: frontend and Electron tests required by the release workflows.
- `npm run test:firestore-rules`: rules and index tests with a Firestore emulator.

The `functions/` and `discord-bot/` directories have their own package manifests,
configuration examples and tests. Install their dependencies separately.

## Account deletion integration

Clients first call `getAccountDeletionPreview` and show all owned communities.
Confirm that these communities will be deleted unless ownership is transferred
in Community Settings first. Other members' creations are only disconnected.
After reauthentication (within five minutes), call `deleteOwnAccount` with
`{protocolVersion: 2, confirmedCommunityIds: [...], receipt: "<64 hex characters>"}`.
Generate the receipt securely and save it before sending; retry with the same
receipt after a lost response. `accepted: true` means queued, not completed.
Sign out and clear account caches, then poll `getAccountDeletionStatus` with
`{receipt}`. The receipt is a private capability; never put it in URLs or logs.
The status endpoint supports signed-out callers and retains App Check enforcement.
Native iOS uses these same endpoints; its UI and provider reauthentication live
in the separate iOS repository.

`resumeAccountDeletions` resumes checkpointed phases every minute. A safety window
of at least 22 minutes drains old writers and signed upload URLs. Failed storage,
OAuth or Discord cleanup remains pending/retrying. Collaboration owners transfer
to a remaining active member, or the empty collaboration is deleted. Personal
saves are removed; history remains anonymously until the collaboration is deleted.
Event votes retain anonymous totals. Final receipts and minimal deletion fences
expire after 30 days and are removed by `maintainSecurityState`; captured account
identity is removed on completion. Infrastructure backups, external copies and
provider log retention require separate operational policies.

Run `node --test tests/account-lifecycle.emulator.cjs` with Firestore/Auth emulators
on `127.0.0.1:8080` / `127.0.0.1:9099` and `GCLOUD_PROJECT=demo-planetcreations-rules`.
The integration test uses real handlers and synthetic storage, including more
than 500 creations. Deploy the affected Functions, rules, indexes, web client and
Discord bot together; do not enable the new client against the old backend.

## Releases

GitHub Actions builds Windows, macOS and Linux from version tags. Store packages
use the separate manual workflow. Release notes stay in
`docs/releases/v<version>.md` because the release workflow reads them.

The repository contains application source, required data/assets, build and
deployment configuration, and automated checks. Research, internal AI notes,
audit reports, credentials and generated verification artifacts stay local.

## Shared account safety APIs (web and native clients)

Deploy these server contracts before publishing a client that calls them. Keep
App Check enforcement enabled. The native iOS client uses the same Firebase
callables; it must register its own App Check provider and retain deletion
receipts securely across restarts. No Electron bridge minimum changes are needed.

| Callable | Input | Behavior |
| --- | --- | --- |
| `setUserBlock` | `targetUserId`, `blocked` boolean | Blocks both directions of direct invitations, follows and attributed notifications; cancels pending direct invitations. The private block list is readable at `users/{uid}/blocks`. Shared memberships, saves and votes are preserved. |
| `submitContentReport` | `targetType`, `targetId`, `reason` | Resolves and verifies the entity, then atomically deduplicates the report. Communities may supply `targetSlug`; comments/changelogs supply their item ID and `parentId` (collaboration ID). Optional `mediaUrl` must belong to the entity; only its hash is copied to the report. |
| `validateContentText` | `fields` map of strings | Returns validation or editable field errors. This preflight is supplemented by Firestore rules for primary text fields/tags/changelog additions and validation in collaboration write callables. |
| `updateContentPolicy` | `action`: add/remove/publish; `word` for add/remove | Staff-only publication of escaped text policy. Publish the existing terms once after deploying the backend, before the release gate. The moderation panel provides this action. |
| `reviewContentReport` | `reportId`, `action`, `reason` | Staff-only review, withholding of display fields/media references, restoration or dismissal. Does not remove saves, membership or votes. |
| `amendContentReview` | `caseId`, `reason`, `expectedRevision` | Admin-only reason correction; retains the previous reason and actor in history and updates an existing author notice. |
| `appealContentDecision` | `caseId`, `reason` | The affected author may appeal a withheld item from Settings. Reporter identity and private evidence are not exposed to the author. |

Report types: creation, user, community, event, showcase, collaboration, comment,
changelog. A media report retains the parent type with a `mediaKey`. Showcase IDs
refer to `showcaseIndexState`, not a separate `showcases` collection. Legacy report
writes remain supported for released clients. Staff review records are under
`contentReviews`; author-facing decisions are under `users/{uid}/moderationNotices`.
Retained display fields and appeal records expire 30 days after a review action;
`expireContentReviews` removes expired records hourly in bounded batches.
Restoration refuses to overwrite a newer author edit. Account deletion removes
attributable review records; collaboration deletion removes its review history.

Admins can use `/admin?tab=review-history` to inspect decisions and staff attribution,
correct reasons, or reopen completed reviews. Reopening uses `reviewContentReport`
with action `reopen` and `expectedRevision`; it requires an admin and leaves current
content and visibility unchanged. Corrections and reopening reject stale revisions
and do not extend the existing retention deadline. Each case retains its latest
100 history entries. Legacy decisions without an actor are explicitly marked as
unrecorded; deleting a staff account anonymizes its attribution in other users'
review records. Deploy the `amendContentReview` callable with this UI change.
Review decisions (including starting a review) and reason corrections also write
an in-app inbox notification in the same Firestore transaction. These notifications
link to `/settings?section=reviews&case=<id>`, omit private reasons from the inbox
preview, and respect `prefs.moderation.inApp`. This delivery is in-app only; it does
not send an operating-system push notification. The dedicated Content reviews
settings section opens directly on narrow screens and highlights the linked case.

`getAccountDeletionStatus({receipt})` extends protocol version 2 with nullable Unix
millisecond timestamps `acceptedAt`, `earliestProcessingAt`, `completedAt`,
`expiresAt`, plus `needsAttention`. Acceptance does not mean completion. The minimum
safety interval is 22 minutes and active upload leases may extend it. Clients must
handle `retrying`, unavailable/missing receipts and `expired` without displaying
success. Requests pending over 24 hours expose an attention state and produce the
`ACCOUNT_DELETION_OVERDUE` worker log marker; configure a Cloud Monitoring alert
with an assigned responder before release. Do not include receipts or account
identifiers in alert logs.

Text terms are a limited moderation aid, not semantic image/video classification.
Manual reports and reversible review are implemented. Before an App Store release,
assign moderation coverage, validate the policy with representative game content,
and evaluate an image/video service if automated media classification is required.
Do not make shared file access depend on a classifier's availability. Firestore
normalization is less extensive than callable Unicode normalization; arbitrary
nested/custom content and historical content still require moderation review.

New collaboration gallery writes record `galleryOwnerId` and `bannerOwnerId`. Attributable comments,
notes, changelogs, task snapshots and media references are scrubbed at account
deletion while technical history and others' replies remain. Legacy gallery/task
snapshots without provable authorship need a separate provenance review before
claiming complete historical coverage; do not infer another member's ownership
from a URL. Removing external media references does not delete third-party copies.

Validation: `npm run test:frontend`, `npm run test:electron`, `npm test --prefix
functions`, `npm run lint --prefix functions`, `npm run test:firestore-rules`,
`npm run test:account-deletion`, `npm run build` and `npm run build:electron`.
Native privacy labels/manifests, age rating, App Check enrollment, reviewer access
and device/TestFlight end-to-end tests must be completed in the iOS project.


Creation moderation visibility uses the server-owned `moderationWithheld` and
`moderationHolds` fields. Public queries include `moderationWithheld == false`;
Firestore denies hidden documents to other users even through direct-ID queries.
Owners can read their own hidden creations, but cannot update them while held
(including owners with staff roles). Other moderation staff can edit them.
`getOwnerModerationPreview` verifies ownership and returns only retained display
fields, without internal review records. Expired evidence cannot be reconstructed.
Deploy this callable with the owner preview UI. `Restore` recovers retained originals without overwriting
newer changes; `Approve edits` publishes the current corrected version without
bringing removed media back. Every active case must release its own hold.

Before rolling out these queries and rules, deploy the visibility-aware review,
creation-index, share-preview and download handlers and the added indexes, then
initialize existing records with
`node scripts/migrate-creation-visibility.cjs --project=planetcreationsdotnet`
(dry run) and the same command with `--apply`. Rebuild public search/community/
showcase indexes using the existing admin rebuild workflow. Only then publish
the frontend and rules. Apply Functions selectively as required above. Existing
signed download URLs remain valid until their expiry (up to ten minutes), and
external image/video URLs cannot be revoked by removing a Creation reference.
Local security integration test: `node --test tests/moderation-visibility.emulator.mjs`
against the Firestore emulator on 127.0.0.1:8080; it uses its own demo project.

When original evidence expires, an active creation hold keeps only a minimal
operational case (no original content, report text or appeal text). Staff can
still edit and approve the current version; expiry never republishes it.

### Compact moderation index

The moderation overview reads staff-only `moderationIndexBlocks` (up to 50
case summaries per document) and three small category count documents.
Only the opened case subscribes to reports, in batches of 50; closing it or
leaving Reports stops detail listeners. Report documents remain authoritative.
`syncModerationIndex` maintains summaries transactionally from current reports,
so duplicate and out-of-order events cannot restore stale summaries. Private
report reasons and review evidence are never copied into the overview index.
Overdue reminders query due index blocks, not report documents, and skip further
index scans that day after successfully sending the daily reminder.

Before publishing this frontend, deploy the added index definition and the
affected `syncModerationIndex` and `remindOverdueModeration` Functions using
explicit selective deployment filters. Run
`node scripts/backfill-moderation-index.cjs planetcreationsdotnet` with authorized
server credentials, then deploy the staff-only index read rules and frontend.
The backfill is repeatable and must run after the sync trigger is active; it
also removes summaries whose source reports were deleted. For local testing,
set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and pass the demo project ID instead.

Completed moderation cases are stored separately in admin-only
`moderationArchiveBlocks` / `moderationArchiveState`. Active blocks contain only
cases with at least one open, reviewing or appealed report. Moving a case between
these indexes updates its location and both counters in one transaction; an
appeal or new open report returns the case to the active index. Empty blocks are
removed. Overdue reminders query only active blocks. Admin Review History opens
the archive first and loads review records on demand; All review history remains
available explicitly. Existing retention limits still apply to archived records.
After deploying the updated rules, indexes and syncModerationIndex function,
rerun the moderation index backfill to split existing cases before releasing the
updated frontend. The backfill also cleans stale entries in both indexes.

Text moderation uses conservative standard terms when no custom terms exist.
Publish the existing terms transactionally with
`node scripts/publish-content-policy.cjs <project-id>` before deploying the
updated Firestore rules. This preserves custom words and refreshes their compiled
pattern; an empty list installs the standard terms. Deploy the affected callable
validators with explicit function filters. A word filter is a moderation aid,
not a guarantee that all prohibited text is detected. The Legal Notice always
exposes the existing support address even while Firestore is unavailable.
