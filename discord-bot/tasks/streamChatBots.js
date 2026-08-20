const CHAT_COMMANDS = Object.freeze({
    creation: /^!creation(?:\s|$)/i,
    builder: /^!builder(?:\s|$)/i,
    community: /^!community(?:\s|$)/i,
});
const COMMAND_COOLDOWN_MS = 60 * 1000;

function safeChatLabel(value, fallback) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200) || fallback;
}

function creationUrl(session) {
    return session?.creationId ?
        `https://planetcreations.net/#/creation/${encodeURIComponent(session.creationId)}` : null;
}

function creationChatMessage(session) {
    const url = creationUrl(session);
    if (!url) return null;
    const title = safeChatLabel(session?.creationTitle, 'this creation');
    return `Visit ${title} on PlanetCreations. ${url}`;
}

function builderUrl(session) {
    return session?.uid ?
        `https://planetcreations.net/#/profile/${encodeURIComponent(session.uid)}` : null;
}

function builderChatMessage(session, profile) {
    const url = builderUrl(session);
    if (!url || !profile) return null;
    const username = safeChatLabel(profile.username, 'this builder');
    return `Visit ${username}'s builder profile on PlanetCreations. ${url}`;
}

function communityUrl(community) {
    return community?.slug ?
        `https://planetcreations.net/#/community/${encodeURIComponent(community.slug)}` : null;
}

function communityChatMessage(community) {
    const url = communityUrl(community);
    if (!url) return null;
    const name = safeChatLabel(community.name, 'this community');
    return `Visit ${name} on PlanetCreations. ${url}`;
}

function getChatCommand(message) {
    const normalized = String(message || '').trim();
    return Object.entries(CHAT_COMMANDS)
        .find(([, pattern]) => pattern.test(normalized))?.[0] || null;
}

function isCreationCommand(message) {
    return getChatCommand(message) === 'creation';
}

function twitchChannelLogin(link) {
    try {
        const parsed = new URL(link);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:' || !['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(host)) {
            return null;
        }
        const login = parsed.pathname.split('/').filter(Boolean)[0] || '';
        return /^[a-zA-Z0-9_]{3,25}$/.test(login) ? login.toLowerCase() : null;
    } catch {
        return null;
    }
}

async function youtubeChannelId(link, fetchImpl = fetch) {
    let parsed;
    try {
        parsed = new URL(link);
    } catch {
        return null;
    }
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (parsed.protocol !== 'https:' || !['youtube.com', 'm.youtube.com'].includes(host)) return null;
    const directMatch = parsed.pathname.match(/^\/channel\/(UC[\w-]{22})(?:\/|$)/);
    if (directMatch) return directMatch[1];

    const channelPath = parsed.pathname.match(/^\/(?:@[^/]+|c\/[^/]+|user\/[^/]+)(?:\/|$)/)?.[0];
    if (!channelPath) return null;
    const channelPage = new URL(channelPath, 'https://www.youtube.com');
    const response = await fetchImpl(channelPage, {
        headers: {
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'PlanetCreationsBot/1.0',
        },
    });
    if (!response.ok) return null;
    const html = await response.text();
    return (html.match(/"channelId":"(UC[\w-]{22})"/) ||
        html.match(/channel_id=(UC[\w-]{22})/))?.[1] || null;
}

async function platformLinkMatchesSession(link, session, fetchImpl = fetch) {
    if (!link || !session) return false;
    if (session.platform === 'twitch') {
        return twitchChannelLogin(link) === String(session.broadcasterLogin || '').toLowerCase();
    }
    if (session.platform === 'youtube' && session.broadcasterId) {
        try {
            return await youtubeChannelId(link, fetchImpl) === session.broadcasterId;
        } catch {
            return false;
        }
    }
    return false;
}

class StreamCommandContextResolver {
    constructor(db, {fetchImpl = fetch} = {}) {
        this.db = db;
        this.fetchImpl = fetchImpl;
        this.builderCache = new Map();
        this.ownedCommunitiesCache = new Map();
        this.communityCache = new Map();
    }

    cacheKey(session) {
        return [
            session?.uid,
            session?.sessionId || session?.platformStreamId,
            session?.platform,
            session?.broadcasterId || session?.broadcasterLogin,
        ].map((value) => String(value || '')).join('|');
    }

    builderCacheKey(session) {
        return [session?.uid, session?.sessionId]
            .map((value) => String(value || '')).join('|');
    }

