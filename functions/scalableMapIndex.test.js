"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    MAX_SHARD_BYTES,
    buildMapIndexShards,
    buildShardWithEntry,
    getLocationId,
    upsertMapIndexEntry,
} = require("./scalableMapIndex");

const createFakeFirestore = (initialDocuments) => {
    const documents = new Map(Object.entries(initialDocuments));
    const ref = (documentPath) => ({path: documentPath});
    const snap = (documentPath) => ({
        data: () => documents.get(documentPath),
        exists: documents.has(documentPath),
    });
    return {
        documents,
        doc: ref,
        runTransaction: async (callback) => callback({
            create: (documentRef, data) => {
                assert.equal(documents.has(documentRef.path), false);
                documents.set(documentRef.path, data);
            },
            get: async (documentRef) => snap(documentRef.path),
            set: (documentRef, data, options) => {
                documents.set(documentRef.path, options?.merge ? {
                    ...(documents.get(documentRef.path) || {}),
                    ...data,
                } : data);
            },
        }),
    };
};

test("splits compact map entries into backward-linked size-bounded shards", () => {
    const entries = Object.fromEntries(Array.from({length: 12}, (_, index) => [
        `creation-${index}`,
        {d: "x".repeat(120), t: `Creation ${index}`},
    ]));
    const shards = buildMapIndexShards({
        entries,
        generation: "generation-a",
        maxShardBytes: 900,
        scopeId: "planet-coaster-2",
    });

    assert.ok(shards.length > 1);
    assert.equal(shards[0].data.p, null);
    for (let index = 1; index < shards.length; index += 1) {
        assert.equal(shards[index].data.p, shards[index - 1].id);
    }
    assert.deepEqual(
        new Set(shards.flatMap((shard) => Object.keys(shard.data.e))),
        new Set(Object.keys(entries)),
    );
    assert.ok(shards.every((shard) => shard.data.b <= 900));
});

test("merges partial entry updates without losing index-specific fields", () => {
    const shard = buildMapIndexShards({
        entries: {creation: {pin: true, t: "Old title"}},
        generation: "generation-b",
        scopeId: "community-id",
    })[0].data;
    const updated = buildShardWithEntry(
        shard,
        "creation",
        {t: "New title"},
        true,
    );

    assert.deepEqual(updated.e.creation, {pin: true, t: "New title"});
    assert.ok(updated.b < MAX_SHARD_BYTES);
});

test("uses scope-qualified location IDs", () => {
    assert.equal(
        getLocationId("planet-coaster-2", "creation-id"),
        "planet-coaster-2--creation-id",
    );
});

test("relocates a growing existing entry instead of overflowing its shard", async () => {
    const scopeId = "planet-coaster-2";
    const generation = "generation-c";
    const firstShard = buildMapIndexShards({
        entries: {
            growing: {d: "a".repeat(300 * 1024)},
            stable: {d: "b".repeat(300 * 1024)},
        },
        generation,
        scopeId,
    })[0];
    const statePath = `searchIndexState/${scopeId}`;
    const locationPath = `searchIndexLocations/${scopeId}--growing`;
    const shardPath = `searchIndexShards/${firstShard.id}`;
    const db = createFakeFirestore({
        [locationPath]: {
            entryId: "growing",
            scopeId,
            shardId: firstShard.id,
        },
        [shardPath]: firstShard.data,
        [statePath]: {
            count: 2,
            generation,
            headNumber: 1,
            headShardId: firstShard.id,
            shardIds: [firstShard.id],
        },
    });

    const targetShardId = await upsertMapIndexEntry(
        db,
        "search",
        scopeId,
        "growing",
        {d: "c".repeat(500 * 1024)},
    );

    assert.notEqual(targetShardId, firstShard.id);
    assert.deepEqual(
        Object.keys(db.documents.get(shardPath).e),
        ["stable"],
    );
    assert.deepEqual(
        Object.keys(db.documents.get(`searchIndexShards/${targetShardId}`).e),
        ["growing"],
    );
    assert.equal(db.documents.get(locationPath).shardId, targetShardId);
    assert.equal(db.documents.get(statePath).count, 2);
    assert.equal(db.documents.get(statePath).shardIds.length, 2);
});
