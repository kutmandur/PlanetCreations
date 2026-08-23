const crypto = require('crypto');

const DEFAULT_TTL_MS = 15 * 60 * 1000;

class PreparedUploadRegistry {
    constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        this.entries = new Map();
    }

    register(details) {
        this.prune();
        const handle = crypto.randomUUID();
        this.entries.set(handle, {
            ...details,
            createdAtMs: this.now(),
            expiresAtMs: this.now() + this.ttlMs,
        });
        return handle;
    }

    take(handle) {
        if (typeof handle !== 'string') return null;
        const entry = this.entries.get(handle);
        this.entries.delete(handle);
        if (!entry || entry.expiresAtMs <= this.now()) return null;
        return entry;
    }

    prune(onExpired) {
        const currentTime = this.now();
        for (const [handle, entry] of this.entries) {
            if (entry.expiresAtMs > currentTime) continue;
            this.entries.delete(handle);
            onExpired?.(entry);
        }
    }

    get size() {
        return this.entries.size;
    }
}

module.exports = { DEFAULT_TTL_MS, PreparedUploadRegistry };
