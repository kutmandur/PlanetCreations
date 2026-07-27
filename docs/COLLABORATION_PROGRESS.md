# Collaboration rebuild — implementation status

Last updated: 2026-07-28

This is the repository-local continuation record for Claude's plan:

- Plan: `C:\Users\Don\.claude\plans\ok-with-our-remaining-noble-otter.md`
- Previous progress memory: `C:\Users\Don\.claude\projects\C--Users-Don-Documents-planet-creation-net-planet-creation-net-planet-creation-net\memory\collaboration-rebuild.md`

The Claude memory remains useful history, but its final P2/overlay “not done” section is now stale. This
file is the current hand-off source.

## Fixed product decisions

- One collaboration coordinates one creation/save; it is not simultaneous co-editing.
- The in-game overlay owns “log on/log off to build”.
- Manual log-off and game-close auto-logoff call the same backend function.
- A time-based expiry is the no-heartbeat/no-cron crash fallback.
- Save history uses the existing signed `.PlanetCreations` and R2 pipeline.
- Collaboration creation requires an initial signed save, which becomes version 1 atomically.
- Changelog images follow the site's existing external-URL/Firestore `imageUrls` model. Images are
  never uploaded to R2; R2 remains reserved for signed save packages.
- Collaboration discovery is independent from joining: `public` adds a safe read-only card/detail view
  for signed-in users, while `unlisted` stays absent from discovery and is only resolvable by share code.
  Neither visibility option changes the configured invite/password/application gate.
- Changelog editing and save hand-off are desktop-only. Ending a build always creates its changelog
  immediately; the author may add notes/images and the signed save now or later.
- Retention is per contributor: 3 versions, or 2 when the collaboration has more than 10 members.
- Pruned metadata and its exact R2 object must both be deleted.
- No new paid services and no new continuous collaboration listener for the overlay.
- Build fully before shipping the feature broadly.

## Phase status

| Phase | Status | Implemented | Still required |
| --- | --- | --- | --- |
| P0 secure base | Mostly complete; earlier subset deployed | Privileged create/join writes moved to Functions; collaboration/member/file/version/upload writes hardened; exact storage-key validation; rules exercised against the local emulator | Dedicated Firestore Rules unit tests; deploy the new file/version rule changes |
| P1 coordination | Core and current web UI complete locally; emulator multi-user and three-instance Electron scan E2E green | Create/edit wizard, invite/password/application gates, join consent, build lock, transactional lock acquisition, PC2/PZ overlay controls, manual log-off, game-close auto-logoff, offline retry marker, responsive collaboration hub/detail/member/join UI | Replace legacy invite subcollection with inbox items; finish membership/role functions; authenticated Electron/R2 E2E |
| P2 versioned files | Locally implemented and automated tests green | Desktop file picker; signed package preparation/upload; transactional finalize; sequential versions; contributor retention 3/2; real R2 deletion; signed download URL; desktop save extraction; responsive version-history UI | Authenticated two-account Electron/R2 E2E; deploy Functions/rules/index; release the Electron IPC bridge |
| P3 publish | Consent foundation only | Standing publish consent is recorded on membership | Complete/publish Functions, co-authored creation metadata, profile credit query/UI, unanimous revoke |
| P4 ship | Not ready | Collaboration surface is available locally for testing | Inbox notification migration, full regression/cost review, cohort rollout, IONOS web deploy, desktop release |

## Work completed in the current continuation

### Versioned save pipeline (P2)

- Added exact version storage keys:
  `collaboration-files/{collaborationId}/save/{versionId}.PlanetCreations`.
- `finalizeCollaborationVersion` validates auth, membership, original pending-changelog ownership,
  consent, upload ownership, signed package integrity and game identity.
- A Firestore transaction serializes version numbering and atomically updates the file, version,
  upload feed, collaboration hot state and upload session.
- Retention is enforced per contributor and never deletes the current version. The exact-bound R2 object
  is removed before its Firestore metadata, so a transient R2 failure remains eligible for a later retry.
- Desktop upload selects only the save extensions belonging to the collaboration game.
- Desktop download accepts only the signed R2 URL returned by the callable, validates the package/game,
  and saves the extracted raw game file through a save dialog.
- The old per-file checkout/restore UI and active `workSessions` listener were removed from the detail page.

### Overlay build-lock flow (P1)

