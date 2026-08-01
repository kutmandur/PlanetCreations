"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    getCollaborationRevokeVoteState,
    hasAllMemberPublishConsent,
    mergeCollaborationContributors,
    selectCollaborationPublicationCategory,
} = require("./collaborationPublish");

test("merges durable contributor credit by uid", () => {
    assert.deepEqual(mergeCollaborationContributors(
        [{uid: "owner", username: "Owner"}],
        [{uid: "builder", username: "Builder"}],
        [{uid: "builder", username: "Builder renamed"}],
    ), [
        {uid: "owner", username: "Owner"},
        {uid: "builder", username: "Builder"},
    ]);
});

test("requires standing consent from every current member", () => {
    const members = [
        {uid: "owner", publishConsent: {agreed: true}},
        {uid: "builder", publishConsent: {agreed: true}},
    ];
    assert.equal(
        hasAllMemberPublishConsent(["owner", "builder"], members),
        true,
    );
    assert.equal(
        hasAllMemberPublishConsent(["owner", "builder", "viewer"], members),
        false,
    );
});

test("revoke votes count current members and drop departed members", () => {
    assert.deepEqual(
        getCollaborationRevokeVoteState(
            ["owner", "builder", "viewer"],
            ["owner", "departed"],
            "builder",
        ),
        {
            voterIds: ["owner", "builder"],
            voteCount: 2,
            requiredCount: 3,
            unanimous: false,
        },
    );
    assert.equal(
        getCollaborationRevokeVoteState(
            ["owner", "builder"],
            ["owner", "builder", "departed"],
        ).unanimous,
        true,
    );
});

test("publication category follows the saved file kind", () => {
    const categories = ["Scenery", "Blueprints", "Parks"];
    assert.equal(
        selectCollaborationPublicationCategory("blueprint", categories),
        "Blueprints",
    );
    assert.equal(
        selectCollaborationPublicationCategory("park", categories),
        "Parks",
    );
    assert.equal(
        selectCollaborationPublicationCategory("park", []),
        "Collaboration",
    );
});
