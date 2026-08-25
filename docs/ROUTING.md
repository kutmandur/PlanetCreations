# Routing architecture

PlanetCreations uses one React route tree with two history implementations:

- HTTP(S), including the website and hosted Electron UI, uses `BrowserRouter`.
- The packaged `file://` fallback uses `HashRouter` because native paths cannot
  be reloaded from a local `index.html`.

`src/earlyBootstrap.js` converts legacy public `/#/...` links to native paths
before React starts and also handles old hash links received by an already open
web page. Do not remove this compatibility bridge while old links, QR codes or
released desktop clients can still emit hash routes.

## Builds

- `npm run build` creates the website with Vite `base: '/'`, which is required
  when a deep link such as `/creation/<id>` loads the app shell directly.
- `npm run build:electron` creates the bundled fallback with `base: './'`.
- `npm run package` and `npm run package:store` must use the Electron build.

The IONOS `.htaccess` routes non-file requests to `/index.html` and disables
Apache MultiViews so `/privacy` cannot resolve to the separate `privacy.html`
document by content negotiation.

## Public routes

New public URLs use native paths. Existing `/community/<slug>` URLs remain an
alias, while new Community links use the root-level vanity path `/<slug>`.
Reserved root slugs are defined in `src/utils/communityRoutes.js` and enforced
again in `firestore.rules`; keep both lists synchronized.

Creation share links intentionally use `/share/creation/<id>`. IONOS sends that
route to the server-rendered Functions endpoint so social crawlers receive the
first gallery image as Open Graph metadata; browsers are then redirected to the
native `/creation/<id>` route.

## Deployment order

For a routing release, deploy in this order:

1. Firebase Functions, so the Creation preview endpoint exists.
2. Firestore rules, so new and renamed Community slugs cannot claim system paths.
3. The website, including `.htaccess`.
4. Desktop packages only if native Electron code changed and a client release is
   desired. The legacy hash bridge keeps the website compatible with already
   released clients, so this routing change alone does not require raising the
   Workshop minimum bridge version.
