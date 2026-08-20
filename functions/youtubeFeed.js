"use strict";

const YOUTUBE_REQUEST_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
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
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") {
        throw new Error("Only YouTube URLs are allowed.");
    }
    const channelMatch = parsed.pathname.match(/\/channel\/(UC[\w-]{22})/);
    if (channelMatch) return channelMatch[1];
    if (!/^\/(?:@[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(parsed.pathname)) {
        throw new Error("The YouTube URL must point to a channel.");
    }

    const pageResponse = await fetchImpl(parsed.href, {
        headers: YOUTUBE_REQUEST_HEADERS,
    });
    if (!pageResponse.ok) {
        throw new Error(`Could not load channel page (HTTP ${pageResponse.status}).`);
    }
    const html = await pageResponse.text();
    const idMatch = html.match(/"channelId":"(UC[\w-]{22})"/) ||
        html.match(/channel_id=(UC[\w-]{22})/);
    if (!idMatch) {
        throw new Error("Could not determine the channel ID from this URL.");
    }
    return idMatch[1];
};

const fetchYoutubeChannelVideos = async (
    channelId,
    maxVideos = 20,
    fetchImpl = fetch,
) => {
    const channelPageUrl = `https://www.youtube.com/channel/${channelId}/videos?hl=en&gl=US`;
    const pageResponse = await fetchImpl(channelPageUrl, {
        headers: {
            ...YOUTUBE_REQUEST_HEADERS,
            Cookie: "CONSENT=YES+cb",
        },
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

module.exports = {
    extractYoutubeChannelId,
    fetchYoutubeChannelFeed,
    fetchYoutubeChannelVideos,
    parseYoutubeChannelPage,
    parseYoutubeRss,
};
