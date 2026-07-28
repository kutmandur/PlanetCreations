# macOS signing and notarization

## What the Apple account enables

An active Apple Developer Program membership is required for a Developer ID
certificate and notarization. With a Developer ID Application signature,
hardened runtime, successful notarization and the notarization ticket attached
to the DMG, users can open the downloaded app normally from Finder. They do not
need Terminal commands or the right-click bypass. macOS can still show its
normal first-launch confirmation for an app downloaded from the internet.

This is direct distribution outside the Mac App Store, so there is no App Store
review. Apple notarization is still required for a clean Gatekeeper result.

## Apple setup

1. Join the Apple Developer Program.
2. Create a **Developer ID Application** certificate. Do not use the similarly
   named Mac App Distribution certificate, which is for the Mac App Store.
3. Install the certificate and its private key in Keychain Access, export both
   as a password-protected `.p12`, and Base64-encode the complete file.
4. In App Store Connect, create a team API key that can submit software for
   notarization. Download its `.p8` file and Base64-encode it.
5. Keep the certificate password, issuer ID and key ID available for the
   repository secrets below.

## GitHub Actions secrets

Configure these repository secrets:

- `MAC_CSC_LINK`: Base64 content of the exported `.p12`
- `MAC_CSC_KEY_PASSWORD`: password of the `.p12`
- `APPLE_API_KEY_P8_BASE64`: Base64 content of the App Store Connect `.p8`
- `APPLE_API_KEY_ID`: App Store Connect API key ID
- `APPLE_API_ISSUER`: App Store Connect issuer ID

The release workflow writes the API key only into the runner's temporary
directory. `electron-builder` imports the certificate, signs the app with
hardened runtime, submits the app with `notarytool`, waits for acceptance and
staples the app before creating its release artifacts. No certificate or
private key is committed to this repository.

The macOS release produces DMG and ZIP files for both x64 and arm64. The ZIP is
also necessary for the macOS auto-updater.

## First signed release verification

Run these checks on a macOS runner or Mac before publishing the draft release:

```bash
codesign --verify --deep --strict --verbose=2 "PlanetCreations Client.app"
spctl --assess --type execute --verbose=4 "PlanetCreations Client.app"
xcrun stapler validate "PlanetCreations Client.app"
```

Also download the DMG through a browser on a second Mac, drag the app into
Applications, launch it normally and test auto-update once. Signing cannot be
fully validated from the Windows development machine.
