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

## Releases

GitHub Actions builds Windows, macOS and Linux from version tags. Store packages
use the separate manual workflow. Release notes stay in
`docs/releases/v<version>.md` because the release workflow reads them.

The repository contains application source, required data/assets, build and
deployment configuration, and automated checks. Research, internal AI notes,
audit reports, credentials and generated verification artifacts stay local.
