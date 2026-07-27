const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildCollaborationReleaseNotification,
    calculateWorkDurationMinutes,
    getCollaborationReleaseRecipientIds,
    getMissingSaveWarning,
    isChangelogOwner,
    canAttachPendingSave,
} = require("./collaborationChangelogState");

test("notifies every current collaboration member except the builder", () => {
    assert.deepEqual(
        getCollaborationReleaseRecipientIds(
            ["builder", "member-1", "member-2", "member-1", ""],
            "builder",
        ),
        ["member-1", "member-2"],
    );
});

test("builds a collaboration availability notification with a direct link", () => {
    assert.deepEqual(buildCollaborationReleaseNotification({
        collaborationId: "collab-1",
        collaborationTitle: "Shared Park",
        username: "Builder",
    }), {
        title: "Shared Park is free to build",
        message: "Builder left build mode. The creation is available now.",
        link: "/collaboration/collab-1",
    });
});

test("calculates at least one minute for a completed build turn", () => {
    assert.equal(calculateWorkDurationMinutes(1000, 2000), 1);
    assert.equal(calculateWorkDurationMinutes(0, 5 * 60000), 5);
});

test("warns about the newest changelog until its missing save is acknowledged", () => {
    const latest = {
        entryId: "entry-1",
        userId: "user-1",
        username: "Builder",
        hasSave: false,
    };
    assert.deepEqual(getMissingSaveWarning(latest, false), {
        entryId: "entry-1",
        userId: "user-1",
        username: "Builder",
    });
    assert.equal(getMissingSaveWarning(latest, true), null);
    assert.equal(getMissingSaveWarning({...latest, hasSave: true}, false), null);
});

test("only the changelog author can edit it or attach its pending save", () => {
    const pending = {
        kind: "changelog",
        status: "pending-save",
        userId: "user-1",
        hasSave: false,
        versionId: null,
    };
    assert.equal(isChangelogOwner(pending, "user-1"), true);
    assert.equal(isChangelogOwner(pending, "user-2"), false);
    assert.equal(canAttachPendingSave(pending, "user-1"), true);
    assert.equal(canAttachPendingSave(pending, "user-2"), false);
    assert.equal(canAttachPendingSave({...pending, hasSave: true}, "user-1"), false);
    assert.equal(canAttachPendingSave({...pending, status: "complete"}, "user-1"), false);
    assert.equal(canAttachPendingSave({...pending, kind: "version"}, "user-1"), false);
});