    async cached(cache, key, loader) {
        const existing = cache.get(key);
        if (existing) return existing;
        const promise = Promise.resolve().then(loader).catch((error) => {
            cache.delete(key);
            throw error;
        });
        cache.set(key, promise);
        if (cache.size > 500) {
            cache.delete(cache.keys().next().value);
        }
        return promise;
    }

    prefetchSessions(sessions) {
        const activeBuilderKeys = new Set(sessions.map((session) => this.builderCacheKey(session)));
        const activeCommunityKeys = new Set(sessions.map((session) => this.cacheKey(session)));
        for (const key of this.builderCache.keys()) {
            if (!activeBuilderKeys.has(key)) this.builderCache.delete(key);
        }
        for (const key of this.ownedCommunitiesCache.keys()) {
            if (!activeBuilderKeys.has(key)) this.ownedCommunitiesCache.delete(key);
        }
        for (const key of this.communityCache.keys()) {
            if (!activeCommunityKeys.has(key)) this.communityCache.delete(key);
        }
        for (const session of sessions) {
            this.resolveBuilder(session).catch((error) => {
                console.warn('Could not preload stream builder data:', error.message);
            });
            this.resolveCommunity(session).catch((error) => {
                console.warn('Could not preload stream community data:', error.message);
            });
        }
    }

    async resolveBuilder(session) {
        if (!this.db || !session?.uid) return null;
        return this.cached(this.builderCache, this.builderCacheKey(session), async () => {
            const profile = await this.db.doc(`profiles/${session.uid}`).get();
            return profile.exists ? {id: profile.id, ...profile.data()} : null;
        });
    }

    async resolveOwnedCommunities(session) {
        if (!this.db || !session?.uid) return [];
        return this.cached(this.ownedCommunitiesCache, this.builderCacheKey(session), async () => {
            const snapshot = await this.db.collection('communitys')
                .where('ownerId', '==', session.uid).get();
            return snapshot.docs.map((communityDoc) => ({
                id: communityDoc.id,
                ...communityDoc.data(),
            }));
        });
    }

    async resolveCommunity(session) {
        if (!this.db || !session?.uid || !session?.platform) return null;
        return this.cached(this.communityCache, this.cacheKey(session), async () => {
            for (const community of await this.resolveOwnedCommunities(session)) {
                const platformLink = community.socialLinks?.[session.platform];
                if (await platformLinkMatchesSession(platformLink, session, this.fetchImpl)) {
                    return community;
                }
            }
            return null;
        });
    }
}

async function streamCommandChatMessage(command, session, resolver) {
    if (command === 'creation') return creationChatMessage(session);
    if (command === 'builder') {
        return builderChatMessage(session, await resolver?.resolveBuilder(session));
    }
    if (command === 'community') {
        return communityChatMessage(await resolver?.resolveCommunity(session));
    }
    return null;
}

function expandPlatformSessions(sessions) {
    return sessions.flatMap((session) => {
        const streams = session?.streams && typeof session.streams === 'object' ?
            Object.entries(session.streams) : [];
        if (streams.length === 0) return [session];
        return streams
            .filter(([platform, stream]) => ['twitch', 'youtube'].includes(platform) && stream?.url)
            .map(([platform, stream]) => ({...session, ...stream, platform}));
    });
}

class TwitchChatAdapter {
    constructor(db, {contextResolver = null} = {}) {
        this.db = db;
        this.username = String(process.env.TWITCH_BOT_USERNAME || '').toLowerCase();
        this.clientId = process.env.TWITCH_BOT_CLIENT_ID || '';
        this.clientSecret = process.env.TWITCH_BOT_CLIENT_SECRET || '';
        this.refreshToken = process.env.TWITCH_BOT_REFRESH_TOKEN || '';
        this.accessToken = String(
            process.env.TWITCH_BOT_ACCESS_TOKEN || process.env.TWITCH_BOT_OAUTH_TOKEN || '',
        ).replace(/^oauth:/, '');
        this.tokenValidUntil = 0;
        this.credentialsLoaded = false;
        this.connecting = false;
        this.socket = null;
        this.connected = false;
        this.sessionsByChannel = new Map();
        this.joined = new Set();
        this.cooldowns = new Map();
        this.contextResolver = contextResolver || new StreamCommandContextResolver(db);
        this.prefetchOnSync = !contextResolver;
        this.reconnectTimer = null;
        this.debug = process.env.STREAM_CHAT_DEBUG === '1';
    }

    get configured() {
        return Boolean(this.db || (this.username && (
            this.accessToken || (this.clientId && this.clientSecret && (this.refreshToken || this.db))
        )));
    }

