# Runtime and dependency modernization

## Runtime policy

- Desktop development, build and CI: Node 24.18.x
- Packaged desktop client: Electron 43.2 with Node 24.18 and Chromium 150
- Firebase Functions: Node 22, because Firebase Functions currently supports
  Node 20 and 22 rather than Node 24
- Discord bot: Node 24.18.x

The repository root contains `.nvmrc`, and the release workflow installs the
same Node 24.18 runtime.

## Completed

- Migrated all 69 Firebase Functions to second-generation endpoints and moved
  the Functions runtime from Node 20 to Node 22.
- Replaced Create React App/Jest with Vite 8 and Vitest 4.
- Renamed JSX-bearing source files from `.js` to `.jsx`; service and utility
  modules remain `.js`.
- Migrated build-time environment variables from `REACT_APP_*` to `VITE_*`.
- Upgraded React 18 to 19, React Router 6 to 7, Electron 31 to 43,
  electron-builder 24 to 26, and Tailwind 3 to 4.
- Replaced the abandoned `react-beautiful-dnd` package with the maintained,
  API-compatible `@hello-pangea/dnd` fork.
- Upgraded the Firebase Web SDK, TanStack Query, Firebase Functions/Admin,
  AWS SDK, Express, ESLint, Discord.js and the remaining direct dependencies.
- Removed unused or obsolete packages and files, including `react-scripts`,
  `web-vitals`, `node-fetch`, `cross-env`, `electron-is-dev`,
  `electron-packager`, and the duplicate `electron/electron.js` entry point.
- Made `mime-types` an explicit runtime dependency instead of relying on a
  transitive installation.
- Updated GitHub Actions from checkout/setup-node v4 to v6 and changed release
  installs to reproducible `npm ci`.
- Added DMG and ZIP outputs for both Intel and Apple Silicon. The ZIP target is
  required for macOS auto-update metadata.
- Release drafts omit `.blockmap` assets to keep the public download list
  understandable. Auto-updates therefore download the complete package instead
  of using differential downloads; `latest*.yml` updater metadata remains.

## Environment migration

The production web build and GitHub Actions release workflow now use the
matching `VITE_*` names instead of the previous `REACT_APP_*` variables. The
required set is:

- `VITE_API_BASE_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`

The complete local list is maintained in `.env.example`. The old GitHub
variables can be removed after the first successful tagged build with the new
names.

## Verification performed

- Frontend: 22 Vitest files, 116 tests
- Electron modules: 14 Node tests
- Firebase Functions: 35 Node tests
- Discord bot: all CommonJS files parsed on Node 24
- Functions ESLint 10 flat configuration
- Vite production build
- electron-builder 26 Windows x64 unpacked package
- Packaged runtime confirmed as Electron 43.2 / Node 24.18 / Chromium 150

## Remaining upstream audit findings

No production audit currently reports a critical finding.

- Functions and Discord bot each retain eight moderate findings in transitive
  Google Cloud dependencies used by Firebase Admin 13. npm's proposed
  "solution" is an older Admin release; that is not an upgrade and does not
  remove the underlying upstream chain.
- The root production audit reports React Router's RSC-mode CSRF advisory.
  This app uses `HashRouter` in declarative SPA mode and has no React Server
  Components or server actions, so the affected path is not reachable. No
  fixed newer React Router release exists in the registry yet; npm only
  proposes a downgrade.
- The full development audit also reports electron-builder's transitive archive
  and installer tools. They are build-time-only and are not shipped as runtime
  dependencies. The current electron-builder release is already installed;
  npm again proposes a downgrade. Recheck both chains when upstream releases
  become available instead of forcing incompatible overrides.

## Next release checks

1. Configure the `VITE_*` secrets described above.
2. Run `npm ci`, `npm test`, and `npm run build` with Node 24.18.
3. Run `npm ci`, `npm run lint`, and `npm test` in `functions` with Node 22.
4. Run `npm ci` and `npm test` in `discord-bot` with Node 24.18.
5. Complete the macOS certificate setup in `docs/MACOS_SIGNING.md`.
6. Create a test tag and verify all three GitHub Actions matrix jobs before
   publishing the draft release.
