"use strict";

const YOUTUBE_REQUEST_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
};

// Without SOCS, requests originating in regions covered by Google's consent
// flow can be redirected to consent.youtube.com. That page has no player data,
// which makes an active broadcast look offline. SOCS=CAI records the server-side
// choice needed to receive the public channel page; no user cookie is involved.
const YOUTUBE_PAGE_HEADERS = {
    ...YOUTUBE_REQUEST_HEADERS,
    Cookie: "SOCS=CAI",
};

const decodeXmlEntities = (value = "") => value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (entity, code) => {
        const namedEntities = {
            amp: "&",
            apos: "'",
            gt: ">",
            lt: "<",
            quot: '"',
        };
        if (code[0] !== "#") return namedEntities[code.toLowerCase()] || entity;

        const numericCode = code[1].toLowerCase() === "x" ?
            Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(numericCode) ? String.fromCodePoint(numericCode) : entity;
    },
);

const parseYoutubeRss = (xml) => {
    const channelTitle = decodeXmlEntities(
        (xml.match(/<title>([^<]*)<\/title>/) || [])[1] || "",
    );
    const videos = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let entry;

    while ((entry = entryRegex.exec(xml)) !== null) {
        const block = entry[1];
        const id = (block.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
        const title = decodeXmlEntities(
            (block.match(/<title>([^<]*)<\/title>/) || [])[1] || "",
        );
        const published = (block.match(/<published>([^<]*)<\/published>/) || [])[1] || null;
        if (id) videos.push({id, title, published});
    }

    return {channelTitle, videos};
};

const extractJsonObject = (source, marker) => {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) return null;

    const startIndex = source.indexOf("{", markerIndex + marker.length);
    if (startIndex < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === "{") {
            depth += 1;
        } else if (character === "}") {
            depth -= 1;
            if (depth === 0) return source.slice(startIndex, index + 1);
        }
    }

    return null;
};

const getYoutubeInitialData = (html) => {
    const markers = [
        "var ytInitialData =",
        "window[\"ytInitialData\"] =",
        "ytInitialData =",
    ];

    for (const marker of markers) {
        const json = extractJsonObject(html, marker);
        if (!json) continue;
        try {
            return JSON.parse(json);
        } catch {
            // Try the next known assignment form.
        }
    }

    throw new Error("Could not read video data from the YouTube channel page.");
};

const getYoutubeInitialPlayerResponse = (html) => {
    const markers = [
        "var ytInitialPlayerResponse =",
        "window[\"ytInitialPlayerResponse\"] =",
        "ytInitialPlayerResponse =",
    ];
    for (const marker of markers) {
        const json = extractJsonObject(html, marker);
        if (!json) continue;
        try {
            return JSON.parse(json);
        } catch {
            // Try the next known assignment form.
        }
    }
    return null;
};

const getText = (value) => {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || "").join("");
    return "";
};

const parseYoutubeChannelPage = (html, maxVideos = 12) => {
    const initialData = getYoutubeInitialData(html);
    const channelTitle = initialData.metadata?.channelMetadataRenderer?.title || "";
    const videos = [];
    const seenVideoIds = new Set();

    const visit = (value) => {
        if (!value || videos.length >= maxVideos) return;
        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item);
                if (videos.length >= maxVideos) break;
            }
            return;
        }
        if (typeof value !== "object") return;

        const renderer = value.videoRenderer || value.gridVideoRenderer;
        const lockup = value.lockupViewModel?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" ?
            value.lockupViewModel : null;
        const id = renderer?.videoId || lockup?.contentId;
        if (id && /^[\w-]{11}$/.test(id) && !seenVideoIds.has(id)) {
            const lockupMetadata = lockup?.metadata?.lockupMetadataViewModel;
            const metadataParts = lockupMetadata?.metadata?.contentMetadataViewModel?.
                metadataRows?.flatMap((row) => row.metadataParts || []) || [];
            const publishedPart = metadataParts.find((part) => part.text?.accessibilityLabel) ||
                metadataParts[1];
            seenVideoIds.add(id);
            videos.push({
                id,
                title: getText(renderer?.title) || lockupMetadata?.title?.content || "",
                published: null,
                publishedText: getText(renderer?.publishedTimeText) ||
                    publishedPart?.text?.content || null,
            });
        }

        for (const child of Object.values(value)) {
            visit(child);
            if (videos.length >= maxVideos) break;
        }
    };

    visit(initialData.contents);
    return {channelTitle, videos};
};

