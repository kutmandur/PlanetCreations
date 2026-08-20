const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexConfiguration = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "firestore.indexes.json"),
    "utf8",
));

function hasCollectionGroupAscendingIndex(collectionGroup, fieldPath) {
    const override = indexConfiguration.fieldOverrides.find((candidate) =>
        candidate.collectionGroup === collectionGroup &&
        candidate.fieldPath === fieldPath);
    return Boolean(override?.indexes?.some((index) =>
        index.order === "ASCENDING" &&
        index.queryScope === "COLLECTION_GROUP"));
}

function hasDisabledFieldIndex(collectionGroup, fieldPath) {
    const override = indexConfiguration.fieldOverrides.find((candidate) =>
        candidate.collectionGroup === collectionGroup &&
        candidate.fieldPath === fieldPath);
    return Array.isArray(override?.indexes) && override.indexes.length === 0;
}

test("account cleanup legacy invitation queries retain their indexes", () => {
    assert.equal(
        hasCollectionGroupAscendingIndex("invitations", "targetUserId"),
        true,
    );
    assert.equal(
        hasCollectionGroupAscendingIndex("invitations", "senderId"),
        true,
    );
});

test("large YouTube shard maps are excluded from automatic indexing", () => {
    assert.equal(
        hasDisabledFieldIndex("youtubeVideoIndexShards", "c"),
        true,
    );
});

test("all scalable map-index shard payloads skip automatic field indexing", () => {
    for (const collectionGroup of [
        "searchIndexShards",
        "communitySearchIndexShards",
        "userSearchIndexShards",
        "showcaseIndexShards",
    ]) {
        assert.equal(
            hasDisabledFieldIndex(collectionGroup, "e"),
            true,
            `${collectionGroup}.e must not create per-entry indexes`,
        );
    }
});
