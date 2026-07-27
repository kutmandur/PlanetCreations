const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeCollaborationVisibility,
    buildPublicCollaborationSummary,
    sanitizePublicMember,
    sanitizePublicVersion,
    sanitizePublicUpload,
    sanitizePublicTodo,
} = require("./collaborationPublicView");

test("visibility defaults to unlisted and only accepts the explicit public value", () => {
    assert.equal(normalizeCollaborationVisibility("public"), "public");
    assert.equal(normalizeCollaborationVisibility("unlisted"), "unlisted");
    assert.equal(normalizeCollaborationVisibility("anything-else"), "unlisted");
});

test("public summary omits invite credentials, member ids and private storage data", () => {
    const summary = buildPublicCollaborationSummary("collab-1", {
        title: "Public project",
        description: "Safe description",
        game: "planet-coaster-2",
        visibility: "public",
        ownerId: "owner-1",
        memberIds: ["owner-1", "member-2"],
        inviteCode: "SECRET12",
        passwordHash: "private-hash",
        passwordSalt: "private-salt",
        bannerImageUrl: "https://example.com/banner.jpg",
        galleryImageUrls: [
            "https://example.com/image.jpg",
            "ftp://example.com/private.jpg",
        ],
        currentVersion: {
            versionId: "version-1",
            number: 3,
            uploadedBy: "owner-1",
            uploadedByUsername: "Owner",
            storageKey: "private/storage/key",
        },
        buildLock: {
            activeBuilderId: "member-2",
            username: "Builder",
        },
    });

    assert.equal(summary.memberCount, 2);
    assert.equal(summary.userRole, "visitor");
    assert.deepEqual(summary.galleryImageUrls, ["https://example.com/image.jpg"]);
    assert.equal(summary.buildLock.activeBuilderId, "public-active-builder");
    assert.equal(summary.currentVersion.uploadedByUsername, "Owner");
    for (const privateField of [
        "inviteCode",
        "passwordHash",
        "passwordSalt",
        "memberIds",
        "storageKey",
    ]) {
        assert.equal(Object.hasOwn(summary, privateField), false);
        assert.equal(Object.hasOwn(summary.currentVersion, privateField), false);
    }
});

test("public detail records use explicit safe allowlists", () => {
    const member = sanitizePublicMember("member-1", {
        username: "Builder",
        role: "editor",
        publishConsent: {agreed: true},
    });
    const version = sanitizePublicVersion("version-1", {
        versionNumber: 4,
        storageKey: "private/version/key",
        uploadedBy: "member-1",
        uploadedByUsername: "Builder",
    });
    const upload = sanitizePublicUpload("upload-1", {
        userId: "member-1",
        username: "Builder",
        changelog: "Changed the entrance",
        imageUrls: ["https://example.com/change.jpg"],
        storageKey: "private/upload/key",
    });
    const todo = sanitizePublicTodo("todo-1", {
        text: "Finish entrance",
        createdBy: "member-1",
    });

    assert.deepEqual(member, {
        id: "member-1",
        username: "Builder",
        role: "editor",
        joinedAt: null,
    });
    assert.equal(Object.hasOwn(version, "storageKey"), false);
    assert.equal(Object.hasOwn(version, "uploadedBy"), false);
    assert.equal(Object.hasOwn(upload, "storageKey"), false);
    assert.equal(Object.hasOwn(upload, "userId"), false);
    assert.equal(Object.hasOwn(todo, "createdBy"), false);
});
