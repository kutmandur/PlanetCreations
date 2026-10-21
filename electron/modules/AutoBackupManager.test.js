const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { AutoBackupManager, validateAutoBackupSource } = require('./AutoBackupManager');

async function fixture(t, overrides = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-auto-backup-'));
    const save = path.join(root, 'Frontier', 'Planet Zoo', 'Saves', 'important.zoo');
    await fs.mkdir(path.dirname(save), { recursive: true });
    await fs.writeFile(save, 'initial');
    let now = 10000;
    let revision = 0;
    const backups = [];
    const options = {
        settingsPath: path.join(root, 'settings.json'),
        validatePath: file => validateAutoBackupSource(file, path.join(root, 'Frontier')),
        createBackup: async file => { backups.push(await fs.readFile(file, 'utf8')); return 'archive.PlanetCreations'; },
        now: () => now,
        ...overrides,
    };
    const manager = new AutoBackupManager(options);
    t.after(async () => {
        await manager.stop();
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('pc-auto-backup-'));
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, save, manager, options, backups,
        advance: ms => { now += ms; },
        write: async text => {
            await fs.writeFile(save, text);
            await fs.utimes(save, new Date(), new Date(100000 + (++revision * 1000)));
        },
    };
}

test('only opted-in files are backed up after writes settle; duplicate ticks do not create versions', async t => {
    const f = await fixture(t);
    await f.write('not enabled'); await f.manager.tick();
    assert.equal(f.backups.length, 0);
    await f.manager.setEnabled(f.save, true);
    await f.manager.tick();
    assert.equal(f.backups.length, 0);
    await f.write('writing'); await f.manager.tick();
    f.advance(2000); await f.write('completed'); await f.manager.tick();
    f.advance(2000); await f.manager.tick();
    assert.equal(f.backups.length, 0);
    f.advance(1000); await f.manager.tick(); await f.manager.tick();
    assert.deepEqual(f.backups, ['completed']);
    assert.ok(f.manager.snapshot()[f.save].lastBackupAt);
    await f.write('second save'); await f.manager.tick(); f.advance(3000); await f.manager.tick();
    assert.deepEqual(f.backups, ['completed', 'second save']);
});

test('settings survive restart and disabling cancels a pending backup', async t => {
    const f = await fixture(t);
    await f.manager.setEnabled(f.save, true);
    const restarted = new AutoBackupManager(f.options);
    assert.equal(restarted.snapshot()[f.save].enabled, true);
    await restarted.tick(); assert.equal(f.backups.length, 0);
    await f.write('new save'); await restarted.tick();
    await restarted.setEnabled(f.save, false); f.advance(4000); await restarted.tick();
    assert.equal(f.backups.length, 0);
    assert.deepEqual(new AutoBackupManager(f.options).snapshot(), {});
    await restarted.stop();
});

test('disk errors are shown, retry is delayed, and a successful retry clears the error', async t => {
    let attempts = 0;
    const f = await fixture(t, { createBackup: async () => { if (++attempts === 1) throw new Error('Disk full'); return 'ok'; } });
    await f.manager.setEnabled(f.save, true);
    await f.write('new save'); await f.manager.tick(); f.advance(3000); await f.manager.tick();
    assert.equal(f.manager.snapshot()[f.save].error, 'Disk full');
    await f.manager.tick(); assert.equal(attempts, 1);
    f.advance(30000); await f.manager.tick(); f.advance(3000); await f.manager.tick();
    assert.equal(attempts, 2);
    assert.equal(f.manager.snapshot()[f.save].error, null);
});

test('temporary disappearance/atomic replacement does not disable a file', async t => {
    const f = await fixture(t);
    await f.manager.setEnabled(f.save, true);
    await fs.unlink(f.save); await f.manager.tick();
    assert.equal(f.manager.snapshot()[f.save].enabled, true);
    await f.write('replacement'); f.advance(30000); await f.manager.tick();
    f.advance(3000); await f.manager.tick();
    assert.deepEqual(f.backups, ['replacement']);
});

test('concurrent ticks share one job and shutdown waits for its completion', async t => {
    let finish;
    const f = await fixture(t, { createBackup: () => new Promise(resolve => { finish = resolve; }) });
    await f.manager.setEnabled(f.save, true);
    await f.write('new save'); await f.manager.tick(); f.advance(3000);
    const first = f.manager.tick();
    assert.equal(f.manager.tick(), first);
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    let stopped = false;
    const stopping = f.manager.stop().then(() => { stopped = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
    finish('ok'); await stopping; assert.equal(stopped, true);
});

test('validation rejects files outside the configured saves and unsupported extensions', async t => {
    const f = await fixture(t);
    const outside = path.join(f.root, 'outside.zoo'); await fs.writeFile(outside, 'data');
    await assert.rejects(f.manager.setEnabled(outside, true), /configured Frontier/);
    const unsupported = path.join(path.dirname(f.save), 'notes.txt'); await fs.writeFile(unsupported, 'data');
    await assert.rejects(f.manager.setEnabled(unsupported, true), /supported save/);
    await assert.rejects(f.manager.setEnabled(f.save, 'true'), /valid game file/);
    assert.deepEqual(f.manager.snapshot(), {});
});

test('corrupt configuration is reported and not silently overwritten', async t => {
    const f = await fixture(t);
    await fs.writeFile(f.options.settingsPath, '{broken');
    assert.throws(() => new AutoBackupManager(f.options));
    assert.equal(await fs.readFile(f.options.settingsPath, 'utf8'), '{broken');
});

test('retries a failed settings write without duplicating an already completed archive', async t => {
    const f = await fixture(t);
    await f.manager.setEnabled(f.save, true);
    const persist = f.manager.persist.bind(f.manager);
    f.manager.persist = () => { throw new Error('Settings disk unavailable'); };
    await f.write('new save'); await f.manager.tick(); f.advance(3000); await f.manager.tick();
    assert.deepEqual(f.backups, ['new save']);
    assert.equal(f.manager.snapshot()[f.save].error, 'Settings disk unavailable');
    f.manager.persist = persist;
    f.advance(30000); await f.manager.tick();
    assert.equal(f.backups.length, 1);
    assert.equal(f.manager.snapshot()[f.save].error, null);
    assert.ok(new AutoBackupManager(f.options).snapshot()[f.save].lastBackupAt);
});