- Windows process detection now supports `PlanetCoaster2.exe` and `PlanetZoo.exe`.
- The Electron main process exposes the active game and sends a transition event when a game exits.
- When a supported game starts, the collapsed overlay performs one member-only collaboration query
  for that game and compares each current version ID with the signed-in user's locally recorded version.
  A missing or different version automatically expands the overlay and offers the current save.
- Creating a collaboration, promoting a freshly uploaded changelog save and installing the current
  version all update that local per-user version record. Historical downloads do not replace it.
- The update action still requests the member-only signed URL and opens the save dialog before writing.
  When the last known target still exists, it is suggested automatically; the existing restore path
  creates a pre-restore backup before replacement. Multiple pending collaborations are offered in turn.
- Expanded overlay chrome performs one on-demand query for active collaborations of that game. It has:
  collaboration selection, current builder/time-left, Start building, Log off, Open project and
  manual refresh.
- A successfully ended build lock now fans out a `collaborationAvailable` inbox/push notification to
  every current collaboration member except the builder. Manual log-off, game-close auto-logoff and
  owner force-release all use this server path; idempotent end retries do not notify twice.
- When that notification arrives while its collaboration detail is open, the client refreshes members,
  versions, changelog and todos in the background. The route and current tab remain unchanged, while
  the existing collaboration document listener reflects the released build lock.
- Starting a build is restricted in the UI to the matching running game's overlay.
- An active build is remembered locally. Before auto/manual log-off, it is marked pending; a network
  failure is retried on the next online event or overlay boot. No heartbeat or Firestore polling was added.
- A transient `tasklist` failure keeps the prior process state and cannot falsely log a builder off.

### Current collaboration UI (P1/P2)

- Rebuilt the Collaborations hub to match the current Community Hub styling, including dark mode,
  responsive layouts, search/status filters and clear desktop-client boundaries.
- The single "Search your collaborations" field now also accepts a complete 8-character share code.
  The separate dark join-code hero was removed.
- Owners can choose Public on overview or Unlisted during creation and later in project settings.
  The overview merges the user's memberships with a safe public directory and de-duplicates projects
  that already belong to the user.
- Public visitors get Project, Changelog and Members as a read-only view. Build, todo, invite, settings,
  changelog-edit and version-download actions stay unavailable until they actually join.
- Collaboration save downloads require a real member document in the download callable. Public visitors
  and moderators who are not collaboration members receive no download controls and no signed URL.
- Public discovery/detail data is returned by allowlisted Cloud Functions. The private collaboration
  document remains member-only, so invite codes, password hashes, member ID arrays and R2 storage keys
  cannot leak through a public Firestore read.
- Collaboration cards now show project status, role, current builder and current version. The obsolete
  storage quota, file count and multi-file model were removed.
- Rebuilt the project detail surface around one shared save: build state, current version, contributor
  retention, activity, tasks, members and settings. Only the collaboration document remains live;
  members, versions, uploads and tasks are loaded on demand and refreshed after mutations.
- The project card above the detail tabs now follows light/dark mode when no banner is set. Owners can
  set a custom banner in the create/edit wizard; its centered title, description, status, statistics
  and actions stay readable over the image.
- Headings, icon/title rows and introductory copy are centered consistently across the Project,
  Changelog, Build, Members and Settings tabs. Long-form changelog content, todos, member rows and
  file metadata stay left-aligned for readability.
- Updated the member list, pending invitations, direct invite, share-code and version-history dialogs
  to the same responsive/dark-mode design. Contributor/viewer copy now reflects build-session access.
- Rebuilt the public join flow for invite, password and application gates, with login, consent, success
  and error states. `getCollaborationJoinInfo` now returns only the safe presentation fields required
  by that page.
- The detail route is protected and the overlay's “open collaboration” link now points to the actual
  singular `/collaboration/:id` route.

### Required initial save, changelog and gallery (P1/P2)

- Creating a collaboration now requires the desktop client and a first game save. The client signs and
  uploads it through the existing save pipeline before calling `createCollaboration`.
- `createCollaboration` validates the upload session and signed package, then creates the collaboration,
  owner membership, shared save, version 1, initial changelog item and completed upload session in one
  coordinated backend operation.
- Desktop contributors can add changelog text and up to 10 standard external image URLs while
  uploading the newest save. New entries are no longer created independently in the web UI.
