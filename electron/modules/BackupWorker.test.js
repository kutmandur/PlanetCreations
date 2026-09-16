const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {runBackupJob} = require('./BackupJobs');
test('backup worker rejects files changed between hashing and archive creation and recovers for later jobs', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-worker-test-'));
    const source = path.join(directory, 'park.park2');
    const destination = path.join(directory, 'park.PlanetCreations');
    try {
        await fs.writeFile(source, 'original');
        const hash = await runBackupJob('hash', {path: source});
        await fs.writeFile(source, 'modified');
        await assert.rejects(runBackupJob('archive', {sourcePath: source, destination, metadata: {payloadSize: hash.size, payloadSha256: hash.sha256}, manifest: '{}'}), /changed/);
        await assert.rejects(fs.stat(destination), {code: 'ENOENT'});
        const updated = await runBackupJob('hash', {path: source});
        assert.notEqual(updated.sha256, hash.sha256);
        await assert.rejects(runBackupJob('hash', {path: source, maxBytes: 2}), /between 1 byte/);
    } finally { await fs.unlink(source); await fs.rmdir(directory); }
});
