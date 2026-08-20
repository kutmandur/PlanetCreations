require('dotenv').config({
    path: [
        require('path').join(__dirname, '.env.stream-bots'),
        require('path').join(__dirname, '.env'),
    ],
});

const {db, Timestamp} = require('./utils/firebase');

const twitch = {
    clientId: process.env.TWITCH_BOT_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_BOT_CLIENT_SECRET || '',
    username: process.env.TWITCH_BOT_USERNAME || '',
};
const youtube = {
    clientId: process.env.YOUTUBE_BOT_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_BOT_CLIENT_SECRET || '',
    channelName: process.env.YOUTUBE_BOT_CHANNEL_NAME || '',
};

const hasTwitch = Object.values(twitch).every(Boolean);
const hasYouTube = Object.values(youtube).every(Boolean);

if (!hasTwitch && !hasYouTube) {
    console.error('No complete Twitch or YouTube bot client credentials are configured.');
    process.exit(1);
}

const update = {
    streamChatBotCredentialsUpdatedAt: Timestamp.now(),
};
if (hasTwitch) {
    update.twitchClientId = twitch.clientId;
    update.twitchClientSecret = twitch.clientSecret;
    update.twitchBotUsername = twitch.username;
}
if (hasYouTube) {
    update.youtubeClientId = youtube.clientId;
    update.youtubeClientSecret = youtube.clientSecret;
    update.youtubeBotChannelName = youtube.channelName;
}

db.doc('privateOAuthCredentials/streamChatBot').set(update, {merge: true})
    .then(() => {
        console.log(`STREAM_BOT_CREDENTIALS_SYNCED=twitch:${hasTwitch},youtube:${hasYouTube}`);
        process.exit(0);
    })
    .catch((error) => {
        console.error(`STREAM_BOT_CREDENTIALS_ERROR=${error.message}`);
        process.exit(1);
    });
