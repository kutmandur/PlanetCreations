const {openYoutubeChatStream, youtubeRetryDelay} = require('./youtubeChatStream');
const {StreamChatSessionStore} = require('./streamChatSessionStore');
const CHAT_COMMANDS = Object.freeze({
    creation: /^!creation(?:\s|$)/i,
    builder: /^!builder(?:\s|$)/i,
    community: /^!community(?:\s|$)/i,
});
const COMMAND_COOLDOWN_MS = 60 * 1000;
const TWITCH_ROLE_TIMEOUT_MS = 20 * 1000;
const YOUTUBE_ROLE_TIMEOUT_MS = 45 * 1000;
const YOUTUBE_ROLE_PROBE_MESSAGE = 'PlanetCreationsBot connected: checking moderator permissions for chat commands.';

function chatSessionKey(session) {
    return JSON.stringify([session.uid || '', session.sessionId || '', session.platformStreamId || '']);
}

function chatSessionStoreKey(session) {
    return JSON.stringify([session.platform, session.broadcasterLogin?.toLowerCase() || session.platformStreamId,
        chatSessionKey(session)]);
}

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
    const target = require('../../functions/youtubeStream').parseYoutubeStreamUrl(link);
    if (!target?.youtubeChannelUrl) return null;
    return require('../../functions/youtubeFeed').extractYoutubeChannelId(target.youtubeChannelUrl, fetchImpl);
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

    retainSessions(sessions) {
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
    }

    prefetchSessions(sessions) {
        this.retainSessions(sessions);
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

async function streamGreetingChatMessage(session, resolver) {
    const [builder, community] = await Promise.all([
        resolver?.resolveBuilder(session), resolver?.resolveCommunity(session),
    ]);
    const commands = [];
    if (creationUrl(session)) commands.push('!creation (current creation)');
    if (builder && session.uid) commands.push('!builder (builder profile)');
    if (community?.slug) commands.push('!community (community)');
    return 'Hello! PlanetCreationsBot is ready.' +
        (commands.length ? ` Commands: ${commands.join(', ')}.` : '');
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
    constructor(db, {contextResolver = null, sessionStore = new StreamChatSessionStore()} = {}) {
        this.db = db;
        this.sessionStore = sessionStore;
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
        this.channelStates = new Map();
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
        if (!this.configured || !this.hasEligibleSessions || this.socket || this.connecting) return;
        this.connecting = true;
        let token;
        try {
            token = await this.getAccessToken();
        } catch (error) {
            console.error('Twitch chat bot authentication failed:', error.message);
            this.connecting = false;
            if (this.hasEligibleSessions && !this.reconnectTimer) this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect().catch(() => {});
            }, 60_000);
            return;
        }
        this.connecting = false;
        if (!this.hasEligibleSessions) return;
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
            for (const state of this.channelStates.values()) clearTimeout(state.timer);
            if (this.hasEligibleSessions && !this.reconnectTimer) this.reconnectTimer = setTimeout(() => {
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
            // USERSTATE describes this bot, unlike the tags on a viewer's PRIVMSG.
            const userState = line.match(/^@([^ ]+) :tmi\.twitch\.tv USERSTATE #(\w+)\s*$/);
            if (userState) {
                const channel = userState[2].toLowerCase();
                const state = this.channelStates.get(channel);
                if (!state || state.status !== 'pending' || !this.joined.has(channel)) return;
                const tags = new Map(userState[1].split(';').map((tag) => tag.split('=')));
                const badges = String(tags.get('badges') || '').split(',');
                if (tags.get('mod') === '1' || badges.includes('moderator/1') ||
                    badges.includes('broadcaster/1') || channel === this.username) {
                    clearTimeout(state.timer);
                    try {
                        this.sessionStore.save(state.storeKey, {status: 'allowed'});
                        state.status = 'allowed';
                    } catch (error) {
                        this.ignoreSession(channel, state, 'session decision could not be saved');
                        return;
                    }
                    console.log(`Twitch moderator role confirmed in #${channel}.`);
                    this.greetSession(channel, state).catch((error) => {
                        console.warn(`Twitch greeting failed in #${channel}:`, error.message);
                    });
                } else if (tags.get('mod') === '0') {
                    this.ignoreSession(channel, state, 'bot is not a moderator');
                }
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
        const state = this.channelStates.get(channel);
        const session = this.sessionsByChannel.get(channel);
        if (!session || state?.status !== 'allowed' || !this.connected || !this.joined.has(channel)) return;
        console.log(`Twitch !${command} received in #${channel}.`);
        const cooldownKey = `${channel}:${command}`;
        if (Date.now() - (this.cooldowns.get(cooldownKey) || 0) < COMMAND_COOLDOWN_MS) return;
        this.cooldowns.set(cooldownKey, Date.now());
        const message = await streamCommandChatMessage(command, session, this.contextResolver);
        if (!message || this.channelStates.get(channel) !== state ||
            this.sessionsByChannel.get(channel) !== session || state.status !== 'allowed' ||
            !this.connected || !this.joined.has(channel)) return;
        this.send(`PRIVMSG #${channel} :${message}`);
        console.log(`Twitch !${command} response sent in #${channel}.`);
    }

    async greetSession(channel, state) {
        if (state.greetingAttempted) return;
        this.sessionStore.save(state.storeKey, {greetingAttempted: true});
        state.greetingAttempted = true;
        const session = this.sessionsByChannel.get(channel);
        const message = await streamGreetingChatMessage(session, this.contextResolver);
        if (this.channelStates.get(channel) !== state || state.status !== 'allowed' ||
            !this.connected || !this.joined.has(channel)) return;
        this.send(`PRIVMSG #${channel} :${message}`);
    }

    syncSessions(sessions) {
        if (this.prefetchOnSync) this.contextResolver.retainSessions(sessions);
        this.sessionsByChannel = new Map(sessions
            .filter((session) => session.platform === 'twitch' && session.broadcasterLogin)
            .map((session) => [String(session.broadcasterLogin).toLowerCase(), session]));
        for (const [channel, state] of this.channelStates) {
            const session = this.sessionsByChannel.get(channel);
            if (!session || state.key !== chatSessionKey(session)) {
                clearTimeout(state.timer);
                if (this.joined.delete(channel)) this.send(`PART #${channel}`);
                this.channelStates.delete(channel);
                for (const command of Object.keys(CHAT_COMMANDS)) this.cooldowns.delete(`${channel}:${command}`);
            }
        }
        for (const [channel, session] of this.sessionsByChannel) {
            if (!this.channelStates.has(channel)) {
                const storeKey = chatSessionStoreKey(session);
                const saved = this.sessionStore.get(storeKey);
                this.channelStates.set(channel, {key: chatSessionKey(session), storeKey,
                    status: saved.status || 'pending', greetingAttempted: saved.greetingAttempted === true, timer: null});
            }
        }
        this.syncJoins();
        if (!this.socket) this.connect().catch(() => {});
    }

    get hasEligibleSessions() {
        return [...this.channelStates.values()].some((state) => state.status !== 'ignored');
    }

    ignoreSession(channel, state, reason) {
        if (this.channelStates.get(channel) !== state || state.status !== 'pending') return;
        clearTimeout(state.timer);
        state.status = 'ignored';
        try { this.sessionStore.save(state.storeKey, {status: 'ignored'}); }
        catch (error) { console.warn('Could not save ignored Twitch session:', error.message); }
        console.log(`Twitch chat ignored in #${channel} for this session: ${reason}.`);
        this.syncJoins();
    }

    syncJoins() {
        if (!this.hasEligibleSessions) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (!this.connected) return;
        for (const [channel, state] of this.channelStates) {
            if (state.status === 'ignored') continue;
            if (!this.joined.has(channel)) {
                this.send(`JOIN #${channel}`);
                this.joined.add(channel);
                if (state.status === 'pending') {
                    clearTimeout(state.timer);
                    state.timer = setTimeout(() => {
                        this.ignoreSession(channel, state, 'moderator role could not be verified');
                    }, TWITCH_ROLE_TIMEOUT_MS);
                    state.timer.unref?.();
                } else if (state.status === 'allowed') {
                    this.greetSession(channel, state).catch((error) => {
                        console.warn(`Twitch greeting failed in #${channel}:`, error.message);
                    });
                }
                if (this.debug) console.log(`Twitch chat bot requested JOIN #${channel}.`);
            }
        }
        for (const channel of [...this.joined]) {
            if (!this.channelStates.has(channel) || this.channelStates.get(channel).status === 'ignored') {
                this.send(`PART #${channel}`);
                this.joined.delete(channel);
            }
        }
        if (!this.hasEligibleSessions) this.socket?.close();
    }
}

class YouTubeChatAdapter {
    constructor(db, {contextResolver = null, openStream = openYoutubeChatStream, sessionStore = new StreamChatSessionStore()} = {}) {
        this.db = db;
        this.sessionStore = sessionStore;
        this.openStream = openStream;
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

    async resolveLiveChatId(videoId, signal) {
        const accessToken = await this.getAccessToken();
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`,
            {headers: {Authorization: `Bearer ${accessToken}`}, signal},
        );
        if (!response.ok) {
            throw await youtubeApiError(response, 'resolve live chat');
        }
        return (await response.json()).items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
    }

    isCurrent(state) {
        return this.pollers.get(state.videoId) === state && !state.ended;
    }

    stopState(state) {
        state.ended = true;
        clearTimeout(state.timer);
        clearTimeout(state.roleTimer);
        state.abortController?.abort();
        state.stream?.cancel();
    }

    ignoreSession(state, reason) {
        if (!this.isCurrent(state)) return;
        state.roleStatus = 'ignored';
        try { this.sessionStore.save(state.storeKey, {roleStatus: 'ignored'}); }
        catch (error) { console.warn('Could not save ignored YouTube session:', error.message); }
        this.stopState(state);
        console.warn(`YouTube chat ignored for video ${state.videoId} for this session: ${reason}.`);
    }

    async greetSession(state) {
        if (state.greetingAttempted) return;
        state.greetingAttempted = true;
        try {
            this.sessionStore.save(state.storeKey, {greetingAttempted: true});
            const message = await streamGreetingChatMessage(state.session, this.contextResolver);
            if (!this.isCurrent(state)) return;
            const accessToken = await this.getAccessToken();
            if (!this.isCurrent(state) || state.roleStatus !== 'allowed') return;
            await this.postChatMessage(state.liveChatId, message, accessToken, state.abortController.signal);
            console.log(`YouTube greeting sent for video ${state.videoId}.`);
        } catch (error) {
            // Do not resend an ambiguous write or reconnect the working chat just for a greeting.
            if (this.isCurrent(state)) console.warn(`YouTube greeting failed for video ${state.videoId}:`, error.message);
        }
    }

    async postCommandResponse(liveChatId, session, command, state) {
        if (!state || !this.isCurrent(state) || state.roleStatus !== 'allowed') return;
        const cooldownKey = `${liveChatId}:${command}`;
        if (Date.now() - (this.cooldowns.get(cooldownKey) || 0) < COMMAND_COOLDOWN_MS) return;
        const message = await streamCommandChatMessage(command, session, this.contextResolver);
        if (!message || !this.isCurrent(state)) return;
        const accessToken = await this.getAccessToken();
        if (!this.isCurrent(state) || state.session !== session) return;
        await this.postChatMessage(liveChatId, message, accessToken, state.abortController?.signal);
        this.cooldowns.set(cooldownKey, Date.now());
        console.log(`YouTube !${command} response sent for video ${session.platformStreamId}.`);
    }

    async postChatMessage(liveChatId, message, accessToken, signal) {
        const response = await fetch('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet', {
            method: 'POST',
            signal,
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
        if (!response.ok) throw await youtubeApiError(response, 'post chat response');
        return response.json();
    }

    async handlePage(state, data) {
        if (!this.isCurrent(state)) return;
        if (data.offlineAt) {
            this.stopState(state);
            console.log('YouTube chat ended for video ' + state.videoId + '.');
            return;
        }
        if (state.roleStatus === 'pending') {
            // Only the server-issued ID of our own probe proves this bot's role.
            const probe = (data.items || []).find((item) => state.probeId && item.id === state.probeId);
            if (probe) {
                if (probe.authorDetails?.isChatModerator === true || probe.authorDetails?.isChatOwner === true) {
                    try {
                        this.sessionStore.save(state.storeKey, {roleStatus: 'allowed'});
                    } catch (error) {
                        this.ignoreSession(state, 'session decision could not be saved');
                        return;
                    }
                    state.roleStatus = 'allowed';
                    clearTimeout(state.roleTimer);
                    console.log(`YouTube moderator role confirmed for video ${state.videoId}.`);
                } else {
                    this.ignoreSession(state, 'start message did not confirm moderator permissions');
                    return;
                }
            }
        }
        if (state.roleStatus === 'allowed') await this.greetSession(state);
        for (const item of data.items || []) {
            if (!this.isCurrent(state)) return;
            if (state.seen.has(item.id)) continue;
            const command = getChatCommand(item.snippet?.displayMessage);
            const publishedAt = Date.parse(item.snippet?.publishedAt || '');
            const isNewForWorker = state.initialized || (
                Number.isFinite(publishedAt) && publishedAt >= state.startedAt
            );
            if (state.roleStatus === 'allowed' && isNewForWorker && command) {
                console.log('YouTube !' + command + ' received for video ' + state.videoId + '.');
                await this.postCommandResponse(state.liveChatId, state.session, command, state);
            }
            state.seen.add(item.id);
        }
        state.pageToken = data.nextPageToken || state.pageToken;
        state.initialized = true;
        state.lastError = null;
        state.attempts = 0;
        if (state.seen.size > 500) state.seen = new Set([...state.seen].slice(-250));
    }

    async connectStream(state) {
        if (!this.isCurrent(state)) return;
        let finished = false;
        const retry = (error) => {
            if (finished || this.pollers.get(state.videoId) !== state || state.ended) return;
            finished = true;
            state.stream?.cancel();
            const delay = youtubeRetryDelay(error, state.attempts || 0);
            state.attempts = (state.attempts || 0) + 1;
            if (error.code === 16 || /unauthenticated/i.test(error.message)) {
                this.accessTokenExpiresAt = 0;
            }
            if (/liveChatEnded|liveChatDisabled/i.test(error.message)) this.stopState(state);
            if (state.lastError !== error.message) {
                console.warn('YouTube chat for ' + state.videoId + ': ' + error.message +
                    (state.ended ? ' Stopped.' : ' Retry at ' + new Date(Date.now() + delay).toISOString()));
                state.lastError = error.message;
            }
            if (!state.ended) state.timer = setTimeout(() => this.connectStream(state), delay);
        };
        try {
            if (!state.liveChatId) state.liveChatId = await this.resolveLiveChatId(state.videoId, state.abortController.signal);
            if (!state.liveChatId) throw new Error('No active YouTube live chat.');
            const accessToken = await this.getAccessToken();
            if (!this.isCurrent(state)) return;
            if (!state.probeAttempted) {
                // Never retry this write: an ambiguous network failure may already have posted it.
                state.probeAttempted = true;
                try {
                    this.sessionStore.save(state.storeKey, {probeAttempted: true,
                        liveChatId: state.liveChatId, checkedAt: state.checkedAt});
                    const probe = await this.postChatMessage(state.liveChatId, YOUTUBE_ROLE_PROBE_MESSAGE,
                        accessToken, state.abortController.signal);
                    if (!this.isCurrent(state)) return;
                    if (!probe?.id) throw new Error('YouTube did not return a start message ID');
                    state.probeId = probe.id;
                    this.sessionStore.save(state.storeKey, {probeId: probe.id});
                } catch (error) {
                    this.ignoreSession(state, `start message could not be confirmed (${error.message})`);
                    return;
                }
            }
            if (!this.isCurrent(state)) return;
            const stream = this.openStream({accessToken, liveChatId: state.liveChatId, pageToken: state.pageToken});
            state.stream = stream;
            let queue = Promise.resolve();
            stream.on('metadata', () => console.log('YouTube live chat connected for ' + state.videoId + '.'));
            stream.on('data', (data) => {
                stream.pause();
                queue = queue.then(() => this.handlePage(state, data))
                    .then(() => { if (!finished && !state.ended) stream.resume(); })
                    .catch(retry);
            });
            stream.on('error', retry);
            stream.on('end', () => {
                queue.then(() => retry(new Error('YouTube chat connection closed.')));
            });
        } catch (error) {
            retry(error);
        }
    }

    syncSessions(sessions) {
        if (!this.configured) return;
        if (this.prefetchOnSync) this.contextResolver.retainSessions(sessions);
        const active = new Map(sessions
            .filter((session) => session.platform === 'youtube' && session.platformStreamId)
            .map((session) => [session.platformStreamId, session]));
        for (const [videoId, session] of active) {
            const existing = this.pollers.get(videoId);
            if (existing && existing.key === chatSessionKey(session)) {
                existing.session = session;
            } else {
                if (existing) this.stopState(existing);
                const storeKey = chatSessionStoreKey(session);
                const saved = this.sessionStore.get(storeKey);
                const state = {
                    videoId,
                    session,
                    key: chatSessionKey(session),
                    storeKey,
                    roleStatus: saved.roleStatus || 'pending',
                    probeAttempted: saved.probeAttempted === true,
                    probeId: saved.probeId || null,
                    greetingAttempted: saved.greetingAttempted === true,
                    checkedAt: saved.checkedAt || Date.now(),
                    roleTimer: null,
                    abortController: new AbortController(),
                    liveChatId: saved.liveChatId || null,
                    pageToken: null,
                    seen: new Set(),
                    timer: null,
                    initialized: false,
                    startedAt: Date.now(),
                    lastError: null,
                };
                this.pollers.set(videoId, state);
                if (state.roleStatus === 'ignored' || (state.probeAttempted && !state.probeId)) {
                    this.ignoreSession(state, 'restoring a skipped or unconfirmed session');
                    continue;
                }
                if (state.roleStatus === 'pending') {
                    const remaining = state.checkedAt + YOUTUBE_ROLE_TIMEOUT_MS - Date.now();
                    if (remaining <= 0) {
                        this.ignoreSession(state, 'moderator check expired before restart');
                        continue;
                    }
                    state.roleTimer = setTimeout(() => {
                        this.ignoreSession(state, 'moderator check timed out without confirmation');
                    }, remaining);
                    state.roleTimer.unref?.();
                }
                this.connectStream(state);
            }
        }
        for (const [videoId, state] of this.pollers) {
            if (!active.has(videoId)) {
                this.pollers.delete(videoId);
                this.stopState(state);
            }
        }
    }
}

async function youtubeApiError(response, operation) {
    let detail = '';
    try {
        const body = await response.json();
        const apiError = body?.error;
        const reason = apiError?.errors?.[0]?.reason;
        detail = reason || apiError?.message || '';
    } catch (error) {
        // An HTTP status is still useful when YouTube returns a non-JSON body.
    }
    return new Error(
        `YouTube ${operation} failed (${response.status})${detail ? `: ${detail}` : ''}.`,
    );
}

function startStreamChatBots(db) {
    const contextResolver = new StreamCommandContextResolver(db);
    let sessionStore;
    try {
        sessionStore = new StreamChatSessionStore(require('node:path').join(__dirname, '..', '.stream-chat-sessions.json'));
    } catch (error) {
        console.error('Stream chat bots stopped: session cache could not be loaded:', error.message);
        return () => {};
    }
    const twitch = new TwitchChatAdapter(db, {contextResolver, sessionStore});
    const youtube = new YouTubeChatAdapter(db, {contextResolver, sessionStore});
    if (!twitch.configured) console.log('Twitch chat bot disabled: bot username/token are not configured.');
    if (!youtube.configured) console.log('YouTube chat bot disabled: OAuth/API credentials are not configured.');

    return db.collection('liveSessions').onSnapshot((snapshot) => {
        const sessions = snapshot.docs.map((doc) => ({uid: doc.id, ...doc.data()}))
            .filter((session) => session.status === 'active');
        const platformSessions = expandPlatformSessions(sessions);
        try {
            sessionStore.retain(platformSessions.map(chatSessionStoreKey));
        } catch (error) {
            console.error('Stream chat session cache could not be updated:', error.message);
        }
        // Load command context lazily, after any required moderator check passes.
        contextResolver.retainSessions(platformSessions);
        twitch.syncSessions(platformSessions);
        youtube.syncSessions(platformSessions);
    }, (error) => console.error('Stream chat bot session listener failed:', error));
}

module.exports = {
    StreamCommandContextResolver,
    TwitchChatAdapter,
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
    streamGreetingChatMessage,
    startStreamChatBots,
    twitchChannelLogin,
    youtubeChannelId,
    youtubeApiError,
};
