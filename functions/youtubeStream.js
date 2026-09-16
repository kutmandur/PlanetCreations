"use strict";
const {extractYoutubeChannelId, fetchYoutubeActiveLiveVideo,
    fetchYoutubeLiveVideoMetadata, fetchYoutubeChannelLiveMetadata,
    fetchYoutubeVideoChannelId} = require("./youtubeFeed");
const {isYoutubeVideoLive} = require("./youtubeLiveStatus");

function parseYoutubeStreamUrl(input) {
    if (typeof input !== "string" || input.length > 300) return null;
    let url;
    try { url = new URL(input); } catch { return null; }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" ||
        !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return null;
    if (host !== "youtu.be") {
        const channel = url.pathname.match(
            /^\/(channel\/UC[\w-]{22}|@[^/]+|c\/[^/]+|user\/[^/]+)(?:\/(?:live|streams|videos))?\/?$/,
        );
        if (channel) {
            const channelUrl = new URL("/" + channel[1], "https://www.youtube.com").href;
            return {url: channelUrl, youtubeChannelUrl: channelUrl};
        }
    }
    const videoId = host === "youtu.be" ? url.pathname.slice(1).replace(/\/$/, "") :
        url.pathname === "/watch" ? url.searchParams.get("v") :
            url.pathname.match(/^\/live\/([\w-]{11})\/?$/)?.[1];
    return /^[\w-]{11}$/.test(videoId || "") ?
        {url: "https://www.youtube.com/watch?v=" + videoId, youtubeVideoId: videoId} : null;
}

function createYoutubeStreamService({apiKey, fetchImpl = fetch, now = Date.now, logger = console}) {
    const cache = new Map();
    let quotaBlockedUntil = 0;
    const cached = async (key, ttl, request) => {
        const current = cache.get(key);
        if (current && current.until > now()) return current.promise;
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        const entry = {until: now() + ttl};
        entry.promise = request().catch((error) => {
            if (cache.get(key) === entry) cache.delete(key);
            throw error;
        });
        cache.set(key, entry);
        return entry.promise;
    };
    const metadata = (videoId, channelId) => cached("video:" + videoId, 10000, async () => {
        if (quotaBlockedUntil <= now()) {
            const key = typeof apiKey === "function" ? apiKey() : apiKey;
            const response = await fetchImpl(
                "https://www.googleapis.com/youtube/v3/videos?" +
                new URLSearchParams({part: "snippet,liveStreamingDetails", id: videoId, key}),
                {signal: AbortSignal.timeout(10000)},
            );
            const body = await response.json();
            if (response.ok) {
                const video = body.items?.find((item) => item.id === videoId);
                if (!video) return {isLive: false, streamId: videoId};
                return {
                    isLive: isYoutubeVideoLive(video), streamId: videoId,
                    broadcasterId: video.snippet?.channelId || null, broadcasterLogin: null,
                    title: String(video.snippet?.title || "").slice(0, 300),
                    tags: Array.isArray(video.snippet?.tags) ? video.snippet.tags.slice(0, 20) : [],
                    categoryId: video.snippet?.categoryId || null, categoryName: "",
                };
            }
            const reason = body.error?.errors?.[0]?.reason || "httpError";
            logger.warn("YouTube API verification failed", {status: response.status, reason, videoId});
            if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
                quotaBlockedUntil = now() + 5 * 60 * 1000;
            } else if (response.status !== 429 && response.status < 500) {
                throw new Error("YouTube verification failed (" + reason + ").");
            }
        }
        let page;
        try {
            page = await fetchYoutubeLiveVideoMetadata(videoId, fetchImpl);
            if (page.isLive !== null) return page;
        } catch {
            // Cloud egress may receive a blocked player while /streams works.
        }
        const owner = channelId || page?.broadcasterId ||
            await fetchYoutubeVideoChannelId(videoId, fetchImpl);
        return fetchYoutubeChannelLiveMetadata(owner, videoId, fetchImpl);
    });
    const resolve = async (target) => {
        if (!target?.youtubeChannelUrl) return target;
        const channelId = await cached("channel:" + target.youtubeChannelUrl, 3600000,
            () => extractYoutubeChannelId(target.youtubeChannelUrl, fetchImpl));
        const live = await cached("discovery:" + channelId, 10000,
            () => fetchYoutubeActiveLiveVideo(channelId, fetchImpl));
        if (!live) return null;
        return {url: live.url, youtubeVideoId: live.videoId, youtubeChannelId: channelId};
    };
    const verify = async (target) => {
        const result = await metadata(target.youtubeVideoId, target.youtubeChannelId);
        if (target.youtubeChannelId && result.broadcasterId &&
            target.youtubeChannelId !== result.broadcasterId) {
            throw new Error("YouTube returned a video from a different channel.");
        }
        return result;
    };
    return {resolve, metadata: verify};
}
module.exports = {createYoutubeStreamService, parseYoutubeStreamUrl};
