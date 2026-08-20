"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    creationLiveStreamFromSession,
    getPrimaryPlatform,
    getSessionStreams,
    withPrimaryStreamFields,
} = require("./liveStreamPlatforms");

test("normalizes a legacy single-platform session", () => {
    const streams = getSessionStreams({
        platform: "twitch",
        url: "https://twitch.tv/builder",
        broadcasterId: "123",
    });
    assert.deepEqual(streams, {
        twitch: {
            platform: "twitch",
            url: "https://twitch.tv/builder",
            broadcasterId: "123",
        },
    });
});

test("keeps Twitch and YouTube under one primary session", () => {
    const session = withPrimaryStreamFields({
        sessionId: "session-1",
        primaryPlatform: "youtube",
    }, {
        twitch: {url: "https://twitch.tv/builder", streamTitle: "Twitch title"},
        youtube: {url: "https://youtu.be/abcdefghijk", streamTitle: "YouTube title"},
    });
    assert.equal(getPrimaryPlatform(session), "youtube");
    assert.equal(session.platform, "youtube");
    assert.equal(session.streamTitle, "YouTube title");
    assert.deepEqual(Object.keys(session.streams).sort(), ["twitch", "youtube"]);
});

test("promotes the remaining platform and creates two public live entries", () => {
    const dualSession = withPrimaryStreamFields({
        sessionId: "session-1",
        primaryPlatform: "twitch",
    }, {
        twitch: {url: "https://twitch.tv/builder", expiresAt: {seconds: 10}},
        youtube: {url: "https://youtu.be/abcdefghijk", expiresAt: {seconds: 10}},
    });
    const liveStream = creationLiveStreamFromSession(dualSession);
    assert.deepEqual(Object.keys(liveStream.streams).sort(), ["twitch", "youtube"]);

    const youtubeOnly = withPrimaryStreamFields(dualSession, {
        youtube: dualSession.streams.youtube,
    });
    assert.equal(youtubeOnly.platform, "youtube");
    assert.equal(youtubeOnly.url, "https://youtu.be/abcdefghijk");
});
