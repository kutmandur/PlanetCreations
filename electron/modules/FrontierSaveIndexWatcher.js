const fs = require('fs');
const path = require('path');

const SUPPORTED_SAVE_EXTENSIONS = new Set([
    '.park2',
    '.blpr2',
    '.prkauto2',
    '.zoo',
    '.pzblueprint',
    '.zooauto',
]);

function isFrontierSavePath(relativePath) {
    if (relativePath === null || relativePath === undefined) return true;
    const normalized = String(relativePath).replaceAll('\\', '/');
    const segments = normalized.split('/').filter(Boolean);
    if (!segments.some(segment => segment.toLowerCase() === 'saves')) return false;
    return SUPPORTED_SAVE_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

class FrontierSaveIndexWatcher {
    constructor(basePath, onFilesChanged, options = {}) {
        this.basePath = path.resolve(basePath);
        this.onFilesChanged = onFilesChanged;
        this.debounceMs = options.debounceMs ?? 1200;
        this.watchImpl = options.watchImpl || fs.watch;
        this.watcher = null;
        this.timer = null;
        this.changedPaths = new Set();
    }

    start() {
        if (this.watcher) return;
        this.watcher = this.watchImpl(
            this.basePath,
            { recursive: true, persistent: false },
            (_eventType, changedName) => {
                if (!isFrontierSavePath(changedName)) return;
                this.changedPaths.add(changedName === null ? '' : String(changedName));
                this.schedule();
            },
        );
        this.watcher.on?.('error', error => {
            // A watcher error must not bring down the desktop client. A later
            // scan re-establishes the watcher if the configured path changed.
            console.warn('[FrontierSaveIndexWatcher] File watcher failed:', error.message);
        });
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            const changedPaths = [...this.changedPaths];
            this.changedPaths.clear();
            this.onFilesChanged(changedPaths);
        }, this.debounceMs);
    }

    close() {
        clearTimeout(this.timer);
        this.timer = null;
        this.changedPaths.clear();
        this.watcher?.close();
        this.watcher = null;
    }
}

module.exports = {
    FrontierSaveIndexWatcher,
    SUPPORTED_SAVE_EXTENSIONS,
    isFrontierSavePath,
};
