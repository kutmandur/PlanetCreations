"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    getCollaborationInvitationGrantId,
    hasActiveCollaborationBuildLock,
    isCollaborationManager,
} = require("./collaborationAccess");

test("binds an invitation grant to one collaboration and recipient", () => {
    assert.equal(
        getCollaborationInvitationGrantId("collaboration-1", "user-1"),
        "collaboration-1--user-1",
    );
    assert.notEqual(
        getCollaborationInvitationGrantId("collaboration-1", "user-1"),
        getCollaborationInvitationGrantId("collaboration-1", "user-2"),
    );
});

test("limits collaboration management to the owner and site staff", () => {
    const collaboration = { ownerId: "owner-1" };
    assert.equal(
        isCollaborationManager(collaboration, "owner-1", "user"),
        true,
    );
    assert.equal(
        isCollaborationManager(collaboration, "user-1", "moderator"),
        true,
    );
    assert.equal(
        isCollaborationManager(collaboration, "user-1", "admin"),
        true,
    );
    assert.equal(
        isCollaborationManager(collaboration, "user-1", "influencer"),
        false,
    );
});

test("only treats a matching, unexpired build lock as active", () => {
    const now = 1_000;
    const collaboration = {
        buildLock: {
            activeBuilderId: "builder-1",
            expiresAt: { toMillis: () => now + 1 },
        },
    };
    assert.equal(
        hasActiveCollaborationBuildLock(collaboration, "builder-1", now),
        true,
    );
    assert.equal(
        hasActiveCollaborationBuildLock(collaboration, "builder-2", now),
        false,
    );
    assert.equal(
        hasActiveCollaborationBuildLock(collaboration, "builder-1", now + 1),
        false,
    );
});
