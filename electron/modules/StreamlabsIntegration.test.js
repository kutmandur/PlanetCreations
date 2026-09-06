const test = require('node:test');
const assert = require('node:assert/strict');

const { StreamlabsIntegration, normalizeStreamingStatus } = require('./StreamlabsIntegration');

test('normalizes legacy and Dual Output streaming status models', () => {
    assert.equal(normalizeStreamingStatus('live'), 'live');
    assert.equal(normalizeStreamingStatus('offline'), 'offline');
    assert.equal(normalizeStreamingStatus({
        status: {
            horizontal: { streaming: 'live' },
            vertical: { streaming: 'offline' },
        },
        streamingStatus: 'offline',
    }), 'live');
    assert.equal(normalizeStreamingStatus({
        horizontal: { streaming: 'offline' },
        vertical: { streaming: 'offline' },
    }), 'offline');
    assert.equal(normalizeStreamingStatus({
        horizontal: { streaming: 'starting' },
        vertical: { streaming: 'offline' },
    }), null);
});

test('emits one start and stop event for Dual Output transitions', async () => {
    const events = [];
    const integration = new StreamlabsIntegration({
        getConfig: () => ({ enabled: true }),
        log: { info() {}, warn() {} },
        onEvent: (name, payload) => events.push({ name, payload }),
    });
    integration.refreshService = async () => { integration.service = 'Twitch'; };

    await integration.handleStreamingStatus({
        horizontal: { streaming: 'live' },
        vertical: { streaming: 'offline' },
    });
    await integration.handleStreamingStatus({
        horizontal: { streaming: 'live' },
        vertical: { streaming: 'live' },
    });
    await integration.handleStreamingStatus({
        horizontal: { streaming: 'offline' },
        vertical: { streaming: 'offline' },
    });

    assert.equal(events.filter(({ name }) => name === 'stream-started').length, 1);
    assert.equal(events.filter(({ name }) => name === 'stream-stopped').length, 1);
    assert.equal(integration.streaming, false);
});
