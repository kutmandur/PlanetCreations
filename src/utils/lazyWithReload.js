import React from 'react';
import {reloadAfterChunkFailure} from './chunkRecovery';

// Wrap React.lazy so a failed dynamic import — almost always a stale chunk after a
// new deploy (the running index.html references old hashed chunk filenames that no
// longer exist on the server) — reloads the page once to fetch fresh assets,
// instead of surfacing a ChunkLoadError. Guarded by a timestamp so it can't loop.
export default function lazyWithReload(factory) {
    return React.lazy(() =>
        factory()
            .catch((err) => {
                if (reloadAfterChunkFailure()) {
                    return new Promise(() => {}); // keep Suspense pending until the reload happens
                }
                throw err; // reloaded very recently → let the error boundary handle it
            })
    );
}
