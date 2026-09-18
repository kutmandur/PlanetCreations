const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const path = require('path');
const definition = loader.loadSync(path.join(__dirname, 'youtubeChatStream.proto'), {
    longs: String, enums: String, defaults: false,
});
const Client = grpc.loadPackageDefinition(definition).youtube.api.v3.V3DataLiveChatMessageService;

function openYoutubeChatStream({accessToken, liveChatId, pageToken}) {
    const client = new Client('youtube.googleapis.com:443', grpc.credentials.createSsl());
    const headers = new grpc.Metadata();
    headers.set('authorization', 'Bearer ' + accessToken);
    const stream = client.streamList({
        liveChatId, pageToken: pageToken || undefined, part: ['snippet', 'authorDetails'], maxResults: 200,
    }, headers, {deadline: Date.now() + 50 * 60 * 1000});
    stream.once('status', () => client.close());
    return stream;
}

function youtubeRetryDelay(error, attempts = 0, now = Date.now()) {
    if (/quota[\s_-]*exceeded|dailyLimitExceeded|check quota/i.test(error.message || '')) {
        // YouTube resets daily quotas at midnight America/Los_Angeles.
        const zoneFormat = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset',
        });
        const offsetAt = (time) => Number(zoneFormat.formatToParts(time)
            .find((p) => p.type === 'timeZoneName').value.replace('GMT', '')) || 0;
        const offset = offsetAt(now);
        const day = new Date(now + offset * 3600000);
        const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1);
        const next = midnight - offsetAt(midnight - offset * 3600000) * 3600000 + 60000;
        return Math.max(60000, next - now);
    }
    return Math.min(5 * 60 * 1000, 10000 * 2 ** Math.min(attempts, 5));
}
module.exports = {openYoutubeChatStream, youtubeRetryDelay};
