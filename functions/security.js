const crypto = require("crypto");

const DISCORD_OAUTH_PROVIDER = "discord";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ALLOWED_WEB_ORIGINS = new Set([
    "https://planetcreations.net",
    "https://www.planetcreations.net",
]);

const isAllowedCorsOrigin = (origin) =>
    !origin || origin === "null" || ALLOWED_WEB_ORIGINS.has(origin);

const hashOAuthState = (state) =>
    crypto.createHash("sha256").update(state, "utf8").digest("hex");

const buildDiscordAuthorizeUrl = ({
    clientId,
    redirectUri,
    state,
}) => {
    if (!clientId || !redirectUri || !state) {
        throw new Error("Discord OAuth configuration is incomplete.");
    }
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify guilds",
        state,
    }).toString();
    return url.toString();
};

const getTimestampMillis = (value) => {
    if (value && typeof value.toMillis === "function") {
        return value.toMillis();
    }
    if (value instanceof Date) return value.getTime();
    return Number(value);
};

const isValidOAuthStateRecord = (record, nowMs = Date.now()) => {
    if (!record || record.provider !== DISCORD_OAUTH_PROVIDER ||
        typeof record.uid !== "string" || !record.uid) {
        return false;
    }
    const expiresAtMs = getTimestampMillis(record.expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
};

const getRateLimitDecision = ({
    currentCount = 0,
    currentWindowStartedAtMs = 0,
    limit,
    nowMs,
    windowMs,
}) => {
    const hasActiveWindow = Number.isFinite(currentWindowStartedAtMs) &&
        currentWindowStartedAtMs > 0 &&
        nowMs - currentWindowStartedAtMs < windowMs;
    if (!hasActiveWindow) {
        return {
            allowed: true,
            count: 1,
            retryAfterMs: 0,
            windowStartedAtMs: nowMs,
        };
    }
    if (currentCount >= limit) {
        return {
            allowed: false,
            count: currentCount,
            retryAfterMs: Math.max(
                1,
                currentWindowStartedAtMs + windowMs - nowMs,
            ),
            windowStartedAtMs: currentWindowStartedAtMs,
        };
    }
    return {
        allowed: true,
        count: currentCount + 1,
        retryAfterMs: 0,
        windowStartedAtMs: currentWindowStartedAtMs,
    };
};

module.exports = {
    ALLOWED_WEB_ORIGINS,
    DISCORD_OAUTH_PROVIDER,
    OAUTH_STATE_TTL_MS,
    buildDiscordAuthorizeUrl,
    getRateLimitDecision,
    hashOAuthState,
    isAllowedCorsOrigin,
    isValidOAuthStateRecord,
};
