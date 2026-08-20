require('dotenv').config({
    path: [
        require('path').join(__dirname, '.env.stream-bots'),
        require('path').join(__dirname, '.env'),
    ],
});

const crypto = require('crypto');
const http = require('http');
const {db, Timestamp} = require('./utils/firebase');

const PORT = 31417;
const CALLBACK_URL = `http://localhost:${PORT}/twitch/callback`;
const clientId = process.env.TWITCH_BOT_CLIENT_ID || '';
const clientSecret = process.env.TWITCH_BOT_CLIENT_SECRET || '';
const expectedUsername = String(process.env.TWITCH_BOT_USERNAME || '').toLowerCase();

if (!clientId || !clientSecret || !expectedUsername) {
    console.error('Twitch bot client ID, client secret, and username must be configured.');
    process.exit(1);
}

const state = crypto.randomBytes(24).toString('hex');
const authorizationUrl = new URL('https://id.twitch.tv/oauth2/authorize');
authorizationUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    scope: 'chat:read chat:edit',
    state,
    force_verify: 'true',
}).toString();

const render = (response, status, heading, message) => {
    response.writeHead(status, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem"><h1>${heading}</h1><p>${message}</p></body></html>`);
};

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, CALLBACK_URL);
    if (requestUrl.pathname !== '/twitch/callback') {
        render(response, 404, 'Not found', 'This local endpoint only handles the Twitch OAuth callback.');
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
        const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
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
        const validationResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
            headers: {Authorization: `OAuth ${tokens.access_token}`},
        });
        if (!validationResponse.ok) throw new Error('The returned Twitch token could not be validated.');
        const validation = await validationResponse.json();
        const scopes = new Set(validation.scopes || []);
        if (String(validation.login || '').toLowerCase() !== expectedUsername) {
            throw new Error(`The authorized account is ${validation.login || 'unknown'}, not ${expectedUsername}.`);
        }
        if (!scopes.has('chat:read') || !scopes.has('chat:edit')) {
            throw new Error('The Twitch authorization is missing chat:read or chat:edit.');
        }
        if (!tokens.refresh_token) throw new Error('Twitch did not return a refresh token.');

        await db.doc('privateOAuthCredentials/streamChatBot').set({
            twitchClientId: clientId,
            twitchClientSecret: clientSecret,
            twitchRefreshToken: tokens.refresh_token,
            twitchBotUsername: validation.login,
            twitchUpdatedAt: Timestamp.now(),
        }, {merge: true});

        render(response, 200, 'PlanetCreationsBot connected', 'The Twitch bot authorization was stored securely. You can close this tab.');
        console.log(`TWITCH_OAUTH_COMPLETE=${validation.login}`);
        server.close();
        setTimeout(() => process.exit(0), 250);
    } catch (error) {
        console.error(`TWITCH_OAUTH_ERROR=${error.message}`);
        render(response, 500, 'Twitch setup failed', error.message);
        server.close();
        setTimeout(() => process.exit(1), 250);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`TWITCH_AUTH_URL=${authorizationUrl}`);
});

setTimeout(() => {
    console.error('TWITCH_OAUTH_ERROR=Timed out waiting for Twitch authorization.');
    server.close(() => process.exit(1));
}, 10 * 60 * 1000).unref();
