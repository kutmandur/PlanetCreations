const test = require('node:test');
const assert = require('node:assert/strict');
const {
    GAME_PROCESSES,
    detectActiveGameFromTasklist,
    detectActiveGameFromLinuxProcesses,
    detectActiveGameFromProc,
} = require('./GameProcessMonitor');

test('Linux detects full executable paths despite the truncated kernel process name', () => {
    assert.equal(detectActiveGameFromLinuxProcesses([
        { comm: 'PlanetCoaster2.e\n', cmdline: '/home/user/Steam Library/Planet Coaster 2/PlanetCoaster2.exe\0' },
    ]), 'planet-coaster-2');
    assert.equal(detectActiveGameFromLinuxProcesses([
        { cmdline: 'Z:\\games\\Planet Zoo\\PLANETZOO.EXE\0-windowed\0' },
    ]), 'planet-zoo');
});

test('Linux accepts Wine loaders and exact game comm names', () => {
    for (const loader of ['wine', 'wine64', 'wine-preloader', 'wine64-preloader']) {
        assert.equal(detectActiveGameFromLinuxProcesses([
            { cmdline: `/opt/proton/bin/${loader}\0C:\\games\\PlanetZoo2.exe\0` },
        ]), 'planet-zoo-2');
    }
    assert.equal(detectActiveGameFromLinuxProcesses([
        { comm: 'PlanetZoo.exe\n', cmdline: '/opt/proton/bin/wine64-preloader\0' },
    ]), 'planet-zoo');
});

test('Linux ignores zombies, partial names and game paths in supervisor or editor arguments', () => {
    for (const process of [
        { comm: 'PlanetZoo.exe', cmdline: '' },
        { cmdline: 'PlanetZooLauncher.exe\0' },
        { cmdline: '/usr/bin/python3\0/proton\0waitforexitandrun\0/games/PlanetZoo.exe\0' },
        { cmdline: '/usr/bin/sh\0-c\0PlanetZoo.exe\0' },
        { cmdline: 'nano\0/games/PlanetZoo.exe\0' },
        { cmdline: 'wine\0/games/PlanetZoo.exe.bak\0' },
        { comm: 'PlanetCoaster2.e', cmdline: 'unrelated\0' },
    ]) assert.equal(detectActiveGameFromLinuxProcesses([process]), null);
});

test('Linux preserves Windows game priority independently of process enumeration order', () => {
    assert.equal(detectActiveGameFromLinuxProcesses([
        { cmdline: 'PlanetZoo.exe\0' }, { cmdline: 'PlanetCoaster2.exe\0' },
    ]), GAME_PROCESSES[0].gameId);
});

test('proc scanner tolerates exiting and inaccessible processes and detects stop on next scan', async () => {
    let running = true;
    const options = {
        readdir: async () => ['self', 'net', '11', '12', '13'],
        readFile: async file => {
            const normalized = file.replace(/\\/g, '/');
            if (normalized.includes('/11/')) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
            if (normalized.includes('/12/')) throw Object.assign(new Error('restricted'), { code: 'EACCES' });
            return normalized.endsWith('/comm') ? 'PlanetZoo.exe\n' : running ? 'PlanetZoo.exe\0' : '';
        },
    };
    assert.equal(await detectActiveGameFromProc(options), 'planet-zoo');
    running = false;
    assert.equal(await detectActiveGameFromProc(options), null);
});

test('proc scanner propagates unavailable procfs and unexpected I/O errors instead of reporting a stopped game', async () => {
    await assert.rejects(detectActiveGameFromProc({ readdir: async () => { throw new Error('proc unavailable'); } }), /proc unavailable/);
    await assert.rejects(detectActiveGameFromProc({
        readdir: async () => ['1'],
        readFile: async () => { throw Object.assign(new Error('I/O failure'), { code: 'EIO' }); },
    }), /I\/O failure/);
});

test('detects Planet Coaster 2 from tasklist CSV output', () => {
    const output = '"PlanetCoaster2.exe","1234","Console","1","1,024 K"';
    assert.equal(detectActiveGameFromTasklist(output), 'planet-coaster-2');
});

test('detects Planet Zoo from tasklist CSV output', () => {
    const output = '"PlanetZoo.exe","9876","Console","1","2,048 K"';
    assert.equal(detectActiveGameFromTasklist(output), 'planet-zoo');
});

test('does not accept a partial or unrelated process name', () => {
    const output = '"PlanetZooLauncher.exe","9876","Console","1","2,048 K"';
    assert.equal(detectActiveGameFromTasklist(output), null);
});

test('uses the declared priority if both supported games are running', () => {
    const output = [
        '"PlanetZoo.exe","9876","Console","1","2,048 K"',
        '"PlanetCoaster2.exe","1234","Console","1","1,024 K"',
    ].join('\r\n');
    assert.equal(
        detectActiveGameFromTasklist(output),
        GAME_PROCESSES[0].gameId,
    );
});

test('detects Planet Zoo 2 independently of Planet Zoo and ignores launchers', () => {
    assert.equal(detectActiveGameFromTasklist('"PlanetZoo2.exe","42","Console","1","100 K"'), 'planet-zoo-2');
    assert.equal(detectActiveGameFromTasklist('"PLANETZOO2.EXE","42","Console","1","100 K"'), 'planet-zoo-2');
    assert.equal(detectActiveGameFromTasklist('"PlanetZoo2Launcher.exe","42","Console","1","100 K"'), null);
});