- Owners can add up to 10 starting gallery images during creation or later in the same project settings
  wizard. They use the same validated external-URL/Firestore model as changelog images and never R2.
- Changelog images populate the project gallery in newest-first order, followed by the owner's starting
  gallery. Gallery and changelog show an "open version" action while the referenced version is retained,
  and a clear unavailable state after retention pruning.
- Collaboration settings now use the same category navigation and single-panel layout as the site's
  other settings pages.

### Build-finish changelog hand-off (P1/P2)

- Manual log-off and game-close auto-logoff now open the collaboration changelog popover in the
  desktop client after the build lock has been released.
- The client scans the configured Frontier save profiles and selects the newest local save matching
  the collaboration file name. If the downloaded file was renamed, it falls back to the newest file
  of the same game/save type and clearly displays the selected filename.
- The popover checks the save file modification time. Saves older than two minutes produce a
  save-first warning and require a second explicit click to upload unchanged.
- "Upload newest" signs and uploads that local save and finalizes the new version with the changelog
  text and external image URLs in one backend operation. The removed related-version selector can no
  longer produce a changelog detached from its upload.
- Releasing a build lock now creates an empty `pending-save` changelog atomically, including automatic
  game-close logoff, owner force-release and lazy expiry recovery. The card therefore always records
  the original builder and end timestamp even when the popover is dismissed without input. An offline
  auto-logoff preserves the original local end time across its later network retry.
- Only that changelog's original builder may later edit its text/images or attach its missing save.
  Both operations are enforced by callable transactions; direct upload metadata writes remain denied
  by Firestore rules.
- Starting a new build while the latest changelog has no save first names the contributor who has not
  supplied it and warns that continuing edits an older available version. The user must explicitly
  confirm that older-version start.
- A save supplied late remains linked to its original changelog. It becomes the current save only when
  it does not predate an already supplied build, preventing a late upload from rolling the project
  back after a newer turn.
- Collaboration details now have a dedicated Changelog tab. Every item is a separate responsive card
  with its author, text, images, work duration, file metadata and a direct version download button
  while retention still contains that version.

### Active build workspace and crash-safe draft (P1/P2)

- While the current desktop user owns the build lock, the collaboration detail page exposes an
  additional Build tab. It disappears immediately when that user's build session ends.
- The Build tab combines the collaboration's current open todos with a local changelog textarea.
  Notes are written to client-local storage as the user types; no per-keystroke Firestore writes or
  continuous backend listener were added.
- Completing or reopening a todo updates the normal shared todo and also adds/removes a structured
  snapshot in the local build draft. Completed items are shown in the finish popover and on the final
  changelog card.
- The expanded game overlay shows a prominent jump to the active collaboration's Build workspace
  whenever the user is building and is not already on that collaboration page.
- Manual logoff and game-close auto-logoff send the local draft and its build-session ID through the
  existing transactional `endBuildSession` hand-off. Only the actual builder's draft is accepted.
- The draft survives retryable offline failures and a hard client/game crash. If another user later
  reclaims the expired lock, the original builder's next visit safely merges the matching local draft
  into their own pending changelog before clearing the local recovery copy.

## Deployment boundary

According to Claude's memory, the earlier P0/P1 callable set, rules and then-existing indexes were
successfully deployed on 2026-07-25. That historical claim was not re-verified in this continuation.

The work listed below is **not deployed by this continuation**:

- Functions: at minimum the updated `startBuildSession`, `endBuildSession`,
  `finalizeCollaborationVersion` and `getCollaborationVersionDownloadUrl`, the new
  `updateCollaborationChangelogEntry`, `listPublicCollaborations`,
  `getPublicCollaborationView`, the new initial-save `createCollaboration` flow and the
  R2-first `deleteCollaboration` cleanup.
  `finalizeCollaborationVersion` now stores validated external image URLs with the version activity;
  `createCollaboration` and `updateCollaborationSettings` now also validate/store the banner and starting
  gallery; the standalone `addCollaborationChangelogEntry` callable was removed.
- Firestore rules for server-only file/version/upload metadata.
- The `memberIds array-contains + game` collaboration index used by the overlay.
- Hosted React bundle (production site is IONOS/manual FTP, not Firebase Hosting).
- Electron main/preload additions, including newest-save discovery and main-window hand-off after
  game close; these require a desktop release before hosted UI upload/download and auto-logoff can work.

