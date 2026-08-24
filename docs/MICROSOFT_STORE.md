# Microsoft Store release guide

PlanetCreations uses the packaged AppX/MSIX-family submission path. The Store
hosts, signs and updates this package. The GitHub NSIS installer remains a
separate channel with `electron-updater`.

## Partner Center product

Create the product as **MSIX or PWA app**. Do not choose the EXE/MSI or game
product types.

The Partner Center identity is stored as public package metadata in
`electron-builder.store.cjs`:

| Manifest value | Partner Center value |
| --- | --- |
| Package/Identity/Name | `DonReichau.PlanetCreationsClient` |
| Package/Identity/Publisher | `CN=8EA44CF3-DC41-47A9-8F85-4E91ECB404D5` |
| Publisher display name | `Don Reichau` |

The optional environment variables `STORE_IDENTITY_NAME`, `STORE_PUBLISHER` and
`STORE_PUBLISHER_DISPLAY_NAME` can override them for a different Store product.
These identifiers are not secrets. Never add passwords, account recovery data
or verification documents to the repository.

The Windows release job builds the GitHub installer and also uploads a
`microsoft-store-appx-<tag>` workflow artifact. Download that artifact and upload
the `.appx` file to the Partner Center package section.

## Local Store package

```powershell
npm ci
npm test
npm run package:store
npm run verify:store-package
```

The package is written to `dist/store`. A Store submission does not need a
CA-trusted local signature; Microsoft replaces the signature after
certification. An unsigned package must not be offered as a direct download.
For local installation testing, sign it with a development certificate whose
subject exactly matches `STORE_PUBLISHER`, and trust that certificate only on
the test machine.

## Package behavior

- The Online Workshop loads the current UI from `https://www.planetcreations.net`.
- The Offline Manager first loads its React UI from the fixed trusted
  `https://www.planetcreations.net` origin. This permits UI-only fixes without
  changing the installed package. An unavailable or incompatible hosted UI
  automatically falls back to the reviewed React UI included in the AppX.
- The hosted Offline Manager receives an explicit, versioned Electron bridge for
  the same local file-management features already declared by the package. It
  cannot add AppX capabilities or access unrelated file-system locations.
- On first use of a local-file feature, the online picker asks the user to choose
  the Frontier Developments folder through a native folder dialog. In-game
  previews are read only from that configured folder.
- Creation and collaboration uploads use an opaque, single-use desktop handle.
  The Electron main process requests a short-lived upload URL directly from the
  fixed PlanetCreations Firebase endpoint and shows a native confirmation before
  transferring a signed package. The hosted UI cannot provide an arbitrary
  upload destination or directly upload another local path.
- The hosted UI and desktop bridge perform separate online and Offline Manager
  version/capability handshakes. If an update needs a newer native operation,
  older clients use their bundled UI until a certified Store package is updated.
- The Online Workshop `minimumBridgeVersion` is a native compatibility floor,
  not a website release counter. Keep it unchanged for web-only, Firebase,
  index and other backward-compatible deployments. Raise it only when the
  hosted Workshop unavoidably requires a native API absent from older clients
  and capability detection, an adapter or graceful fallback cannot preserve
  compatibility. The Offline Manager minimum is versioned independently.
- Workshop uploads retain both the current opaque-handle API and the released
  legacy `uploadBackupFile` adapter; the absence of an API in an already-open
  window must not by itself be reported as an outdated installed client.
- If the hosted UI cannot be reached, the bundled UI is used as the fallback;
  local management therefore remains available without the website.
- Application updates are delivered only by Microsoft Store.
- The GitHub updater is not loaded and no GitHub release check is made.
- `planetcreations://` and `.PlanetCreations` are declared in the package.
- The package contains a disabled-by-default Windows StartupTask. Users can opt
  in from **Settings > Apps > Startup**; installation never enables it silently.
- The only declared restricted capability is `runFullTrust`, required by the
  Electron desktop client for its documented local file-management features.

## Partner Center listing values

- Product type: App
- Device family: Windows Desktop
- Architecture: x64
- Minimum OS: Windows 10 version 2004 (build 19041)
- Suggested category: Utilities & tools
- Price: Free
- Privacy URL: `https://www.planetcreations.net/privacy.html`
- Community guidelines URL:
  `https://www.planetcreations.net/community-guidelines.html`
- Website: `https://www.planetcreations.net/`

Deploy the current web build once before submitting so both public policy URLs
return their standalone HTML pages without requiring a login.

Declare only languages fully supported by the package. The initial package
declares `en-US`; add German only after the complete application UI is localized.

The beginning of the listing must disclose that Planet Coaster 2 or Planet Zoo
is needed for the corresponding local file features and that PlanetCreations is
an independent, unofficial fan project not affiliated with or endorsed by
Frontier Developments plc.

## Certification notes

Provide a normal, non-administrator reviewer account and explain:

1. Online community features use Firebase and require a working network
   connection; the local manager remains available without login.
2. `.PlanetCreations` files contain game saves and metadata only. They are not
   applications and contain no executable code.
3. Upload and Direct Install fail closed unless a creation package has a valid
   PlanetCreations signature. A tampered, unsigned or temporarily unverifiable
   package cannot be uploaded or directly installed.
4. Local file access is limited to user-selected Frontier game folders and the
   PlanetCreations backup/media folders.
5. OBS and Streamlabs integration is optional and communicates with software
   configured by the user. Credentials remain encrypted on the local device.
6. Creations and profiles have dedicated Report actions. Community, event,
   showcase and collaboration detail pages also expose **Report this content**
   in the product footer. Reports are visible in the moderation panel; the
   public content guidelines describe enforcement and removal.
7. The Online Workshop and Offline Manager may load their React interface from
   `https://www.planetcreations.net`. Hosted Offline Manager updates are limited
   to the functionality and native bridge capabilities already present in the
   certified package. Network failure or an incompatible bridge automatically
   selects the bundled reviewed interface.

Include a signed sample `.PlanetCreations` package and clear steps for testing a
machine without either supported game installed.

## Release gates

Before every Store upload:

- `npm audit --omit=dev --audit-level=high` passes.
- Frontend and Electron tests pass.
- Firebase Functions lint and tests pass.
- The package passes the Windows App Certification Kit on a clean x64 Windows
  10 and Windows 11 test machine.
- File association and protocol activation work both from a cold start and
  while the client is already running.
- First-time game-folder selection, raw-save preview, packaged-backup selection
  and the native upload confirmation are tested from the hosted online UI.
- The hosted Workshop is tested against the current bridge and the oldest
  supported released bridge before increasing `minimumBridgeVersion`; the
  release notes identify the exact incompatible native contract for any bump.
- The hosted Offline Manager is tested online, after disconnecting the network,
  and with an intentionally incompatible bridge version to verify bundled fallback.
- Hosted UI changes remain within the Store-listed feature set; any new native
  operation, Windows capability or permission is shipped through a new Store package.
- Store builds show no GitHub updater UI or network requests.
- The privacy and community-guidelines URLs are publicly reachable without login.
- Signed Direct Install works; unsigned, tampered and unverifiable packages are
  rejected.
- Install, first launch, startup behavior, upgrade and uninstall are tested as a
  standard Windows user.
