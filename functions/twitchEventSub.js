"use strict";

const crypto = require("crypto");

function isValidEventSubSignature({
    secret,
    messageId,
    timestamp,
    signature,
    rawBody,
    nowMs = Date.now(),
}) {
    const timestampMs = Date.parse(timestamp);
    if (!secret || !messageId || !signature || !Buffer.isBuffer(rawBody) ||
        !Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > 10 * 60 * 1000) {
        return false;
    }
    const expected = `sha256=${crypto.createHmac("sha256", secret)
        .update(Buffer.concat([Buffer.from(messageId), Buffer.from(timestamp), rawBody]))
        .digest("hex")}`;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = {isValidEventSubSignature};
