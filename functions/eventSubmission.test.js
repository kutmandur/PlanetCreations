"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    EventSubmissionError,
    getSubmissionLimit,
    validateAndNormalizeSubmission,
} = require("./eventSubmission");

const baseInput = () => ({
    acceptedRuleIds: ["rule-1"],
    blacklist: [],
    canParticipate: true,
    creation: {
        createdAt: 1500,
        game: "planet-coaster-2",
        userId: "user-1",
    },
    customFieldData: {story: "  Alpine adventure  "},
    event: {
        customFields: [{id: "story", label: "Story", required: true}],
        endDate: 3000,
        game: "planet-coaster-2",
        rules: [{id: "rule-1"}],
        startDate: 1000,
    },
    nowMs: 2000,
    uid: "user-1",
});

test("normalizes valid event submission fields", () => {
    assert.deepEqual(validateAndNormalizeSubmission(baseInput()), {
        story: "Alpine adventure",
    });
});

test("rejects submissions outside the active period", () => {
    const input = baseInput();
    input.nowMs = 4000;
    assert.throws(
        () => validateAndNormalizeSubmission(input),
        error => error instanceof EventSubmissionError &&
            error.code === "failed-precondition",
    );
});

test("rejects missing rules, forbidden words and ineligible creations", () => {
    const missingRule = baseInput();
    missingRule.acceptedRuleIds = [];
    assert.throws(() => validateAndNormalizeSubmission(missingRule));

    const forbidden = baseInput();
    forbidden.blacklist = ["adventure"];
    assert.throws(() => validateAndNormalizeSubmission(forbidden));

    const harmlessSubstring = baseInput();
    harmlessSubstring.customFieldData.story = "A classic wooden coaster";
    harmlessSubstring.blacklist = ["ass"];
    assert.doesNotThrow(() =>
        validateAndNormalizeSubmission(harmlessSubstring));

    const wrongOwner = baseInput();
    wrongOwner.creation.userId = "other-user";
    assert.throws(
        () => validateAndNormalizeSubmission(wrongOwner),
        error => error.code === "permission-denied",
    );
});

test("uses one submission by default and clamps configured limits", () => {
    assert.equal(getSubmissionLimit({allowMultipleSubmissions: false}), 1);
    assert.equal(getSubmissionLimit({
        allowMultipleSubmissions: true,
        submissionLimit: 5,
    }), 5);
    assert.equal(getSubmissionLimit({
        allowMultipleSubmissions: true,
        submissionLimit: 10000,
    }), 100);
});
