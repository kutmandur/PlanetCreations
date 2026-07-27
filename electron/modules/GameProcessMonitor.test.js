const test = require('node:test');
const assert = require('node:assert/strict');
const {
    GAME_PROCESSES,
    detectActiveGameFromTasklist,
} = require('./GameProcessMonitor');

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
