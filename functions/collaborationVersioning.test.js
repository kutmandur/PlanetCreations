const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildCollaborationStoragePrefix,
    buildCollaborationVersionStorageKey,
    canDownloadCollaborationVersion,
    getCollaborationRetentionLimit,
    getNextVersionNumber,
    getVersionNumber,
    isCollaborationStorageObjectKey,
    isCollaborationVersionStorageKey,
    requireSafeId,
    selectPrunableVersions,
    shouldPromotePendingVersion,
} = require("./collaborationVersioning");

test("allows collaboration version downloads only for actual members", () => {
    assert.equal(canDownloadCollaborationVersion({memberExists: true}), true);
    assert.equal(canDownloadCollaborationVersion({memberExists: false}), false);
    assert.equal(
        canDownloadCollaborationVersion({
            memberExists: false,
            isModerator: true,
        }),
        false,
    );
});

test("binds every collaboration version to its exact R2 object key", () => {
    const key = buildCollaborationVersionStorageKey("collab_123", "version-456");
    assert.equal(
        key,
        "collaboration-files/collab_123/save/version-456.PlanetCreations",
    );
    assert.equal(
        isCollaborationVersionStorageKey(key, "collab_123", "version-456"),
        true,
    );
    assert.equal(
        isCollaborationVersionStorageKey(key, "other-collab", "version-456"),
        false,
    );
    assert.equal(
        isCollaborationVersionStorageKey("creation-backups/user/file", "collab_123", "version-456"),
        false,
    );
});

test("allows cleanup to enumerate only exact collaboration version objects", () => {
    assert.equal(
        buildCollaborationStoragePrefix("collab_123"),
        "collaboration-files/collab_123/save/",
    );
    assert.equal(
        isCollaborationStorageObjectKey(
            "collaboration-files/collab_123/save/version-456.PlanetCreations",
            "collab_123",
        ),
        true,
    );
    assert.equal(
        isCollaborationStorageObjectKey(
            "collaboration-files/collab_123/save/nested/version.PlanetCreations",
            "collab_123",
        ),
        false,
    );
    assert.equal(
        isCollaborationStorageObjectKey(
            "collaboration-files/collab_1234/save/version.PlanetCreations",
            "collab_123",
        ),
        false,
    );
    assert.equal(
        isCollaborationStorageObjectKey(
            "collaboration-files/collab_123/save/version.zip",
            "collab_123",
        ),
        false,
    );
});

test("rejects path separators and traversal in Firestore identifiers", () => {
    assert.throws(() => requireSafeId("../collab", "Collaboration ID"));
    assert.throws(() => requireSafeId("collab/version", "Collaboration ID"));
    assert.throws(() => requireSafeId("", "Collaboration ID"));
});

test("uses three contributor versions until the collaboration exceeds ten members", () => {
    assert.equal(getCollaborationRetentionLimit(1), 3);
    assert.equal(getCollaborationRetentionLimit(10), 3);
    assert.equal(getCollaborationRetentionLimit(11), 2);
});

test("normalizes legacy and current version number fields", () => {
    assert.equal(getVersionNumber({versionNumber: 7}), 7);
    assert.equal(getVersionNumber({number: 6}), 6);
    assert.equal(getNextVersionNumber({currentVersion: {number: 9}}), 10);
    assert.equal(getNextVersionNumber({
        latestVersionNumber: 12,
        currentVersion: {number: 9},
    }), 13);
    assert.equal(getNextVersionNumber(null), 1);
});

test("does not make a late save current when a newer build already supplied one", () => {
    assert.equal(shouldPromotePendingVersion(1000, 2000), false);
    assert.equal(shouldPromotePendingVersion(2000, 1000), true);
    assert.equal(shouldPromotePendingVersion(2000, null), true);
    assert.equal(shouldPromotePendingVersion(null, 2000), false);
});

test("prunes only versions outside retention and never the current version", () => {
    const versions = [
        {id: "v1", versionNumber: 1},
        {id: "v2", versionNumber: 2},
        {id: "v3", versionNumber: 3},
        {id: "v4", versionNumber: 4},
    ];
    assert.deepEqual(
        selectPrunableVersions(versions, 3, "v4").map((version) => version.id),
        ["v1"],
    );
    assert.deepEqual(
        selectPrunableVersions(versions, 2, "v1").map((version) => version.id),
        ["v2"],
    );
});