The new web create form, `createCollaboration` callable and Electron file-picker response must ship
together: the backend now requires an initial upload and the UI depends on the expanded IPC payload.
Deploy these pieces as one coordinated release only after the authenticated E2E gate below passes.

## Verification completed

### Local multi-instance Firebase E2E (2026-07-27)

- Added an isolated `demo-planetcreations` Auth/Firestore/Functions emulator setup plus a repeatable
  seed with Owner, Builder and Visitor accounts, one Public project and one Unlisted project.
- Ran three independent signed-in UI sessions at the same time. The browser-side desktop shim is
  development/emulator-only and supplied the game/overlay state and stale local-save metadata; it is
  excluded from production builds unless the emulator flag and explicit query parameter are present.
- Verified the combined search/share-code field, code-only discovery and join, Public/Unlisted
  switching, public read-only details, member-only UI downloads and a direct server-side
  `PERMISSION_DENIED` for a non-member signed-URL request.
- Verified newest-first gallery/changelog cards, starting gallery fallback, external changelog images,
  member downloads, centered settings, custom banner and light/dark rendering.
- Verified the game-start update offer, cross-session build lock, active Build tab, overlay workspace
  jump, locally persisted draft after reload, completed-todo carry-over, stale-save warning, explicit
  older-version acknowledgement, empty automatic changelog, author-owned later edit and stale-save
  upload warning.
- Verified that build release creates one notification for the other member, updates the open
  Changelog tab in the background, and immediately resets the builder's overlay from Log off to Start
  building.
- The run found and fixed four integration-only issues: collection-query rules mixed with member
  document lookups, unsafe missing-field access in list rules, legacy static Firestore helper access in
  the current Functions emulator, and stale overlay lock adoption after an in-page logoff. It also
  corrected the warning priority so a pending-save contributor name is not hidden by an update offer.
- Packaged release clients were not exercised against production services. Development Electron
  instances and copied real Frontier files are covered by the local native gate below; the real signed
  R2 transfer and cleanup are covered separately without writing test data to production Firestore.

### Local native save and Electron instance E2E (2026-07-28)

- Copied one real Planet Coaster 2 park, blueprint and autosave into the ignored
  `.local-runtimes/collaboration-save-fixtures` tree. SHA-256 and byte length matched each source both
  before and after testing; no test wrote to an original Frontier file.
- Ran the production desktop scanner against a synthetic Frontier profile containing only those
  copies. All three types were classified correctly, exact-name latest-save selection resolved to the
  copied park, an old timestamp triggered the two-minute warning and a fresh copy did not.
- Created real version-2 `.PlanetCreations` archives from all three copies. Package metadata, game/file
  kind, payload size and SHA-256 integrity passed. The upload validator correctly rejected the locally
  unsigned packages rather than treating them as uploadable.
- Started three simultaneous development Electron processes with separate user-data profiles and
  separate remote inspection ports. Each loaded the Firebase-emulator React build through the real
  sandboxed preload/IPC bridge, received a distinct persisted client ID and scanned exactly the three
  copied files. Every returned path remained inside the ignored fixture root.
- Added a loopback-only `PLANETCREATIONS_DEV_SERVER_URL` override so native E2E can use an isolated
  emulator build when another React server already owns port 3000. Remote, HTTPS, authenticated and
  malformed values fall back to `http://localhost:3000`.
- The native run found and fixed one test-only integration issue: sandboxed Electron preloads cannot
  require arbitrary local helper modules. The preload now performs its small loopback-origin check
  inline, while the main process uses the tested shared resolver.

### Signed real-R2 round-trip and deletion cleanup (2026-07-28)

- Used emulator Auth/Firestore with the real signing and R2 secrets loaded only into the short-lived
  local Functions process. No production user, profile or collaboration document was created.
- Converted the copied 9,189,457-byte `.park2` payload into a server-signed 8,674,742-byte
  `.PlanetCreations` package, uploaded it through a real presigned R2 PUT and created an Unlisted
  collaboration/version through the normal callables.
- Requested and used the member-only signed GET URL. The downloaded package signature validated and
  the extracted game payload had the same SHA-256 as the copied source. A second authenticated emulator
  user received `PERMISSION_DENIED` for the same version.
