"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    claimBelongsToSession,
    getLiveChannelClaimId,
    getLiveChannelIdentity,
    isClaimHeldByAnotherUser,
} = require("./liveChannelClaims");

test("builds one stable claim identity per platform channel", () => {
    assert.equal(
        getLiveChannelIdentity("twitch", {broadcasterId: "123", broadcasterLogin: "Creator"}),
        "twitch:123",
    );
    assert.equal(
        getLiveChannelIdentity("youtube", {broadcasterId: "UC123"}),
        "youtube:UC123",
    );
    assert.equal(
        getLiveChannelClaimId("twitch", {broadcasterId: "123"}),
        getLiveChannelClaimId("twitch", {broadcasterId: "123", broadcasterLogin: "renamed"}),
    );
    assert.notEqual(
        getLiveChannelClaimId("twitch", {broadcasterId: "123"}),
        getLiveChannelClaimId("youtube", {broadcasterId: "123"}),
    );
});

test("blocks an unexpired claim held by another user", () => {
    const now = 1_800_000_000_000;
    assert.equal(isClaimHeldByAnotherUser({
        uid: "other-user",
        expiresAt: {toMillis: () => now + 60_000},
    }, "current-user", now), true);
    assert.equal(isClaimHeldByAnotherUser({
        uid: "other-user",
        expiresAt: {toMillis: () => now - 1},
    }, "current-user", now), false);
    assert.equal(isClaimHeldByAnotherUser({
        uid: "current-user",
        expiresAt: {toMillis: () => now + 60_000},
    }, "current-user", now), false);
});

test("only the owning session may release its claim", () => {
    const claim = {uid: "owner", sessionId: "session-1"};
    assert.equal(claimBelongsToSession(claim, "owner", "session-1"), true);
    assert.equal(claimBelongsToSession(claim, "owner", "session-2"), false);
    assert.equal(claimBelongsToSession(claim, "someone-else", "session-1"), false);
});
