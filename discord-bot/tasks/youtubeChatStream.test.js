const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {YouTubeChatAdapter} = require('./streamChatBots');
const {youtubeRetryDelay} = require('./youtubeChatStream');

test('daily quota errors pause until the next YouTube reset', () => {
    const now = Date.parse('2026-09-15T02:00:00Z');
    const delay = youtubeRetryDelay(new Error('403: quotaExceeded'), 0, now);
    assert.equal(new Date(now + delay).toISOString(), '2026-09-15T07:01:00.000Z');
    assert.equal(youtubeRetryDelay(new Error('network'), 30), 300000);
    for (const [start, expected] of [
        ['2026-03-08T09:00:00Z', '2026-03-09T07:01:00.000Z'],
        ['2026-11-01T08:00:00Z', '2026-11-02T08:01:00.000Z'],
    ]) {
        const current = Date.parse(start);
        const grpcQuota = new Error('8 RESOURCE_EXHAUSTED: Quota exceeded for quota metric Queries');
        assert.equal(new Date(current + youtubeRetryDelay(grpcQuota, 0, current)).toISOString(), expected);
    }
});
test('simulcast opens one YouTube stream, reuses it on creation switch, cancels on stop', async () => {
    let opened = 0;
    let cancelled = 0;
    const adapter = new YouTubeChatAdapter(null, {
        contextResolver: {prefetchSessions() {}},
        openStream: () => {
            opened++;
            const stream = new EventEmitter();
            stream.cancel = () => cancelled++;
            stream.pause = stream.resume = () => {};
            return stream;
        },
    });
    adapter.clientId = adapter.clientSecret = adapter.refreshToken = 'test';
    adapter.getAccessToken = async () => 'test';
    adapter.resolveLiveChatId = async () => 'chat-id';
    const session = {platform: 'youtube', platformStreamId: 'WYAuABQAB5Q', creationId: 'first'};
    adapter.syncSessions([session, {platform: 'twitch'}]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opened, 1);
    adapter.syncSessions([{...session, creationId: 'second'}]);
    assert.equal(opened, 1);
    assert.equal(adapter.pollers.get(session.platformStreamId).session.creationId, 'second');
    adapter.syncSessions([]);
    assert.equal(cancelled, 1);
    assert.equal(adapter.pollers.size, 0);
});
test('a stopped session cannot connect after an in-flight lookup completes', async () => {
    let finish;
    let opened = 0;
    const adapter = new YouTubeChatAdapter(null, {
        contextResolver: {prefetchSessions() {}}, openStream: () => { opened++; },
    });
    adapter.clientId = adapter.clientSecret = adapter.refreshToken = 'test';
    adapter.getAccessToken = async () => 'test';
    adapter.resolveLiveChatId = () => new Promise((resolve) => { finish = resolve; });
    adapter.syncSessions([{platform: 'youtube', platformStreamId: 'WYAuABQAB5Q'}]);
    adapter.syncSessions([]);
    finish('chat-id');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opened, 0);
});
