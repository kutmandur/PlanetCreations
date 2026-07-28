const test = require("node:test");
const assert = require("node:assert/strict");
const {
    DISCORD_OAUTH_PROVIDER,
    buildDiscordAuthorizeUrl,
    getRateLimitDecision,
    hashOAuthState,
    isAllowedCorsOrigin,
    isValidOAuthStateRecord,
} = require("./security");

test("CORS accepts only the production sites and native requests", () => {
    assert.equal(isAllowedCorsOrigin(undefined), true);
    assert.equal(isAllowedCorsOrigin("null"), true);
    assert.equal(isAllowedCorsOrigin("https://planetcreations.net"), true);
    assert.equal(isAllowedCorsOrigin("https://www.planetcreations.net"), true);
    assert.equal(isAllowedCorsOrigin("https://example.invalid"), false);
    assert.equal(isAllowedCorsOrigin("http://localhost:3000"), false);
});

test("Discord authorization URL contains an opaque state", () => {
    const url = new URL(buildDiscordAuthorizeUrl({
        clientId: "client-1",
        redirectUri: "https://example.com/callback",
        state: "opaque-state",
    }));
    assert.equal(url.origin, "https://discord.com");
    assert.equal(url.searchParams.get("client_id"), "client-1");
    assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/callback");
    assert.equal(url.searchParams.get("scope"), "identify guilds");
    assert.equal(url.searchParams.get("state"), "opaque-state");
});

test("OAuth states are hashed and expire", () => {
    assert.match(hashOAuthState("opaque-state"), /^[a-f0-9]{64}$/);
    const record = {
        uid: "user-1",
        provider: DISCORD_OAUTH_PROVIDER,
        expiresAt: {toMillis: () => 20_000},
    };
    assert.equal(isValidOAuthStateRecord(record, 19_999), true);
    assert.equal(isValidOAuthStateRecord(record, 20_000), false);
    assert.equal(isValidOAuthStateRecord({...record, uid: ""}, 19_999), false);
});

test("rate limit windows increment, reject and reset", () => {
    const first = getRateLimitDecision({
        limit: 2,
        nowMs: 1_000,
        windowMs: 10_000,
    });
    assert.deepEqual(first, {
        allowed: true,
        count: 1,
        retryAfterMs: 0,
        windowStartedAtMs: 1_000,
    });
    const second = getRateLimitDecision({
        currentCount: first.count,
        currentWindowStartedAtMs: first.windowStartedAtMs,
        limit: 2,
        nowMs: 2_000,
        windowMs: 10_000,
    });
    assert.equal(second.allowed, true);
    assert.equal(second.count, 2);
    const rejected = getRateLimitDecision({
        currentCount: second.count,
        currentWindowStartedAtMs: second.windowStartedAtMs,
        limit: 2,
        nowMs: 3_000,
        windowMs: 10_000,
    });
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.retryAfterMs, 8_000);
    const reset = getRateLimitDecision({
        currentCount: second.count,
        currentWindowStartedAtMs: second.windowStartedAtMs,
        limit: 2,
        nowMs: 11_000,
        windowMs: 10_000,
    });
    assert.equal(reset.allowed, true);
    assert.equal(reset.count, 1);
    assert.equal(reset.windowStartedAtMs, 11_000);
});
