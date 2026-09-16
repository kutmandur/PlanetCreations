const test = require('node:test');
const assert = require('node:assert/strict');
const {
    StreamCommandContextResolver,
    YouTubeChatAdapter,
    builderChatMessage,
    builderUrl,
    communityChatMessage,
    communityUrl,
    creationChatMessage,
    creationUrl,
    expandPlatformSessions,
    getChatCommand,
    isCreationCommand,
    platformLinkMatchesSession,
    streamCommandChatMessage,
    twitchChannelLogin,
    youtubeChannelId,
    youtubeApiError,
} = require('./streamChatBots');

test('matches the creation chat command case-insensitively', () => {
    assert.equal(isCreationCommand('!Creation'), true);
    assert.equal(isCreationCommand(' !creation please'), true);
    assert.equal(isCreationCommand('creation'), false);
});

test('recognizes builder and community commands case-insensitively', () => {
    assert.equal(getChatCommand('!Builder'), 'builder');
    assert.equal(getChatCommand('  !COMMUNITY  '), 'community');
    assert.equal(getChatCommand('!builders'), null);
    assert.equal(getChatCommand('hello'), null);
});

test('expands one simulcast session for both chat adapters', () => {
    const sessions = expandPlatformSessions([{
        uid: 'owner-1',
        sessionId: 'session-1',
        creationId: 'creation-1',
        streams: {
            twitch: {
                url: 'https://twitch.tv/builder',
                broadcasterLogin: 'builder',
            },
            youtube: {
                url: 'https://youtu.be/abcdefghijk',
                platformStreamId: 'abcdefghijk',
            },
        },
    }]);
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((session) => session.platform).sort(), ['twitch', 'youtube']);
    assert.ok(sessions.every((session) => session.creationId === 'creation-1'));
});

test('reports the actionable YouTube API error reason', async () => {
    const error = await youtubeApiError({
        status: 403,
        json: async () => ({error: {errors: [{reason: 'insufficientPermissions'}]}}),
    }, 'read live chat');
    assert.match(error.message, /403.*insufficientPermissions/);
});

