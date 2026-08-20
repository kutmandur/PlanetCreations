"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    MAX_SHARD_BYTES,
    buildShardWithVideo,
    decodeYoutubeVideo,
    encodeYoutubeVideo,
    estimateShardBytes,
    getShardId,
    normalizeYoutubeVideos,
    parseRelativePublishedMs,
} = require("./youtubeVideoIndex");

test("encodes compact video entries without storing YouTube URLs", () => {
    const encoded = encodeYoutubeVideo({
        publishedMs: 1_787_184_000_000,
        title: "A title | containing a separator",
    });
    assert.equal(encoded, "1787184000000|A title | containing a separator");
    assert.deepEqual(decodeYoutubeVideo("abcdefghijk", encoded), {
        id: "abcdefghijk",
        publishedMs: 1_787_184_000_000,
        title: "A title | containing a separator",
    });
    assert.equal(encoded.includes("youtube.com"), false);
});

test("normalizes relative YouTube dates while preserving newest-first order", () => {
    const nowMs = Date.UTC(2026, 7, 20, 12);
    assert.equal(
        parseRelativePublishedMs("2 days ago", nowMs),
        nowMs - (2 * 24 * 60 * 60 * 1000),
    );
    const videos = normalizeYoutubeVideos([
        {id: "abcdefghijk", title: "Newest", publishedText: "1 day ago"},
        {id: "lmnopqrstuv", title: "Older", publishedText: "2 days ago"},
    ], nowMs);
    assert.equal(videos.length, 2);
    assert.ok(videos[0].publishedMs > videos[1].publishedMs);
});

test("builds linked compact shards and tracks a conservative byte estimate", () => {
    const shard = buildShardWithVideo({
        b: 0,
        c: {},
        n: 2,
        p: getShardId(1),
        v: 1,
    }, "community-1", {
        id: "abcdefghijk",
        publishedMs: 1_787_184_000_000,
        title: "First indexed video",
    });

    assert.equal(shard.p, "000001");
    assert.match(shard.c["community-1"].abcdefghijk, /^1787184000000\|/);
    assert.equal(shard.b, estimateShardBytes(shard));
    assert.ok(shard.b < MAX_SHARD_BYTES);
});