    send(line) {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(`${line}\r\n`);
    }

    async loadStoredCredentials() {
        if (this.credentialsLoaded || !this.db) return;
        this.credentialsLoaded = true;
        try {
            const snapshot = await this.db.doc('privateOAuthCredentials/streamChatBot').get();
            const credentials = snapshot.exists ? snapshot.data() : {};
            this.refreshToken = credentials.twitchRefreshToken || this.refreshToken;
            this.username = String(credentials.twitchBotUsername || this.username).toLowerCase();
            this.clientId = credentials.twitchClientId || this.clientId;
            this.clientSecret = credentials.twitchClientSecret || this.clientSecret;
        } catch (error) {
            console.warn('Could not load the persisted Twitch bot refresh token:', error.message);
        }
    }

    async saveRefreshToken(refreshToken) {
        if (!refreshToken || !this.db) return;
        try {
            await this.db.doc('privateOAuthCredentials/streamChatBot').set({
                twitchRefreshToken: refreshToken,
                twitchUpdatedAt: new Date(),
            }, {merge: true});
        } catch (error) {
            console.warn('Could not persist the rotated Twitch bot refresh token:', error.message);
        }
    }

    async refreshAccessToken() {
        await this.loadStoredCredentials();
        if (!this.clientId || !this.clientSecret || !this.refreshToken) {
            throw new Error('Twitch bot refresh credentials are incomplete.');
        }
        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken,
            }),
        });
        if (!response.ok) throw new Error(`Twitch bot token refresh failed (${response.status}).`);
        const data = await response.json();
        this.accessToken = data.access_token || '';
        this.tokenValidUntil = Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000;
        if (data.refresh_token && data.refresh_token !== this.refreshToken) {
            this.refreshToken = data.refresh_token;
            await this.saveRefreshToken(data.refresh_token);
        }
        return this.accessToken;
    }

    async getAccessToken() {
        await this.loadStoredCredentials();
        if (this.accessToken && this.tokenValidUntil > Date.now()) return this.accessToken;
        if (this.accessToken) {
            const response = await fetch('https://id.twitch.tv/oauth2/validate', {
                headers: {Authorization: `OAuth ${this.accessToken}`},
            });
            if (response.ok) {
                const data = await response.json();
                const scopes = new Set(data.scopes || []);
                if (String(data.login || '').toLowerCase() !== this.username ||
                    !scopes.has('chat:read') || !scopes.has('chat:edit')) {
                    throw new Error('Twitch bot token belongs to the wrong account or lacks chat:read/chat:edit.');
                }
                this.tokenValidUntil = Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000;
                return this.accessToken;
            }
            this.accessToken = '';
        }
        return this.refreshAccessToken();
    }

    async connect() {
        if (!this.configured || this.socket || this.connecting) return;
        this.connecting = true;
        let token;
        try {
            token = await this.getAccessToken();
        } catch (error) {
            console.error('Twitch chat bot authentication failed:', error.message);
            this.connecting = false;
            if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect().catch(() => {});
            }, 60_000);
            return;
        }
        this.connecting = false;
        this.socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
        this.socket.addEventListener('open', () => {
            this.connected = true;
            this.send(`PASS oauth:${token}`);
            this.send(`NICK ${this.username}`);
            this.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
            this.syncJoins();
            console.log('Twitch chat bot socket connected.');
        });
        this.socket.addEventListener('message', (event) => this.handleFrame(String(event.data || '')));
        this.socket.addEventListener('close', () => {
            this.socket = null;
            this.connected = false;
            this.joined.clear();
            if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect().catch(() => {});
            }, 15_000);
        });
        this.socket.addEventListener('error', () => {});
    }

    handleFrame(frame) {
        frame.split('\r\n').filter(Boolean).forEach((line) => {
            if (/Login authentication failed/i.test(line)) {
                console.error('Twitch chat bot login authentication failed.');
                this.accessToken = '';
                this.tokenValidUntil = 0;
                this.socket?.close();
                return;
            }
            if (line.includes(` 001 ${this.username} `)) {
                console.log(`Twitch chat bot authenticated as ${this.username}.`);
            }
            const joined = line.match(/ JOIN #(\w+)$/);
            if (joined && line.toLowerCase().includes(`:${this.username}!`)) {
                console.log(`Twitch chat bot joined #${joined[1].toLowerCase()}.`);
            }
            if (this.debug && / NOTICE /.test(line)) {
                console.warn(`Twitch IRC notice: ${line.replace(/^@[^ ]+ /, '')}`);
            }
            if (line.startsWith('PING ')) {
                this.send(line.replace(/^PING/, 'PONG'));
                return;
            }
            const match = line.match(/PRIVMSG #(\w+) :(.+)$/);
            const command = match ? getChatCommand(match[2]) : null;
            if (!match || !command) return;
            const channel = match[1].toLowerCase();
            this.respondToCommand(channel, command).catch((error) => {
                console.warn(`Twitch !${command} response failed in #${channel}:`, error.message);
            });
        });
    }

    async respondToCommand(channel, command) {
        console.log(`Twitch !${command} received in #${channel}.`);
        const cooldownKey = `${channel}:${command}`;
        if (Date.now() - (this.cooldowns.get(cooldownKey) || 0) < COMMAND_COOLDOWN_MS) return;
        this.cooldowns.set(cooldownKey, Date.now());
        const session = this.sessionsByChannel.get(channel);
        const message = await streamCommandChatMessage(command, session, this.contextResolver);
        if (!message) return;
        this.send(`PRIVMSG #${channel} :${message}`);
        console.log(`Twitch !${command} response sent in #${channel}.`);
    }

    syncSessions(sessions) {
        if (this.prefetchOnSync) this.contextResolver.prefetchSessions(sessions);
        this.sessionsByChannel = new Map(sessions
            .filter((session) => session.platform === 'twitch' && session.broadcasterLogin)
            .map((session) => [String(session.broadcasterLogin).toLowerCase(), session]));
        if (!this.socket) this.connect().catch(() => {});
        else this.syncJoins();
    }

    syncJoins() {
        if (!this.connected) return;
        for (const channel of this.sessionsByChannel.keys()) {
            if (!this.joined.has(channel)) {
                this.send(`JOIN #${channel}`);
                this.joined.add(channel);
                if (this.debug) console.log(`Twitch chat bot requested JOIN #${channel}.`);
            }
        }
        for (const channel of [...this.joined]) {
            if (!this.sessionsByChannel.has(channel)) {
                this.send(`PART #${channel}`);
                this.joined.delete(channel);
            }
        }
    }
}

class YouTubeChatAdapter {
    constructor(db, {contextResolver = null} = {}) {
        this.db = db;
        this.clientId = process.env.YOUTUBE_BOT_CLIENT_ID || '';
        this.clientSecret = process.env.YOUTUBE_BOT_CLIENT_SECRET || '';
        this.refreshToken = process.env.YOUTUBE_BOT_REFRESH_TOKEN || '';
        this.accessToken = null;
        this.accessTokenExpiresAt = 0;
        this.credentialsLoaded = false;
        this.pollers = new Map();
        this.cooldowns = new Map();
        this.contextResolver = contextResolver || new StreamCommandContextResolver(db);
        this.prefetchOnSync = !contextResolver;
    }

    get configured() {
        return Boolean(this.db || (this.clientId && this.clientSecret && this.refreshToken));
    }

    async loadStoredCredentials() {
        if (this.credentialsLoaded || !this.db) return;
        this.credentialsLoaded = true;
        try {
            const snapshot = await this.db.doc('privateOAuthCredentials/streamChatBot').get();
            const credentials = snapshot.exists ? snapshot.data() : {};
            this.refreshToken = credentials.youtubeRefreshToken || this.refreshToken;
            this.clientId = credentials.youtubeClientId || this.clientId;
            this.clientSecret = credentials.youtubeClientSecret || this.clientSecret;
        } catch (error) {
            console.warn('Could not load the persisted YouTube bot refresh token:', error.message);
        }
    }

    async saveRefreshToken(refreshToken) {
        if (!refreshToken || !this.db) return;
        try {
            await this.db.doc('privateOAuthCredentials/streamChatBot').set({
                youtubeRefreshToken: refreshToken,
                youtubeUpdatedAt: new Date(),
            }, {merge: true});
        } catch (error) {
            console.warn('Could not persist the rotated YouTube bot refresh token:', error.message);
        }
    }

    async getAccessToken() {
        await this.loadStoredCredentials();
        if (this.accessToken && this.accessTokenExpiresAt > Date.now() + 60_000) return this.accessToken;
        if (!this.clientId || !this.clientSecret || !this.refreshToken) {
            throw new Error('YouTube bot refresh credentials are incomplete.');
        }
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                refresh_token: this.refreshToken,
                grant_type: 'refresh_token',
            }),
        });
        if (!response.ok) throw new Error(`YouTube bot token refresh failed (${response.status}).`);
        const data = await response.json();
        this.accessToken = data.access_token;
        this.accessTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
        if (data.refresh_token && data.refresh_token !== this.refreshToken) {
            this.refreshToken = data.refresh_token;
            await this.saveRefreshToken(data.refresh_token);
        }
        return this.accessToken;
    }

    async resolveLiveChatId(videoId) {
        const accessToken = await this.getAccessToken();
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`,
            {headers: {Authorization: `Bearer ${accessToken}`}},
        );
        if (!response.ok) return null;
        return (await response.json()).items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
    }

    async postCommandResponse(liveChatId, session, command) {
        const cooldownKey = `${liveChatId}:${command}`;
        if (Date.now() - (this.cooldowns.get(cooldownKey) || 0) < COMMAND_COOLDOWN_MS) return;
        this.cooldowns.set(cooldownKey, Date.now());
        const message = await streamCommandChatMessage(command, session, this.contextResolver);
        if (!message) return;
        const accessToken = await this.getAccessToken();
        await fetch('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                snippet: {
                    liveChatId,
                    type: 'textMessageEvent',
                    textMessageDetails: {messageText: message},
                },
            }),
        });
    }

    async poll(state) {
        if (!this.pollers.has(state.videoId)) return;
        try {
            if (!state.liveChatId) state.liveChatId = await this.resolveLiveChatId(state.videoId);
            if (!state.liveChatId) throw new Error('No active YouTube live chat.');
            const accessToken = await this.getAccessToken();
            const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
            url.searchParams.set('part', 'snippet');
            url.searchParams.set('liveChatId', state.liveChatId);
            url.searchParams.set('maxResults', '200');
            if (state.pageToken) url.searchParams.set('pageToken', state.pageToken);
            const response = await fetch(url, {headers: {Authorization: `Bearer ${accessToken}`}});
            if (!response.ok) throw new Error(`YouTube live chat returned ${response.status}.`);
            const data = await response.json();
            state.pageToken = data.nextPageToken || state.pageToken;
            for (const item of data.items || []) {
                if (state.seen.has(item.id)) continue;
                state.seen.add(item.id);
                const command = getChatCommand(item.snippet?.displayMessage);
                if (state.initialized && command) {
                    await this.postCommandResponse(state.liveChatId, state.session, command);
                }
            }
            state.initialized = true;
            if (state.seen.size > 500) state.seen = new Set([...state.seen].slice(-250));
            state.timer = setTimeout(() => this.poll(state), Math.max(3_000, data.pollingIntervalMillis || 5_000));
        } catch (error) {
            state.timer = setTimeout(() => this.poll(state), 30_000);
        }
    }

    syncSessions(sessions) {
        if (!this.configured) return;
        if (this.prefetchOnSync) this.contextResolver.prefetchSessions(sessions);
        const active = new Map(sessions
            .filter((session) => session.platform === 'youtube' && session.platformStreamId)
            .map((session) => [session.platformStreamId, session]));
        for (const [videoId, session] of active) {
            const existing = this.pollers.get(videoId);
            if (existing) {
                existing.session = session;
            } else {
                const state = {videoId, session, liveChatId: null, pageToken: null, seen: new Set(), timer: null, initialized: false};
                this.pollers.set(videoId, state);
                this.poll(state);
            }
        }
        for (const [videoId, state] of this.pollers) {
            if (!active.has(videoId)) {
                clearTimeout(state.timer);
                this.pollers.delete(videoId);
            }
        }
    }
}

function startStreamChatBots(db) {
    const contextResolver = new StreamCommandContextResolver(db);
    const twitch = new TwitchChatAdapter(db, {contextResolver});
    const youtube = new YouTubeChatAdapter(db, {contextResolver});
    if (!twitch.configured) console.log('Twitch chat bot disabled: bot username/token are not configured.');
    if (!youtube.configured) console.log('YouTube chat bot disabled: OAuth/API credentials are not configured.');

    return db.collection('liveSessions').onSnapshot((snapshot) => {
        const sessions = snapshot.docs.map((doc) => ({uid: doc.id, ...doc.data()}))
            .filter((session) => session.status === 'active');
        const platformSessions = expandPlatformSessions(sessions);
        contextResolver.prefetchSessions(platformSessions);
        twitch.syncSessions(platformSessions);
        youtube.syncSessions(platformSessions);
    }, (error) => console.error('Stream chat bot session listener failed:', error));
}

module.exports = {
    StreamCommandContextResolver,
    TwitchChatAdapter,
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
    startStreamChatBots,
    twitchChannelLogin,
    youtubeChannelId,
};