test('handles a new command received by the first YouTube streamed response', async () => {
    const originalFetch = global.fetch;
    const responses = [];
    const now = Date.now();
    global.fetch = async (url, options = {}) => {
        if (String(url).includes('/liveChat/messages') && options.method === 'POST') {
            responses.push(JSON.parse(options.body).snippet.textMessageDetails.messageText);
            return {ok: true, status: 200};
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({
                nextPageToken: 'next',
                pollingIntervalMillis: 60_000,
                items: [{
                    id: 'message-1',
                    snippet: {
                        displayMessage: '!creation',
                        publishedAt: new Date(now + 1_000).toISOString(),
                    },
                }],
            }),
        };
    };
    try {
        const adapter = new YouTubeChatAdapter(null, {
            contextResolver: {resolveBuilder: async () => null, resolveCommunity: async () => null},
        });
        adapter.accessToken = 'token';
        adapter.accessTokenExpiresAt = Date.now() + 120_000;
        const state = {
            videoId: 'abcdefghijk',
            session: {platformStreamId: 'abcdefghijk', creationId: 'park-1'},
            liveChatId: 'chat-1',
            pageToken: null,
            seen: new Set(),
            timer: null,
            initialized: false,
            startedAt: now,
            lastError: null,
        };
        adapter.pollers.set(state.videoId, state);
        await adapter.handlePage(state, await (await global.fetch('test')).json());
        clearTimeout(state.timer);
        assert.equal(responses.length, 1);
        assert.match(responses[0], /planetcreations\.net/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('builds the current creation link from server session state', () => {
    assert.equal(
        creationUrl({creationId: 'park_1'}),
        'https://planetcreations.net/#/creation/park_1',
    );
});

test('builds the creation chat response with its title and link', () => {
    assert.equal(
        creationChatMessage({creationId: 'park_1', creationTitle: 'Generic Islands'}),
        'Visit Generic Islands on PlanetCreations. https://planetcreations.net/#/creation/park_1',
    );
});

test('builds safe builder and community responses', () => {
    const session = {uid: 'builder/one'};
    const community = {slug: 'coaster-friends', name: 'Coaster\r\nFriends'};
    assert.equal(
        builderUrl(session),
        'https://planetcreations.net/#/profile/builder%2Fone',
    );
    assert.equal(
        builderChatMessage(session, {username: 'Planet\nBuilder'}),
        "Visit Planet Builder's builder profile on PlanetCreations. " +
        'https://planetcreations.net/#/profile/builder%2Fone',
    );
    assert.equal(
        communityUrl(community),
        'https://planetcreations.net/#/community/coaster-friends',
    );
    assert.equal(
        communityChatMessage(community),
        'Visit Coaster Friends on PlanetCreations. ' +
        'https://planetcreations.net/#/community/coaster-friends',
    );
});

test('matches Twitch community links to the active broadcaster', async () => {
    assert.equal(twitchChannelLogin('https://www.twitch.tv/CoastingThroughMedia'), 'coastingthroughmedia');
    assert.equal(twitchChannelLogin('https://twitch.tv.evil.example/coastingthroughmedia'), null);
    assert.equal(await platformLinkMatchesSession(
        'https://www.twitch.tv/CoastingThroughMedia',
        {platform: 'twitch', broadcasterLogin: 'coastingthroughmedia'},
    ), true);
    assert.equal(await platformLinkMatchesSession(
        'https://www.twitch.tv/someoneelse',
        {platform: 'twitch', broadcasterLogin: 'coastingthroughmedia'},
    ), false);
});

test('matches direct and handle YouTube links to the active broadcaster', async () => {
    const channelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
    const fetchImpl = async () => ({
        ok: true,
        text: async () => '<script>var ytInitialData = ' + JSON.stringify({metadata: {
            channelMetadataRenderer: {externalId: channelId},
        }}) + ';</script>',
    });
    assert.equal(await youtubeChannelId(`https://youtube.com/channel/${channelId}`), channelId);
    assert.equal(await youtubeChannelId('https://youtube.com/@PlanetBuilders', fetchImpl), channelId);
    assert.equal(await platformLinkMatchesSession(
        'https://youtube.com/@PlanetBuilders',
        {platform: 'youtube', broadcasterId: channelId},
        fetchImpl,
    ), true);
});

test('resolves only communities owned by the streamer with the matching platform link', async () => {
    const profileSnapshot = {
        id: 'owner-1',
        exists: true,
        data: () => ({username: 'Builder One'}),
    };
    const communityDocs = [
        {
            id: 'wrong-channel',
            data: () => ({
                ownerId: 'owner-1',
                name: 'Wrong Channel',
                slug: 'wrong-channel',
                socialLinks: {twitch: 'https://twitch.tv/someoneelse'},
            }),
        },
        {
            id: 'matching-channel',
            data: () => ({
                ownerId: 'owner-1',
                name: 'Coaster Friends',
                slug: 'coaster-friends',
                socialLinks: {twitch: 'https://twitch.tv/coastingthroughmedia'},
            }),
        },
    ];
    const db = {
        doc: (path) => ({
            get: async () => path === 'profiles/owner-1' ? profileSnapshot : {exists: false},
        }),
        collection: (name) => ({
            where: (field, operator, value) => {
                assert.deepEqual([name, field, operator, value], [
                    'communitys', 'ownerId', '==', 'owner-1',
                ]);
                return {get: async () => ({docs: communityDocs})};
            },
        }),
    };
    const resolver = new StreamCommandContextResolver(db);
    const session = {
        uid: 'owner-1',
        sessionId: 'session-1',
        platform: 'twitch',
        broadcasterLogin: 'coastingthroughmedia',
    };

    assert.equal(
        await streamCommandChatMessage('builder', session, resolver),
        "Visit Builder One's builder profile on PlanetCreations. " +
        'https://planetcreations.net/#/profile/owner-1',
    );
    assert.equal(
        await streamCommandChatMessage('community', session, resolver),
        'Visit Coaster Friends on PlanetCreations. ' +
        'https://planetcreations.net/#/community/coaster-friends',
    );
});

test('stays silent for community when no owned community has the stream channel link', async () => {
    const db = {
        collection: () => ({
            where: () => ({get: async () => ({docs: [{
                id: 'community-1',
                data: () => ({
                    name: 'No Link Community',
                    slug: 'no-link',
                    socialLinks: {},
                }),
            }]})}),
        }),
    };
    const resolver = new StreamCommandContextResolver(db);
    const message = await streamCommandChatMessage('community', {
        uid: 'owner-1',
        platform: 'twitch',
        broadcasterLogin: 'coastingthroughmedia',
    }, resolver);
    assert.equal(message, null);
});

test('preloads builder data once and keeps it for the stream session', async () => {
    let profileReads = 0;
    let communityReads = 0;
    const db = {
        doc: () => ({get: async () => {
            profileReads += 1;
            return {id: 'owner-1', exists: true, data: () => ({username: 'Builder One'})};
        }}),
        collection: () => ({where: () => ({get: async () => {
            communityReads += 1;
            return {docs: []};
        }})}),
    };
    const resolver = new StreamCommandContextResolver(db);
    const session = {
        uid: 'owner-1',
        sessionId: 'session-1',
        platform: 'twitch',
        broadcasterLogin: 'builderone',
    };
    const youtubeSession = {
        ...session,
        platform: 'youtube',
        broadcasterLogin: null,
        broadcasterId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
    };
    resolver.prefetchSessions([session, youtubeSession]);
    await resolver.resolveBuilder(session);
    await resolver.resolveBuilder(youtubeSession);
    await resolver.resolveOwnedCommunities(session);
    await resolver.resolveOwnedCommunities(youtubeSession);
    await resolver.resolveBuilder({...session, creationId: 'changed-creation'});
    assert.equal(profileReads, 1);
    assert.equal(communityReads, 1);

    resolver.prefetchSessions([]);
    await resolver.resolveBuilder({...session, sessionId: 'session-2'});
    assert.equal(profileReads, 2);
});