const extractYoutubeChannelId = async (inputUrl, fetchImpl = fetch) => {
    const parsed = new URL(inputUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    if (parsed.protocol !== "https:" || (host !== "youtube.com" && host !== "m.youtube.com")) {
        throw new Error("Only YouTube URLs are allowed.");
    }
    const channelMatch = parsed.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/);
    if (channelMatch) return channelMatch[1];
    if (!/^\/(?:@[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(parsed.pathname)) {
        throw new Error("The YouTube URL must point to a channel.");
    }

    const pageResponse = await fetchImpl(parsed.href, {
        headers: YOUTUBE_PAGE_HEADERS,
        signal: AbortSignal.timeout(10000),
    });
    if (!pageResponse.ok) {
        throw new Error(`Could not load channel page (HTTP ${pageResponse.status}).`);
    }
    const html = await pageResponse.text();
    // A channel page can contain recommendations from other channels. Its
    // metadata identifies the owner; the first arbitrary channelId does not.
    const channelId = getYoutubeInitialData(html).metadata?.channelMetadataRenderer?.externalId;
    if (!/^UC[\w-]{22}$/.test(channelId || "")) {
        throw new Error("Could not determine the channel ID from this URL.");
    }
    return channelId;
};

const fetchYoutubeChannelVideos = async (
    channelId,
    maxVideos = 20,
    fetchImpl = fetch,
) => {
    const channelPageUrl = `https://www.youtube.com/channel/${channelId}/videos?hl=en&gl=US`;
    const pageResponse = await fetchImpl(channelPageUrl, {
        headers: YOUTUBE_PAGE_HEADERS,
    });
    if (!pageResponse.ok) {
        throw new Error(`YouTube channel page failed (HTTP ${pageResponse.status}).`);
    }
    return {
        channelId,
        ...parseYoutubeChannelPage(await pageResponse.text(), maxVideos),
    };
};

const fetchYoutubeChannelFeed = async (channelId, fetchImpl = fetch) => {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const feedResponse = await fetchImpl(feedUrl, {headers: YOUTUBE_REQUEST_HEADERS});
    if (feedResponse.ok) {
        const rssData = parseYoutubeRss(await feedResponse.text());
        return {channelId, ...rssData};
    }

    // YouTube intermittently returns 404 for otherwise valid RSS feeds. The public
    // channel page contains the same newest-video data and needs no API key.
    try {
        return await fetchYoutubeChannelVideos(channelId, 12, fetchImpl);
    } catch (error) {
        throw new Error(
            `YouTube feed failed (HTTP ${feedResponse.status}); ` +
            error.message,
            {cause: error},
        );
    }
};

// isLiveContent includes archives. Only explicit current-live signals count.
const parseYoutubePlayerMetadata = (html, expectedVideoId = null) => {
    const player = getYoutubeInitialPlayerResponse(html);
    const video = player?.videoDetails || {};
    const details = player?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
    if (!player || !/^[\w-]{11}$/.test(video.videoId || "") ||
        (expectedVideoId && video.videoId !== expectedVideoId) ||
        !/^UC[\w-]{22}$/.test(video.channelId || "")) {
        throw new Error("YouTube did not provide a verifiable video identity.");
    }
    const status = player.playabilityStatus?.status;
    const ended = Boolean(details?.endTimestamp || video.isPostLiveDvr);
    const upcoming = video.isUpcoming === true || status === "LIVE_STREAM_OFFLINE";
    let isLive = null;
    if (ended || upcoming) isLive = false;
    else if (status === "OK") {
        if (details?.isLiveNow === true || video.isLive === true) isLive = true;
        else if (details?.isLiveNow === false || video.isLiveContent === false) isLive = false;
    }
    return {
        isLive, streamId: video.videoId, broadcasterId: video.channelId,
        broadcasterLogin: null, title: String(video.title || "").slice(0, 300),
        tags: Array.isArray(video.keywords) ? video.keywords.slice(0, 20) : [],
        categoryId: null, categoryName: "",
    };
};

const parseYoutubeLiveCandidates = (html, channelId) => {
    const data = getYoutubeInitialData(html);
    if (data.metadata?.channelMetadataRenderer?.externalId !== channelId) {
        throw new Error("YouTube returned a different channel.");
    }
    const ids = new Set();
    const hasLiveBadge = (value) => {
        if (!value || typeof value !== "object") return false;
        if (value.style === "LIVE" || value.style === "BADGE_STYLE_TYPE_LIVE_NOW" ||
            value.badgeStyle === "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE") return true;
        return Object.values(value).some(hasLiveBadge);
    };
    const visit = (value) => {
        if (!value || typeof value !== "object") return;
        const video = value.videoRenderer || value.gridVideoRenderer ||
            (value.lockupViewModel?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" ?
                value.lockupViewModel : null);
        if (video) {
            const id = video.videoId || video.contentId;
            if (/^[\w-]{11}$/.test(id || "") && !video.upcomingEventData &&
                hasLiveBadge([video.badges, video.thumbnailOverlays, video.contentImage])) ids.add(id);
            return;
        }
        Object.values(value).forEach(visit);
    };
    visit(data.contents);
    return [...ids].slice(0, 5);
};

const fetchYoutubeChannelLiveMetadata = async (channelId, videoId = null, fetchImpl = fetch) => {
    if (!/^UC[\w-]{22}$/.test(channelId || "")) throw new Error("Invalid YouTube channel identity.");
    const response = await fetchImpl("https://www.youtube.com/channel/" + channelId + "/streams?hl=en&gl=US",
        {headers: YOUTUBE_PAGE_HEADERS, signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("YouTube streams page failed (HTTP " + response.status + ").");
    const html = await response.text();
    const ids = parseYoutubeLiveCandidates(html, channelId);
    const selectedId = videoId || ids[0];
    if (!selectedId || !ids.includes(selectedId)) return {isLive: false, streamId: videoId, broadcasterId: channelId};
    const videos = parseYoutubeChannelPage(html, 50).videos;
    const title = videos.find((item) => item.id === selectedId)?.title;
    if (!title) throw new Error("YouTube live listing is incomplete.");
    return {isLive: true, streamId: selectedId, broadcasterId: channelId,
        broadcasterLogin: null, title: title.slice(0, 300), tags: [], categoryId: null, categoryName: ""};
};

const fetchYoutubeVideoChannelId = async (videoId, fetchImpl = fetch) => {
    if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("A valid YouTube video ID is required.");
    const response = await fetchImpl("https://www.youtube.com/oembed?" +
        new URLSearchParams({url: "https://www.youtube.com/watch?v=" + videoId, format: "json"}),
    {headers: YOUTUBE_PAGE_HEADERS, signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("YouTube could not identify the video owner.");
    const body = await response.json();
    return extractYoutubeChannelId(body.author_url, fetchImpl);
};

const fetchYoutubeLiveVideoMetadata = async (videoId, fetchImpl = fetch) => {
    if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("A valid YouTube video ID is required.");
    const response = await fetchImpl("https://www.youtube.com/watch?v=" + videoId + "&hl=en&gl=US",
        {headers: YOUTUBE_PAGE_HEADERS, signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("YouTube watch page failed (HTTP " + response.status + ").");
    return parseYoutubePlayerMetadata(await response.text(), videoId);
};

// /live may select a stale scheduled broadcast while another output is live.
const fetchYoutubeActiveLiveVideo = async (channelId, fetchImpl = fetch) => {
    if (!/^UC[\w-]{22}$/.test(channelId || "")) throw new Error("A valid YouTube channel ID is required.");
    try {
        const response = await fetchImpl("https://www.youtube.com/channel/" + channelId + "/live?hl=en&gl=US",
            {headers: YOUTUBE_PAGE_HEADERS, signal: AbortSignal.timeout(10000)});
        if (response.ok) {
            const metadata = parseYoutubePlayerMetadata(await response.text());
            if (metadata.isLive === true && metadata.broadcasterId === channelId) {
                return {videoId: metadata.streamId,
                    url: "https://www.youtube.com/watch?v=" + metadata.streamId, metadata};
            }
        }
    } catch {
        // An incomplete player is not an offline verdict; use the Streams tab.
    }
    const metadata = await fetchYoutubeChannelLiveMetadata(channelId, null, fetchImpl);
    return metadata.isLive ? {videoId: metadata.streamId,
        url: "https://www.youtube.com/watch?v=" + metadata.streamId, metadata} : null;
};

module.exports = {
    extractYoutubeChannelId, fetchYoutubeActiveLiveVideo, fetchYoutubeLiveVideoMetadata,
    fetchYoutubeChannelFeed, fetchYoutubeChannelVideos, parseYoutubeChannelPage, parseYoutubeRss,
    parseYoutubePlayerMetadata, parseYoutubeLiveCandidates,
    fetchYoutubeChannelLiveMetadata, fetchYoutubeVideoChannelId,
};
