const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {YouTubeChatAdapter} = require('./streamChatBots');
const {youtubeRetryDelay} = require('./youtubeChatStream');
const {StreamChatSessionStore} = require('./streamChatSessionStore');

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
    adapter.postChatMessage = async () => ({id: 'probe-id'});
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
    adapter.postChatMessage = async () => { throw new Error('Stopped session must not post'); };
    adapter.syncSessions([{platform: 'youtube', platformStreamId: 'WYAuABQAB5Q'}]);
    adapter.syncSessions([]);
    finish('chat-id');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opened, 0);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

function youtubeHarness(t, {sessionStore} = {}) {
    const streams = [];
    const messages = [];
    const resolver = {
        resolveBuilder: t.mock.fn(async () => ({username: 'Builder'})),
        resolveCommunity: t.mock.fn(async () => ({slug: 'builders'})),
    };
    const adapter = new YouTubeChatAdapter(null, {
        contextResolver: resolver,
        sessionStore,
        openStream: () => {
            const stream = new EventEmitter();
            stream.pause = stream.resume = () => {};
            stream.cancel = t.mock.fn(() => stream.emit('error', new Error('CANCELLED')));
            streams.push(stream);
            return stream;
        },
    });
    adapter.clientId = adapter.clientSecret = adapter.refreshToken = 'test';
    adapter.getAccessToken = async () => 'test';
    adapter.resolveLiveChatId = t.mock.fn(async () => 'chat-1');
    // Exercise the actual HTTP write implementation; never contact YouTube in tests.
    t.mock.method(global, 'fetch', async (url, options) => {
        assert.equal(url, 'https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet');
        assert.equal(options.method, 'POST');
        messages.push(JSON.parse(options.body).snippet.textMessageDetails.messageText);
        return {ok: true, json: async () => ({id: `message-${messages.length}`})};
    });
    const session = {uid: 'owner', sessionId: 'session-1', platform: 'youtube',
        platformStreamId: 'abcdefghijk', creationId: 'park-1'};
    const page = (items) => streams.at(-1).emit('data', {items, nextPageToken: 'next'});
    const confirm = (isChatModerator = true, id = 'message-1') => page([
        {id, authorDetails: {isChatModerator}, snippet: {displayMessage: messages[0]}},
    ]);
    const command = (id = 'command-1') => page([{id, snippet: {
        displayMessage: '!creation', publishedAt: new Date().toISOString(),
    }}]);
    t.after(() => adapter.syncSessions([]));
    return {adapter, session, streams, messages, resolver, page, confirm, command};
}

test('YouTube posts one probe, requires its own moderator confirmation, greets once, then handles commands', async (t) => {
    const {adapter, session, messages, resolver, streams, page, confirm, command} = youtubeHarness(t);
    adapter.syncSessions([session]);
    await settle();
    assert.equal(messages.length, 1);
    assert.match(messages[0], /checking moderator permissions/);
    assert.equal(resolver.resolveBuilder.mock.callCount(), 0);
    // Another moderator copying the probe text must not qualify the bot.
    confirm(true, 'someone-elses-message');
    command();
    await settle();
    assert.equal(messages.length, 1);
    confirm();
    await settle();
    assert.equal(messages.length, 2);
    assert.match(messages[1], /Hi chat! I'm the PlanetCreations bot/);
    for (const commandName of ['!creation', '!builder', '!community']) assert.ok(messages[1].includes(commandName));
    command('command-2');
    await settle();
    assert.equal(messages.length, 3);
    assert.match(messages[2], /creation\/park-1/);
    adapter.syncSessions([{...session, creationId: 'park-2'}]);
    page([]);
    await settle();
    assert.equal(messages.length, 3);
    assert.equal(streams.length, 1);
});

test('YouTube stops a non-moderator session with no greeting, context reads or repeated probes', async (t) => {
    const {adapter, session, messages, resolver, streams, confirm, command} = youtubeHarness(t);
    adapter.syncSessions([session]);
    await settle();
    confirm(false);
    await settle();
    adapter.syncSessions([{...session, creationId: 'park-2', revision: 2}]);
    await adapter.connectStream(adapter.pollers.get(session.platformStreamId));
    command();
    await settle();
    assert.equal(messages.length, 1);
    assert.equal(resolver.resolveBuilder.mock.callCount(), 0);
    assert.equal(resolver.resolveCommunity.mock.callCount(), 0);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].cancel.mock.callCount(), 1);
    assert.equal(adapter.pollers.get(session.platformStreamId).roleStatus, 'ignored');
});

test('YouTube cannot infer permission from an accepted message with no role metadata', async (t) => {
    const {adapter, session, messages, page} = youtubeHarness(t);
    adapter.syncSessions([session]);
    await settle();
    page([{id: 'message-1', snippet: {displayMessage: messages[0]}}]);
    await settle();
    assert.equal(messages.length, 1);
    assert.equal(adapter.pollers.get(session.platformStreamId).roleStatus, 'ignored');
});

test('a YouTube probe timeout cancels the chat and prevents late confirmations and retries', async (t) => {
    t.mock.timers.enable({apis: ['setTimeout']});
    const {adapter, session, messages, streams, confirm} = youtubeHarness(t);
    adapter.syncSessions([session]);
    await settle();
    t.mock.timers.tick(45_000);
    confirm();
    await settle();
    t.mock.timers.tick(300_000);
    assert.equal(messages.length, 1);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].cancel.mock.callCount(), 1);
    assert.equal(adapter.pollers.get(session.platformStreamId).roleStatus, 'ignored');
});

