"use strict";

const crypto = require("crypto");

const getLiveChannelIdentity = (platform, data = {}) => {
    if (platform === "twitch") {
        const broadcasterId = String(data.broadcasterId || "").trim();
        if (broadcasterId) return `twitch:${broadcasterId}`;
        const login = String(data.broadcasterLogin || "").trim().toLowerCase();
        return login ? `twitch-login:${login}` : null;
    }
    if (platform === "youtube") {
        const channelId = String(data.broadcasterId || "").trim();
        return channelId ? `youtube:${channelId}` : null;
    }
    return null;
};

const getLiveChannelClaimId = (platform, data = {}) => {
    const identity = getLiveChannelIdentity(platform, data);
    return identity ? crypto.createHash("sha256").update(identity).digest("hex") : null;
};

const timestampMillis = (value) => {
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.seconds === "number") return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    return Number.NaN;
};

const isClaimHeldByAnotherUser = (claim, uid, now = Date.now()) => {
    if (!claim || claim.uid === uid) return false;
    const expiresAt = timestampMillis(claim.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt > now;
};

const claimBelongsToSession = (claim, uid, sessionId) => Boolean(
    claim && claim.uid === uid && claim.sessionId === sessionId,
);

module.exports = {
    claimBelongsToSession,
    getLiveChannelClaimId,
    getLiveChannelIdentity,
    isClaimHeldByAnotherUser,
};
