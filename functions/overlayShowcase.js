"use strict";

const OVERLAY_SHOWCASE_KIND = "community-showcase";
const OVERLAY_SHOWCASE_CREATION_LIMIT = 100;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function cleanId(value, label) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!SAFE_ID.test(normalized)) throw new Error(`${label} is invalid.`);
    return normalized;
}

function normalizeOverlayShowcaseRequest(entry) {
    if (!entry || entry.kind !== OVERLAY_SHOWCASE_KIND) {
        throw new Error("The overlay showcase type is invalid.");
    }
    const communityId = cleanId(entry.communityId, "Community ID");
    const creationIds = [];
    const seen = new Set();
    if (!Array.isArray(entry.creationIds)) {
        throw new Error("Creation IDs are required.");
    }
    for (const rawId of entry.creationIds) {
        const id = cleanId(rawId, "Creation ID");
        if (!seen.has(id)) {
            seen.add(id);
            creationIds.push(id);
        }
    }
    if (creationIds.length === 0 || creationIds.length > OVERLAY_SHOWCASE_CREATION_LIMIT) {
        throw new Error(`An overlay showcase must contain between 1 and ${OVERLAY_SHOWCASE_CREATION_LIMIT} creations.`);
    }
    const activeCreationId = entry.activeCreationId ?
        cleanId(entry.activeCreationId, "Active creation ID") : creationIds[0];
    if (!seen.has(activeCreationId)) {
        throw new Error("The active creation must be part of the showcase.");
    }
    return {
        kind: OVERLAY_SHOWCASE_KIND,
        communityId,
        showcaseId: entry.showcaseId ? cleanId(entry.showcaseId, "Showcase ID") : "",
        showcaseTitle: String(entry.showcaseTitle || "").trim().slice(0, 100),
        creationIds,
        activeCreationId,
    };
}

module.exports = {
    OVERLAY_SHOWCASE_CREATION_LIMIT,
    OVERLAY_SHOWCASE_KIND,
    normalizeOverlayShowcaseRequest,
};
