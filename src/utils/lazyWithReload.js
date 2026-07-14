import React from 'react';

// Wrap React.lazy so a failed dynamic import — almost always a stale chunk after a
// new deploy (the running index.html references old hashed chunk filenames that no
// longer exist on the server) — reloads the page once to fetch fresh assets,
// instead of surfacing a ChunkLoadError. Guarded by a timestamp so it can't loop.
const RELOAD_KEY = 'chunkReloadAt';
const RELOAD_WINDOW_MS = 10000;

export default function lazyWithReload(factory) {
    return React.lazy(() =>
        factory()
            .then((mod) => {
                try { window.sessionStorage.removeItem(RELOAD_KEY); } catch (e) { /* ignore */ }
                return mod;
            })
            .catch((err) => {
                let last = 0;
                try { last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0); } catch (e) { /* ignore */ }
                if (Date.now() - last > RELOAD_WINDOW_MS) {
                    try { window.sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (e) { /* ignore */ }
                    window.location.reload();
                    return new Promise(() => {}); // keep Suspense pending until the reload happens
                }
                throw err; // reloaded very recently → let the error boundary handle it
            })
    );
}
