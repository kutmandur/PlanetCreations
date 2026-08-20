require('dotenv').config({
    path: [
        require('path').join(__dirname, '.env.stream-bots'),
        require('path').join(__dirname, '.env'),
    ],
});

const crypto = require('crypto');
const http = require('http');
const {db, Timestamp} = require('./utils/firebase');

const PORT = 31418;
const CALLBACK_URL = `http://localhost:${PORT}/youtube/callback`;
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const clientId = process.env.YOUTUBE_BOT_CLIENT_ID || '';
const clientSecret = process.env.YOUTUBE_BOT_CLIENT_SECRET || '';
const expectedChannelName = String(
    process.env.YOUTUBE_BOT_CHANNEL_NAME || 'PlanetCreationsBot',
).trim().toLowerCase();

if (!clientId || !clientSecret || !expectedChannelName) {
    console.error('YouTube bot client ID, client secret, and channel name must be configured.');
    process.exit(1);
}

const state = crypto.randomBytes(24).toString('hex');
const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorizationUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    scope: YOUTUBE_SCOPE,
    state,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
}).toString();

const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const render = (response, status, heading, message) => {
    response.writeHead(status, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p></body></html>`);
};

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, CALLBACK_URL);
    if (requestUrl.pathname !== '/youtube/callback') {
        render(response, 404, 'Not found', 'This local endpoint only handles the YouTube OAuth callback.');
        return;
    }
    if (requestUrl.searchParams.get('state') !== state) {
        render(response, 403, 'Authorization rejected', 'The OAuth state did not match. Start the setup again.');
        return;
    }
    const code = requestUrl.searchParams.get('code');
    if (!code) {
        render(response, 400, 'Authorization cancelled', requestUrl.searchParams.get('error_description') || 'No authorization code was returned.');
        return;
    }

    try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: CALLBACK_URL,
            }),
        });
        if (!tokenResponse.ok) throw new Error(`Token exchange failed (${tokenResponse.status}).`);
        const tokens = await tokenResponse.json();
        if (!tokens.access_token || !tokens.refresh_token) {
            throw new Error('Google did not return the required access and refresh tokens.');
        }

        const channelResponse = await fetch(
            'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
            {headers: {Authorization: `Bearer ${tokens.access_token}`}},
        );
        if (!channelResponse.ok) {
            throw new Error(`The authorized YouTube channel could not be validated (${channelResponse.status}).`);
        }
        const channels = (await channelResponse.json()).items || [];
        const channel = channels[0];
        if (!channel?.id || !channel?.snippet?.title) {
            throw new Error('The authorization is not linked to a usable YouTube channel.');
        }
        if (String(channel.snippet.title).trim().toLowerCase() !== expectedChannelName) {
            throw new Error(`The authorized channel is ${channel.snippet.title}, not ${process.env.YOUTUBE_BOT_CHANNEL_NAME || 'PlanetCreationsBot'}.`);
        }

        await db.doc('privateOAuthCredentials/streamChatBot').set({
            youtubeClientId: clientId,
            youtubeClientSecret: clientSecret,
            youtubeRefreshToken: tokens.refresh_token,
            youtubeChannelId: channel.id,
            youtubeChannelTitle: channel.snippet.title,
            youtubeUpdatedAt: Timestamp.now(),
        }, {merge: true});

        render(response, 200, 'PlanetCreationsBot connected', 'The YouTube bot authorization was stored securely. You can close this tab.');
        console.log(`YOUTUBE_OAUTH_COMPLETE=${channel.snippet.title}`);
        server.close();
        setTimeout(() => process.exit(0), 250);
    } catch (error) {
        console.error(`YOUTUBE_OAUTH_ERROR=${error.message}`);
        render(response, 500, 'YouTube setup failed', error.message);
        server.close();
        setTimeout(() => process.exit(1), 250);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`YOUTUBE_AUTH_URL=${authorizationUrl}`);
});

setTimeout(() => {
    console.error('YOUTUBE_OAUTH_ERROR=Timed out waiting for YouTube authorization.');
    server.close(() => process.exit(1));
}, 10 * 60 * 1000).unref();
