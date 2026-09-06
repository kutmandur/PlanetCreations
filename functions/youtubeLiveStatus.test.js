"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {isYoutubeVideoLive} = require("./youtubeLiveStatus");

test("treats a completed YouTube broadcast as offline even with a stale live snippet", () => {
    assert.equal(isYoutubeVideoLive({
        snippet: {liveBroadcastContent: "live"},
        liveStreamingDetails: {
            actualStartTime: "2026-09-05T18:00:00Z",
            actualEndTime: "2026-09-05T20:00:00Z",
        },
    }), false);
});

test("keeps an active broadcast live and rejects non-live videos", () => {
    assert.equal(isYoutubeVideoLive({
        snippet: {liveBroadcastContent: "live"},
        liveStreamingDetails: {actualStartTime: "2026-09-05T18:00:00Z"},
    }), true);
    assert.equal(isYoutubeVideoLive({
        snippet: {liveBroadcastContent: "none"},
        liveStreamingDetails: {actualEndTime: "2026-09-05T20:00:00Z"},
    }), false);
});

