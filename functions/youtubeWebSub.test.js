"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
    buildWebSubSubscriptionBody,
    extractTopicChannelId,
    getYoutubeTopicUrl,
    parseYoutubeWebSubNotification,
    verifyWebSubSignature,
} = require("./youtubeWebSub");

const channelId = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

test("builds a signed YouTube WebSub subscription request", () => {
    const body = buildWebSubSubscriptionBody({
        callbackUrl: "https://example.com/youtube?token=opaque",
        channelId,
        secret: "subscription-secret",
    });
    assert.equal(body.get("hub.mode"), "subscribe");
    assert.equal(body.get("hub.topic"), getYoutubeTopicUrl(channelId));
    assert.equal(body.get("hub.secret"), "subscription-secret");
    assert.equal(extractTopicChannelId(body.get("hub.topic")), channelId);
    assert.equal(extractTopicChannelId("https://example.com/feed"), null);
});

test("accepts only a valid HMAC signature for the exact request body", () => {
    const body = Buffer.from("<feed>trusted</feed>");
    const secret = "subscription-secret";
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyWebSubSignature(body, `sha256=${signature}`, secret), true);
    assert.equal(verifyWebSubSignature(body, `sha256=${signature}`, "wrong"), false);
    assert.equal(verifyWebSubSignature(body, null, secret), false);
});

test("parses channel and video data from a YouTube WebSub Atom payload", () => {
    const notification = parseYoutubeWebSubNotification(`
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
            <entry>
                <yt:videoId>abcdefghijk</yt:videoId>
                <yt:channelId>${channelId}</yt:channelId>
                <title>New &amp; improved</title>
                <published>2026-08-20T12:00:00+00:00</published>
            </entry>
        </feed>`);
    assert.equal(notification.channelId, channelId);
    assert.deepEqual(notification.videos, [{
        id: "abcdefghijk",
        published: "2026-08-20T12:00:00+00:00",
        title: "New & improved",
    }]);
});
