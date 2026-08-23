const test = require('node:test');
const assert = require('node:assert/strict');
const { PreparedUploadRegistry } = require('./PreparedUploadRegistry');

test('prepared upload handles are opaque and single use', () => {
    const registry = new PreparedUploadRegistry();
    const handle = registry.register({ filePath: 'C:\\Temp\\creation.PlanetCreations' });

    assert.match(handle, /^[0-9a-f-]{36}$/i);
    assert.equal(registry.take(handle).filePath, 'C:\\Temp\\creation.PlanetCreations');
    assert.equal(registry.take(handle), null);
});

test('expired prepared uploads cannot be consumed', () => {
    let now = 1_000;
    const expired = [];
    const registry = new PreparedUploadRegistry({ ttlMs: 50, now: () => now });
    const handle = registry.register({ filePath: 'expired' });

    now = 1_051;
    registry.prune(entry => expired.push(entry.filePath));
    assert.deepEqual(expired, ['expired']);
    assert.equal(registry.take(handle), null);
});
