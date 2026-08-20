"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    deleteApp,
    initializeApp,
} = require("../functions/node_modules/firebase-admin/lib/app");
const {
    getFirestore,
} = require("../functions/node_modules/firebase-admin/lib/firestore");
const {
    deleteMapIndex,
    readMapIndex,
    removeMapIndexEntry,
    replaceMapIndex,
    upsertMapIndexEntry,
} = require("../functions/scalableMapIndex");

const app = initializeApp({
    projectId: "demo-planetcreations-rules",
}, "scalable-map-index-emulator-tests");
const db = getFirestore(app);

test.after(async () => {
    await deleteApp(app);
});

test("scalable index rebuild, merge update and removal work against Firestore", async () => {
    const scopeId = "emulator-community";
    await deleteMapIndex(db, "community", scopeId);

    const rebuilt = await replaceMapIndex(db, "community", scopeId, {
        first: {pin: true, t: "First"},
        second: {pin: false, t: "Second"},
    });
    assert.equal(rebuilt.count, 2);
    assert.equal(rebuilt.shards, 1);
    assert.deepEqual((await readMapIndex(db, "community", scopeId)).entries, {
        first: {pin: true, t: "First"},
        second: {pin: false, t: "Second"},
    });

    await upsertMapIndexEntry(
        db,
        "community",
        scopeId,
        "first",
        {t: "Updated"},
        {mergeEntry: true},
    );
    assert.deepEqual((await readMapIndex(db, "community", scopeId)).entries, {
        first: {pin: true, t: "Updated"},
        second: {pin: false, t: "Second"},
    });
    await removeMapIndexEntry(db, "community", scopeId, "second");

    const index = await readMapIndex(db, "community", scopeId);
    assert.deepEqual(index.entries, {
        first: {pin: true, t: "Updated"},
    });
    assert.equal(index.state.count, 1);
    await deleteMapIndex(db, "community", scopeId);
});

test("incremental writes roll over before a shard approaches one MiB", async () => {
    const scopeId = "emulator-large-game";
    await deleteMapIndex(db, "search", scopeId);
    await upsertMapIndexEntry(db, "search", scopeId, "large-a", {
        d: "a".repeat(390 * 1024),
    });
    await upsertMapIndexEntry(db, "search", scopeId, "large-b", {
        d: "b".repeat(390 * 1024),
    });

    const index = await readMapIndex(db, "search", scopeId);
    assert.equal(index.state.shardIds.length, 2);
    assert.deepEqual(Object.keys(index.entries).sort(), ["large-a", "large-b"]);
    await deleteMapIndex(db, "search", scopeId);
});
