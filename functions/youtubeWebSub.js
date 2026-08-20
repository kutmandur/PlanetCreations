"use strict";

const crypto = require("crypto");
const {parseYoutubeRss} = require("./youtubeFeed");

const YOUTUBE_WEBSUB_HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";

const getYoutubeTopicUrl = (channelId) => (
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
);

const extractTopicChannelId = (topicUrl) => {
    try {
        const parsed = new URL(topicUrl);
        if (parsed.hostname !== "www.youtube.com" ||
            parsed.pathname !== "/feeds/videos.xml") return null;
        const channelId = parsed.searchParams.get("channel_id");
        return /^UC[\w-]{22}$/.test(channelId || "") ? channelId : null;
    } catch {
        return null;
    }
};

const parseYoutubeWebSubNotification = (xml) => {
    const channelId = (String(xml).match(
        /<yt:channelId>(UC[\w-]{22})<\/yt:channelId>/,
    ) || [])[1] || null;
    const feed = parseYoutubeRss(String(xml));
    return {channelId, ...feed};
};

const verifyWebSubSignature = (rawBody, signatureHeader, secret) => {
    if (!Buffer.isBuffer(rawBody) || !signatureHeader || !secret) return false;
    const [algorithm, suppliedHex] = String(signatureHeader).split("=", 2);
    if (!["sha1", "sha256", "sha384", "sha512"].includes(algorithm) ||
        !/^[\da-f]+$/i.test(suppliedHex || "")) return false;
    const expected = crypto.createHmac(algorithm, secret).update(rawBody).digest();
    const supplied = Buffer.from(suppliedHex, "hex");
    return expected.length === supplied.length &&
        crypto.timingSafeEqual(expected, supplied);
};

const buildWebSubSubscriptionBody = ({
    callbackUrl,
    channelId,
    mode = "subscribe",
    secret,
}) => new URLSearchParams({
    "hub.callback": callbackUrl,
    "hub.mode": mode,
    "hub.secret": secret,
    "hub.topic": getYoutubeTopicUrl(channelId),
    "hub.verify": "async",
});

module.exports = {
    YOUTUBE_WEBSUB_HUB_URL,
    buildWebSubSubscriptionBody,
    extractTopicChannelId,
    getYoutubeTopicUrl,
    parseYoutubeWebSubNotification,
    verifyWebSubSignature,
};
