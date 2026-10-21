const fs = require('node:fs');
const path = require('node:path');
const { isFrontierSavePath } = require('./FrontierSaveIndexWatcher');

async function validateAutoBackupSource(filePath, root) {
    if (!root) throw new Error('Select your Frontier folder in the Offline Manager.');
    const [source, base] = await Promise.all([fs.promises.realpath(filePath), fs.promises.realpath(root)]);
    const relative = path.relative(base, source);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !isFrontierSavePath(relative)) {
        throw new Error('Automatic backups require a supported save inside your configured Frontier folder.');
    }
    return source;
}

const signature = stat => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

class AutoBackupManager {
    constructor({ settingsPath, validatePath, createBackup, onChange = () => {}, onBackup = () => {}, settleMs = 3000, now = Date.now }) {
        Object.assign(this, { settingsPath, validatePath, createBackup, onChange, onBackup, settleMs, now });
        this.entries = new Map();
        this.pending = new Map();
        this.stopped = false;
        try {
            const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (stored.version !== 1 || !Array.isArray(stored.files)) throw new Error('Invalid automatic backup settings.');
            for (const entry of stored.files) {
                if (typeof entry.filePath !== 'string' || !path.isAbsolute(entry.filePath)) continue;
                this.entries.set(path.resolve(entry.filePath), {
                    filePath: path.resolve(entry.filePath), lastSignature: entry.lastSignature,
                    lastBackupAt: entry.lastBackupAt || null, error: null,
                });
            }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }

    snapshot() { return Object.fromEntries([...this.entries].map(([key, entry]) => [key, { enabled: true, lastBackupAt: entry.lastBackupAt, error: entry.error }])); }

    persist() {
        fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
        const temp = `${this.settingsPath}.tmp`;
        try {
            fs.writeFileSync(temp, JSON.stringify({ version: 1, files: [...this.entries.values()].map(({ error, retryAt, dirty, ...entry }) => entry) }), { mode: 0o600 });
            fs.renameSync(temp, this.settingsPath);
        } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }

    async setEnabled(filePath, enabled) {
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || typeof enabled !== 'boolean') throw new Error('Select a valid game file and backup setting.');
        const key = path.resolve(filePath);
        const previous = this.entries.get(key);
        if (enabled) {
            if (previous) return this.snapshot();
            const source = await this.validatePath(key);
            const stat = await fs.promises.stat(source);
            if (!stat.isFile() || !stat.size) throw new Error('Select a non-empty game save.');
            this.entries.set(key, { filePath: key, lastSignature: signature(stat), lastBackupAt: null, error: null });
        } else this.entries.delete(key);
        try { this.persist(); }
        catch (error) { if (previous) this.entries.set(key, previous); else this.entries.delete(key); throw error; }
        this.pending.delete(key);
        this.onChange(this.snapshot());
        return this.snapshot();
    }

    start() {
        this.timer = setInterval(() => { void this.tick(); }, 1000);
        this.timer.unref?.();
    }

    tick() {
        if (this.stopped) return Promise.resolve();
        if (this.inFlight) return this.inFlight;
        this.inFlight = this.scan().finally(() => { this.inFlight = null; });
        return this.inFlight;
    }

    async scan() {
        // One archive at a time avoids competing for disk and memory.
        for (const [key, entry] of this.entries) {
            if (this.stopped) break;
            if (entry.retryAt > this.now()) continue;
            try {
                if (entry.dirty) {
                    this.persist();
                    entry.dirty = false;
                    entry.error = null;
                    this.onChange(this.snapshot());
                }
                const source = await this.validatePath(key);
                const stat = await fs.promises.stat(source);
                if (!stat.isFile() || !stat.size) throw new Error('The save is empty or unavailable.');
                const current = signature(stat);
                if (current === entry.lastSignature) {
                    this.pending.delete(key);
                    if (entry.error) { entry.error = null; delete entry.retryAt; this.onChange(this.snapshot()); }
                    continue;
                }
                const pending = this.pending.get(key);
                if (!pending || pending.signature !== current) {
                    this.pending.set(key, { signature: current, since: this.now() });
                    continue;
                }
                if (this.now() - pending.since < this.settleMs || this.entries.get(key) !== entry || this.stopped) continue;
                const destination = await this.createBackup(source);
                this.onBackup(destination);
                // Disabling stops subsequent jobs; an archive already running may finish.
                if (this.entries.get(key) === entry) {
                    entry.lastSignature = current;
                    entry.lastBackupAt = new Date(this.now()).toISOString();
                    entry.error = null;
                    delete entry.retryAt;
                    this.pending.delete(key);
                    entry.dirty = true;
                    this.persist();
                    entry.dirty = false;
                    this.onChange(this.snapshot());
                }
            } catch (error) {
                if (this.entries.get(key) !== entry) continue;
                const changed = entry.error !== error.message;
                entry.error = error.message;
                entry.retryAt = this.now() + (/file (changed|grew)/i.test(error.message) ? 1000 : 30000);
                this.pending.delete(key);
                if (changed) this.onChange(this.snapshot());
            }
        }
    }

    async stop() {
        this.stopped = true;
        clearInterval(this.timer);
        await this.inFlight;
    }
}

module.exports = { AutoBackupManager, validateAutoBackupSource };