- Found that the old client-side collaboration delete removed only Firestore metadata and could orphan
  R2 versions. Replaced it with a server-only callable that enumerates the exact collaboration R2
  prefix, validates every key, deletes version/temp keys, verifies that the prefix is empty and only
  then recursively deletes Firestore plus its upload sessions.
- Direct client deletion of collaboration roots and file/version metadata is now denied by Firestore
  Rules. The emulator returned HTTP 403 for a direct owner delete; the callable remains owner/staff-only.
- The successful E2E cleanup removed the collaboration and its upload session. The already-proven
  signed download URL returned HTTP 404 after deletion, independently confirming that its R2 object
  was gone.

- React/Jest: 20 suites, 111 tests passed, including the combined newest-first/starting gallery,
  stale-save warning,
  later author-edit coverage, local draft persistence, end-session draft hand-off and game-start
  collaboration version-update selection/installation plus targeted availability refresh events.
- Cloud Functions Node tests: 25 passed, including public-view allowlists, strict member-only
  downloads, build-release notification fan-out policy, pending-save ownership, missing-save warnings
  and late-version promotion safeguards plus exact collaboration-prefix cleanup validation.
- Electron module Node tests: 14 passed, including newest-save selection, two-minute staleness and the
  loopback-only isolated dev-server resolver.
- Functions ESLint: passed.
- Electron main/preload/module syntax checks: passed.
- React production build: compiled successfully.
- `git diff --check`: passed (only Windows line-ending notices).
- The authenticated three-session emulator run covered the Collaboration hub, inline join-code field,
  responsive create wizard, dedicated Changelog tab, build-finish popover and cross-account project
  refresh. The three-process native run covered real IPC scanning and unsigned package integrity on
  copied Frontier data. Authenticated signing, actual R2 upload/download, payload integrity and R2
  cleanup are green; packaged release-client interaction and coordinated deployment remain.

## Next execution order

1. Repeat the green three-development-Electron and signed-R2 gates through two authenticated packaged
   release candidates. Isolated identities, IPC scanning, copied PC2 data and backend R2 transfer are green.
2. Create a collaboration with an initial PC2 save and one with an initial Planet Zoo save. Confirm
   that cancellation, wrong-game files and unsigned/invalid packages cannot create partial projects.
3. For both games, verify manual log-off and game close open the changelog popover in the main client.
   During the build, use the overlay workspace banner, write notes, complete/reopen todos and confirm
   that the Build tab disappears after logoff while its draft and checked todos remain in Changelog.
   Repeat once after killing the client before logoff to verify local recovery.
4. Verify exact-name selection, renamed-save fallback, recent-save upload and the older-than-two-minute
   warning against real Frontier save directories.
5. Verify password/application joining and viewer/editor role restrictions in the real clients; invite
   code joining and Public/Unlisted switching are green in the emulator gate.
6. Verify ten starting images and real hosted changelog image URLs in the release candidate; banner,
   light/dark header and newest-first ordering are green in the emulator gate.
7. Verify expiry reclaim, PC2 close and Planet Zoo close. Manual cross-account build lock/release,
   pending-save warning and background refresh are green in the emulator gate. Dismiss the changelog
   once, confirm the empty author/timestamp card, then edit it and attach its save later. Start a second
   turn before attaching and confirm the named older-version warning.
8. Upload at least four versions from one contributor and versions from a second contributor.
9. Confirm version numbers, current-version pointer, upload duration and 3/2 retention.
10. Confirm pruned R2 save keys are really absent and a retained version downloads to a valid raw save.
11. Install a collaboration version, upload a newer version from the second account, open the matching
    game on the first client and confirm that the overlay expands once, offers the newer version,
    suggests the previous target and creates a pre-restore backup after confirmation.
12. Repeat the already-green in-app inbox/background-refresh flow with real system push enabled and
    confirm one OS notification is delivered.
13. Add Firestore Rules emulator tests for privilege escalation and server-only version metadata.
14. Finish the P1 inbox/membership cleanup.
15. Build P3 publish/profile-credit/revoke.
16. Perform the coordinated P4 deploy/release only after the full two-account native/R2 flow is green.

## Working-tree note

Do not modify or remove these unrelated user files while continuing this plan:

- `discord-bot/close-bugs.js`
- `discord-bot/read-bugs.js`
