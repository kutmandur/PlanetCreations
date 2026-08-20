require('dotenv').config({
    path: [
        require('path').join(__dirname, '.env.stream-bots'),
        require('path').join(__dirname, '.env'),
    ],
});

process.env.STREAM_CHAT_DEBUG = '1';

const {db} = require('./utils/firebase');
const {TwitchChatAdapter} = require('./tasks/streamChatBots');

const channel = String(process.argv[2] || '').trim().replace(/^#/, '').toLowerCase();
const creationId = String(process.argv[3] || '').trim();
const creationTitle = String(process.argv.slice(4).join(' ') || '').trim();

if (!/^[a-z0-9_]{1,25}$/.test(channel) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(creationId) || !creationTitle) {
    console.error('Usage: npm run test:twitch-chat -- <channel> <creationId> <creationTitle>');
    process.exit(1);
}

let adapter = null;

async function start() {
    const creationSnapshot = await db.doc(`creations/${creationId}`).get();
    if (!creationSnapshot.exists || !creationSnapshot.data().userId) {
        throw new Error('The test creation does not exist or has no owner.');
    }
    adapter = new TwitchChatAdapter(db);
    adapter.syncSessions([{
        uid: creationSnapshot.data().userId,
        sessionId: `manual-test-${creationId}`,
        platform: 'twitch',
        broadcasterLogin: channel,
        creationId,
        creationTitle,
    }]);
    console.log(`TWITCH_CHAT_TEST_START=#${channel},creation:${creationId}`);
}

const stop = () => {
    adapter?.syncSessions([]);
    adapter?.socket?.close();
    console.log('TWITCH_CHAT_TEST_STOPPED');
    process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
start().catch((error) => {
    console.error('TWITCH_CHAT_TEST_FAILED:', error.message);
    process.exit(1);
});
setInterval(() => {}, 60_000);
