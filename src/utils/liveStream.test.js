import {
    LIVE_STREAM_MAX_AGE_MS,
    isValidStreamUrl,
    isLiveStreamActive,
} from './liveStream';

const NOW = new Date('2026-07-21T12:00:00Z').getTime();
const ts = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000) });

describe('isValidStreamUrl', () => {
    it('accepts https URLs on the platform hosts', () => {
        expect(isValidStreamUrl('twitch', 'https://twitch.tv/somechannel')).toBe(true);
        expect(isValidStreamUrl('twitch', 'https://www.twitch.tv/somechannel')).toBe(true);
        expect(isValidStreamUrl('youtube', 'https://www.youtube.com/watch?v=abc123')).toBe(true);
        expect(isValidStreamUrl('youtube', 'https://youtu.be/abc123')).toBe(true);
    });

    it('rejects http, wrong hosts, lookalikes and garbage', () => {
        expect(isValidStreamUrl('twitch', 'http://twitch.tv/somechannel')).toBe(false);
        expect(isValidStreamUrl('twitch', 'https://youtube.com/watch?v=abc')).toBe(false);
        expect(isValidStreamUrl('twitch', 'https://twitch.tv.evil.com/somechannel')).toBe(false);
        expect(isValidStreamUrl('twitch', 'not a url')).toBe(false);
        expect(isValidStreamUrl('unknown', 'https://twitch.tv/somechannel')).toBe(false);
        expect(isValidStreamUrl('twitch', null)).toBe(false);
    });
});

describe('isLiveStreamActive', () => {
    it('is false for missing field or platform', () => {
        expect(isLiveStreamActive(null, NOW)).toBe(false);
        expect(isLiveStreamActive({}, NOW)).toBe(false);
        expect(isLiveStreamActive({ url: 'https://twitch.tv/x' }, NOW)).toBe(false);
    });

    it('honors expiresAt when present', () => {
        expect(isLiveStreamActive({ platform: 'twitch', expiresAt: ts(NOW + 1000) }, NOW)).toBe(true);
        expect(isLiveStreamActive({ platform: 'twitch', expiresAt: ts(NOW - 1000) }, NOW)).toBe(false);
    });

    it('falls back to startedAt + MAX_AGE without expiresAt', () => {
        expect(isLiveStreamActive({ platform: 'twitch', startedAt: ts(NOW - LIVE_STREAM_MAX_AGE_MS + 1000) }, NOW)).toBe(true);
        expect(isLiveStreamActive({ platform: 'twitch', startedAt: ts(NOW - LIVE_STREAM_MAX_AGE_MS - 1000) }, NOW)).toBe(false);
    });

    it('treats a pending serverTimestamp (startedAt === null) as active', () => {
        // Latenz-kompensierter eigener Snapshot direkt nach goLive
        expect(isLiveStreamActive({ platform: 'twitch', startedAt: null }, NOW)).toBe(true);
    });

    it('does not require url (search index entries carry none)', () => {
        expect(isLiveStreamActive({ platform: 'youtube', expiresAt: ts(NOW + 1000) }, NOW)).toBe(true);
    });
});
