const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_DEV_SERVER_URL,
    resolveDevServerUrl,
} = require('./DevServerUrl');

test('uses the standard React development server by default', () => {
    assert.equal(resolveDevServerUrl(), DEFAULT_DEV_SERVER_URL);
});

test('allows isolated HTTP development servers on loopback addresses', () => {
    assert.equal(resolveDevServerUrl('http://localhost:3100/preview'), 'http://localhost:3100');
    assert.equal(resolveDevServerUrl('http://127.0.0.1:3200'), 'http://127.0.0.1:3200');
    assert.equal(resolveDevServerUrl('http://[::1]:3300'), 'http://[::1]:3300');
});

test('rejects remote, encrypted, authenticated, and malformed development URLs', () => {
    for (const unsafeUrl of [
        'https://localhost:3100',
        'http://example.com:3100',
        'http://user:password@localhost:3100',
        'not-a-url',
    ]) {
        assert.equal(resolveDevServerUrl(unsafeUrl), DEFAULT_DEV_SERVER_URL);
    }
});
