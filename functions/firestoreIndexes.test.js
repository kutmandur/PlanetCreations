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
