"use strict";

const PLATFORM_FIELDS = [
    "url",
    "platformStreamId",
    "broadcasterId",
    "broadcasterLogin",
    "streamTitle",
    "streamTags",
    "categoryId",
    "categoryName",
    "initialCategoryId",
    "titleHash",
    "categoryMismatchSince",
    "channelClaimId",
    "startedAt",
    "updatedAt",
    "verifiedAt",
    "expiresAt",
];
const PRIMARY_MIRROR_FIELDS = PLATFORM_FIELDS.filter((field) => ![
    "startedAt",
    "updatedAt",
    "verifiedAt",
    "expiresAt",
].includes(field));

const getSessionStreams = (session = {}) => {
    const streams = {};
    if (session.streams && typeof session.streams === "object" && !Array.isArray(session.streams)) {
        for (const [platform, stream] of Object.entries(session.streams)) {
            if ((platform === "twitch" || platform === "youtube") && stream?.url) {
                streams[platform] = {...stream, platform};
            }
        }
    }
    if (Object.keys(streams).length === 0 && session.platform && session.url) {
        streams[session.platform] = {platform: session.platform};
        for (const field of PLATFORM_FIELDS) {
            if (session[field] !== undefined) streams[session.platform][field] = session[field];
        }
    }
    return streams;
};

const getPrimaryPlatform = (session = {}, streams = getSessionStreams(session)) => {
    if (session.primaryPlatform && streams[session.primaryPlatform]) return session.primaryPlatform;
    if (session.platform && streams[session.platform]) return session.platform;
    return Object.keys(streams)[0] || null;
};

const withPrimaryStreamFields = (session, streams, preferredPlatform = null) => {
    const normalizedStreams = getSessionStreams({streams});
    const primaryPlatform = preferredPlatform && normalizedStreams[preferredPlatform] ?
        preferredPlatform : getPrimaryPlatform(session, normalizedStreams);
    const primary = primaryPlatform ? normalizedStreams[primaryPlatform] : null;
    const next = {...session, streams: normalizedStreams, primaryPlatform};
    if (!primary) return next;
    next.platform = primaryPlatform;
    for (const field of PRIMARY_MIRROR_FIELDS) {
        next[field] = primary[field] ?? null;
    }
    return next;
};

const creationLiveStreamFromSession = (session) => {
    const streams = getSessionStreams(session);
    const primaryPlatform = getPrimaryPlatform(session, streams);
    const primary = primaryPlatform ? streams[primaryPlatform] : null;
    if (!primary) return null;
    const publicStreams = Object.fromEntries(Object.entries(streams).map(([platform, stream]) => [
        platform,
        {
            platform,
            url: stream.url,
            startedAt: stream.startedAt || session.startedAt || null,
            expiresAt: stream.expiresAt || session.expiresAt || null,
            verifiedAt: stream.verifiedAt || session.verifiedAt || null,
        },
    ]));
    return {
        platform: primaryPlatform,
        url: primary.url,
        streams: publicStreams,
        sessionId: session.sessionId,
        startedAt: primary.startedAt || session.startedAt || null,
        expiresAt: primary.expiresAt || session.expiresAt || null,
        verifiedAt: primary.verifiedAt || session.verifiedAt || null,
    };
};

module.exports = {
    creationLiveStreamFromSession,
    getPrimaryPlatform,
    getSessionStreams,
    withPrimaryStreamFields,
};
