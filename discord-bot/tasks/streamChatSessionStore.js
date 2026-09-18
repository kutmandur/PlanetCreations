const fs = require('node:fs');
const path = require('node:path');

// Only session decisions and message IDs live here, never credentials or chat content.
// Writes precede chat posts so a process restart cannot duplicate an ambiguous send.
class StreamChatSessionStore {
    constructor(filePath = null) {
        this.filePath = filePath;
        this.records = new Map();
        if (filePath && fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data.version !== 1 || !Array.isArray(data.records)) throw new Error('Invalid stream chat session cache');
            this.records = new Map(data.records);
        }
    }

    get(key) {
        return this.records.get(key) || {};
    }

    save(key, changes) {
        const updated = {...this.get(key), ...changes};
        const next = new Map(this.records);
        next.set(key, updated);
        this.commit(next);
    }

    retain(keys) {
        const active = new Set(keys);
        const next = new Map([...this.records].filter(([key]) => active.has(key)));
        if (next.size !== this.records.size) this.commit(next);
    }

    commit(next) {
        if (this.filePath) {
            fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
            const temporary = `${this.filePath}.${process.pid}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify({version: 1, records: [...next]}), {mode: 0o600});
            fs.renameSync(temporary, this.filePath);
        }
        this.records = next;
    }
}

module.exports = {StreamChatSessionStore};
