"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {getMatchDecision, normalizeText} = require("./liveStreamMatcher");

const creations = [
    {
        id: "park",
        userId: "owner",
        game: "planet-coaster-2",
        title: "Steampunkia",
        category: "Park",
        tags: ["steampunk"],
        description: "A large themed resort.",
    },
    {
        id: "ride",
        userId: "owner",
        game: "planet-coaster-2",
        title: "Copper Spinner",
        category: "Flatride",
        tags: ["steampunk"],
        description: "A compact flatride.",
    },
];

test("normalizes accents and punctuation", () => {
    assert.equal(normalizeText("Grüße — Park!"), "grusse park");
});

test("creation names outrank a matching creation type", () => {
    const decision = getMatchDecision({
        title: "Ich arbeite an meinem Flatride in Steampunkia",
    }, creations);
    assert.equal(decision.best.creationId, "park");
    assert.equal(decision.confident, true);
});

test("creation game is filtered before matching by the caller", () => {
    const decision = getMatchDecision({title: "Building my zoo"}, [
        ...creations,
        {id: "collab", title: "My Zoo", category: "Zoo", sourceCollaborationId: "c-1"},
    ]);
    assert.notEqual(decision.best?.creationId, "collab");
});

test("ambiguous generic titles do not auto-select", () => {
    const decision = getMatchDecision({title: "Building steampunk"}, creations);
    assert.equal(decision.confident, false);
});