test('a new YouTube session on the same video checks again after the previous one was ignored', async (t) => {
    const {adapter, session, messages, confirm} = youtubeHarness(t);
    adapter.syncSessions([session]);
    await settle();
    confirm(false);
    await settle();
    adapter.syncSessions([{...session, sessionId: 'session-2'}]);
    await settle();
    confirm(true, 'message-2');
    await settle();
    assert.equal(messages.filter((text) => text.includes('checking moderator permissions')).length, 2);
    assert.equal(messages.filter((text) => text.includes("Hi chat! I'm the PlanetCreations bot")).length, 1);
});

test('YouTube reconnects after confirmation without repeating the probe or greeting', async (t) => {
    t.mock.timers.enable({apis: ['setTimeout']});
    const {adapter, session, messages, streams, confirm} = youtubeHarness(t);
    adapter.syncSessions([session]);
    await settle();
    confirm();
    await settle();
    streams[0].emit('end');
    await settle();
    t.mock.timers.tick(10_000);
    await settle();
    assert.equal(streams.length, 2);
    confirm();
    await settle();
    assert.equal(messages.length, 2);
    t.mock.timers.tick(60_000);
    assert.equal(adapter.pollers.get(session.platformStreamId).ended, undefined);
});

test('YouTube never repeats an ambiguous failed probe write', async (t) => {
    t.mock.timers.enable({apis: ['setTimeout']});
    const {adapter, session, streams} = youtubeHarness(t);
    const write = t.mock.method(global, 'fetch', async () => {throw new Error('network timeout');});
    adapter.syncSessions([session]);
    await settle();
    adapter.syncSessions([{...session, creationId: 'park-2'}]);
    t.mock.timers.tick(300_000);
    await settle();
    assert.equal(write.mock.callCount(), 1);
    assert.equal(streams.length, 0);
});

test('a failed YouTube greeting does not repeat or disconnect an approved session', async (t) => {
    const {adapter, session, streams, confirm} = youtubeHarness(t);
    let writes = 0;
    t.mock.method(global, 'fetch', async () => {
        writes++;
        if (writes === 2) throw new Error('network timeout after greeting');
        return {ok: true, json: async () => ({id: 'message-1'})};
    });
    adapter.syncSessions([session]);
    await settle();
    confirm();
    await settle();
    confirm();
    await settle();
    assert.equal(writes, 2);
    assert.equal(streams[0].cancel.mock.callCount(), 0);
    assert.equal(adapter.pollers.get(session.platformStreamId).roleStatus, 'allowed');
});

test('YouTube decodes moderator flags from the published protobuf wire field numbers', () => {
    const definition = require('@grpc/proto-loader').loadSync(require('node:path').join(__dirname, 'youtubeChatStream.proto'), {
        longs: String, enums: String, defaults: false,
    });
    const decode = definition['youtube.api.v3.V3DataLiveChatMessageService'].StreamList.responseDeserialize;
    // items=1007, id=101, author_details=3, is_chat_owner=5, is_chat_moderator=7.
    const moderator = decode(Buffer.from('fa3e0eaa060570726f62651a0428003801', 'hex'));
    assert.equal(moderator.items[0].id, 'probe');
    assert.equal(moderator.items[0].authorDetails.isChatModerator, true);
    const viewer = decode(Buffer.from('fa3e0eaa060570726f62651a0428003800', 'hex'));
    assert.equal(viewer.items[0].authorDetails.isChatModerator, false);
});

test('YouTube resumes an approved session after restart without another probe or greeting', async (t) => {
    const sessionStore = new StreamChatSessionStore();
    const first = youtubeHarness(t, {sessionStore});
    first.adapter.syncSessions([first.session]);
    await settle();
    first.confirm();
    await settle();
    first.adapter.syncSessions([]);
    const restarted = youtubeHarness(t, {sessionStore});
    restarted.adapter.syncSessions([first.session]);
    await settle();
    restarted.page([]);
    await settle();
    assert.equal(restarted.messages.length, 0);
    assert.equal(restarted.streams.length, 1);
    assert.equal(restarted.adapter.resolveLiveChatId.mock.callCount(), 0);
    restarted.command();
    await settle();
    assert.equal(restarted.messages.length, 1);
    assert.match(restarted.messages[0], /creation\/park-1/);
});

test('YouTube keeps an ignored session silent after restart without any API requests', async (t) => {
    const sessionStore = new StreamChatSessionStore();
    const first = youtubeHarness(t, {sessionStore});
    first.adapter.syncSessions([first.session]);
    await settle();
    first.confirm(false);
    await settle();
    first.adapter.syncSessions([]);
    const restarted = youtubeHarness(t, {sessionStore});
    restarted.adapter.syncSessions([first.session]);
    await settle();
    assert.equal(restarted.messages.length, 0);
    assert.equal(restarted.streams.length, 0);
    assert.equal(restarted.adapter.resolveLiveChatId.mock.callCount(), 0);
});

test('a crash during a YouTube probe cannot repeat an unconfirmed write after restart', async (t) => {
    const sessionStore = new StreamChatSessionStore();
    const first = youtubeHarness(t, {sessionStore});
    let complete;
    t.mock.method(global, 'fetch', () => new Promise((resolve) => {complete = resolve;}));
    first.adapter.syncSessions([first.session]);
    await settle();
    first.adapter.syncSessions([]);
    const restarted = youtubeHarness(t, {sessionStore});
    restarted.adapter.syncSessions([first.session]);
    await settle();
    assert.equal(restarted.messages.length, 0);
    assert.equal(restarted.streams.length, 0);
    complete({ok: true, json: async () => ({id: 'late-probe'})});
    await settle();
    assert.equal(first.streams.length, 0);
});
