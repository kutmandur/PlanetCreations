"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {isValidEventSubSignature} = require("./twitchEventSub");

const secret = "a-long-random-webhook-secret";
const messageId = "message-1";
const timestamp = "2026-08-20T10:00:00.000Z";
const rawBody = Buffer.from('{"event":{"title":"Steampunkia"}}');
const signature = `sha256=${crypto.createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(messageId), Buffer.from(timestamp), rawBody]))
    .digest("hex")}`;

test("accepts only the exact recent Twitch EventSub payload", () => {
    const input = {
        secret,
        messageId,
        timestamp,
        signature,
        rawBody,
        nowMs: Date.parse(timestamp) + 1000,
    };
    assert.equal(isValidEventSubSignature(input), true);
    assert.equal(isValidEventSubSignature({...input, rawBody: Buffer.from("tampered")}), false);
    assert.equal(isValidEventSubSignature({...input, nowMs: Date.parse(timestamp) + 11 * 60 * 1000}), false);
});
