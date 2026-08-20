"use strict";

const crypto = require("crypto");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");

const INDEX_VERSION = 1;
const MAX_SHARD_BYTES = 700 * 1024;
const BATCH_SIZE = 400;

const INDEX_FAMILIES = Object.freeze({
    community: Object.freeze({
        locations: "communitySearchIndexLocations",
        shards: "communitySearchIndexShards",
        states: "communitySearchIndexState",
    }),
    search: Object.freeze({
        locations: "searchIndexLocations",
        shards: "searchIndexShards",
        states: "searchIndexState",
    }),
    showcase: Object.freeze({
        locations: "showcaseIndexLocations",
        shards: "showcaseIndexShards",
        states: "showcaseIndexState",
    }),
    user: Object.freeze({
        locations: "userSearchIndexLocations",
        shards: "userSearchIndexShards",
        states: "userSearchIndexState",
    }),
});

const requireSafeSegment = (value, label) => {
    const normalized = String(value || "");
    if (!normalized || Buffer.byteLength(normalized, "utf8") > 700 ||
        normalized.includes("/")) {
        throw new Error(`${label} must be a non-empty Firestore document ID segment.`);
    }
    return normalized;
};

const getFamily = (family) => {
    const configuration = INDEX_FAMILIES[family];
    if (!configuration) throw new Error(`Unknown scalable index family: ${family}`);
    return configuration;
};

const getShardNumber = (number) => String(number).padStart(6, "0");

const getShardId = (scopeId, generation, number) => (
    `${scopeId}--${generation}--${getShardNumber(number)}`
);

const getLocationId = (scopeId, entryId) => `${scopeId}--${entryId}`;

const firestoreStringBytes = (value) => Buffer.byteLength(String(value), "utf8") + 1;

const estimateFirestoreValueBytes = (value) => {
    if (value === null || value === undefined) return 1;
    if (typeof value === "string") return firestoreStringBytes(value);
    if (typeof value === "boolean") return 1;
    if (typeof value === "number") return 8;
    if (Buffer.isBuffer(value)) return value.length;
    if (typeof value?.toMillis === "function") return 8;
    if (Array.isArray(value)) {
        return value.reduce(
            (total, item) => total + estimateFirestoreValueBytes(item),
            0,
        );
    }
    if (typeof value === "object") {
        return 32 + Object.entries(value).reduce(
            (total, [key, child]) => total + firestoreStringBytes(key) +
                estimateFirestoreValueBytes(child),
            0,
        );
    }
    return 0;
};

const estimateShardBytes = (shardData) => (
    192 + Object.entries(shardData).reduce(
        (total, [key, value]) => total + firestoreStringBytes(key) +
            estimateFirestoreValueBytes(value),
        0,
    )
);

const createEmptyShard = ({generation, number, previousShardId, scopeId}) => ({
    b: 0,
    e: {},
    g: generation,
    i: scopeId,
    n: number,
    p: previousShardId || null,
    u: Timestamp.now(),
    v: INDEX_VERSION,
});

const buildShardWithEntry = (shardData, entryId, entry, mergeEntry = false) => {
    const entries = {...(shardData.e || {})};
    entries[entryId] = mergeEntry ? {
        ...(entries[entryId] || {}),
        ...entry,
    } : entry;
    const next = {
        ...shardData,
        b: 0,
        e: entries,
        u: Timestamp.now(),
        v: INDEX_VERSION,
    };
    next.b = estimateShardBytes(next);
    return next;
};

const buildMapIndexShards = ({
    entries,
    generation,
    maxShardBytes = MAX_SHARD_BYTES,
    scopeId,
}) => {
    const safeScopeId = requireSafeSegment(scopeId, "Index scope ID");
    const safeGeneration = requireSafeSegment(generation, "Index generation");
    const shards = [];
    let number = 1;
    let previousShardId = null;
    let shardId = getShardId(safeScopeId, safeGeneration, number);
    let shard = createEmptyShard({
        generation: safeGeneration,
        number,
        previousShardId,
        scopeId: safeScopeId,
    });

    for (const [entryId, entry] of Object.entries(entries || {})) {
        requireSafeSegment(entryId, "Index entry ID");
        const candidate = buildShardWithEntry(shard, entryId, entry);
        if (candidate.b > maxShardBytes && Object.keys(shard.e).length > 0) {
            shard.b = estimateShardBytes(shard);
            shards.push({id: shardId, data: shard});
            previousShardId = shardId;
            number += 1;
            shardId = getShardId(safeScopeId, safeGeneration, number);
            shard = buildShardWithEntry(createEmptyShard({
                generation: safeGeneration,
                number,
                previousShardId,
                scopeId: safeScopeId,
            }), entryId, entry);
        } else {
            shard = candidate;
        }
    }

    shard.b = estimateShardBytes(shard);
    shards.push({id: shardId, data: shard});
    return shards;
};

const commitOperations = async (db, operations) => {
    for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
        const batch = db.batch();
        operations.slice(offset, offset + BATCH_SIZE).forEach((operation) => {
            if (operation.type === "delete") batch.delete(operation.ref);
            else if (operation.options) {
                batch.set(operation.ref, operation.data, operation.options);
            } else {
                batch.set(operation.ref, operation.data);
            }
        });
        await batch.commit();
    }
};

const createGeneration = () => (
    `${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`
);

const upsertMapIndexEntry = async (
    db,
    family,
    scopeId,
    entryId,
    entry,
    {mergeEntry = false, metadata} = {},
) => {
    const configuration = getFamily(family);
    const safeScopeId = requireSafeSegment(scopeId, "Index scope ID");
    const safeEntryId = requireSafeSegment(entryId, "Index entry ID");
    const stateRef = db.doc(`${configuration.states}/${safeScopeId}`);
    const locationRef = db.doc(
        `${configuration.locations}/${getLocationId(safeScopeId, safeEntryId)}`,
    );
    const initialGeneration = createGeneration();

    return db.runTransaction(async (transaction) => {
        const locationSnap = await transaction.get(locationRef);
        let relocatedSource = null;
        if (locationSnap.exists) {
            const location = locationSnap.data();
            const shardRef = db.doc(`${configuration.shards}/${location.shardId}`);
            const shardSnap = await transaction.get(shardRef);
            if (shardSnap.exists) {
                const candidate = buildShardWithEntry(
                    shardSnap.data(),
                    safeEntryId,
                    entry,
                    mergeEntry,
                );
                if (candidate.b <= MAX_SHARD_BYTES ||
                    Object.keys(candidate.e || {}).length === 1) {
                    transaction.set(shardRef, candidate);
                    transaction.set(locationRef, {
                        entryId: safeEntryId,
                        scopeId: safeScopeId,
                        shardId: location.shardId,
                        updatedAt: Timestamp.now(),
                    });
                    if (metadata !== undefined) {
                        transaction.set(stateRef, {
                            m: metadata,
                            updatedAt: Timestamp.now(),
                        }, {merge: true});
                    }
                    return location.shardId;
                }
                relocatedSource = {
                    candidate,
                    data: shardSnap.data(),
                    id: location.shardId,
                    ref: shardRef,
                    snap: shardSnap,
                };
            }
        }

        const stateSnap = await transaction.get(stateRef);
        const state = stateSnap.exists ? stateSnap.data() : {};
        const generation = state.generation || initialGeneration;
        const activeNumber = Math.max(1, Number(state.headNumber) || 1);
        const activeShardId = state.headShardId ||
            getShardId(safeScopeId, generation, activeNumber);
        const activeShardRef = db.doc(`${configuration.shards}/${activeShardId}`);
        const activeShardSnap = relocatedSource?.id === activeShardId ?
            relocatedSource.snap : await transaction.get(activeShardRef);
        let activeShard = activeShardSnap.exists ? activeShardSnap.data() :
            createEmptyShard({
                generation,
                number: activeNumber,
                previousShardId: null,
                scopeId: safeScopeId,
            });
        const targetEntry = relocatedSource ?
            relocatedSource.candidate.e[safeEntryId] : entry;

        if (relocatedSource?.id === activeShardId) {
            const entriesWithoutTarget = {...(activeShard.e || {})};
            delete entriesWithoutTarget[safeEntryId];
            activeShard = {
                ...activeShard,
                b: 0,
                e: entriesWithoutTarget,
                u: Timestamp.now(),
            };
            activeShard.b = estimateShardBytes(activeShard);
        }

        const candidate = buildShardWithEntry(
            activeShard,
            safeEntryId,
            targetEntry,
        );
        const isNewEntry = !locationSnap.exists;
        let targetShardId = activeShardId;
        let headNumber = activeNumber;
        let shardIds = Array.isArray(state.shardIds) && state.shardIds.length > 0 ?
            [...state.shardIds] : [activeShardId];

        if (candidate.b > MAX_SHARD_BYTES && Object.keys(activeShard.e || {}).length > 0) {
            headNumber += 1;
            targetShardId = getShardId(safeScopeId, generation, headNumber);
            const nextShardRef = db.doc(`${configuration.shards}/${targetShardId}`);
            transaction.create(nextShardRef, buildShardWithEntry(createEmptyShard({
                generation,
                number: headNumber,
                previousShardId: activeShardId,
                scopeId: safeScopeId,
            }), safeEntryId, entry));
            shardIds.push(targetShardId);
        } else {
            transaction.set(activeShardRef, candidate);
        }

        if (relocatedSource && relocatedSource.id !== targetShardId) {
            const sourceEntries = {...(relocatedSource.data.e || {})};
            delete sourceEntries[safeEntryId];
            const sourceShard = {
                ...relocatedSource.data,
                b: 0,
                e: sourceEntries,
                u: Timestamp.now(),
            };
            sourceShard.b = estimateShardBytes(sourceShard);
            transaction.set(relocatedSource.ref, sourceShard);
        }

        transaction.set(stateRef, {
            count: Math.max(0, Number(state.count) || 0) + (isNewEntry ? 1 : 0),
            generation,
            headNumber,
            headShardId: targetShardId,
            ...(metadata !== undefined ? {m: metadata} : {}),
            shardIds,
            updatedAt: Timestamp.now(),
            version: INDEX_VERSION,
        }, {merge: true});
        transaction.set(locationRef, {
            entryId: safeEntryId,
            scopeId: safeScopeId,
            shardId: targetShardId,
            updatedAt: Timestamp.now(),
        });
        return targetShardId;
    });
};

const removeMapIndexEntry = async (db, family, scopeId, entryId) => {
    const configuration = getFamily(family);
    const safeScopeId = requireSafeSegment(scopeId, "Index scope ID");
    const safeEntryId = requireSafeSegment(entryId, "Index entry ID");
    const stateRef = db.doc(`${configuration.states}/${safeScopeId}`);
    const locationRef = db.doc(
        `${configuration.locations}/${getLocationId(safeScopeId, safeEntryId)}`,
    );

    return db.runTransaction(async (transaction) => {
        const locationSnap = await transaction.get(locationRef);
        if (!locationSnap.exists) return false;
        const shardRef = db.doc(
            `${configuration.shards}/${locationSnap.data().shardId}`,
        );
        const shardSnap = await transaction.get(shardRef);
        if (shardSnap.exists) {
            const shard = shardSnap.data();
            const entries = {...(shard.e || {})};
            delete entries[safeEntryId];
            const nextShard = {
                ...shard,
                b: 0,
                e: entries,
                u: Timestamp.now(),
            };
            nextShard.b = estimateShardBytes(nextShard);
            transaction.set(shardRef, nextShard);
        }
        transaction.delete(locationRef);
        transaction.set(stateRef, {
            count: FieldValue.increment(-1),
            updatedAt: Timestamp.now(),
        }, {merge: true});
        return true;
    });
};

const readMapIndex = async (db, family, scopeId) => {
    const configuration = getFamily(family);
    const safeScopeId = requireSafeSegment(scopeId, "Index scope ID");
    const stateSnap = await db.doc(`${configuration.states}/${safeScopeId}`).get();
    if (!stateSnap.exists) return null;
    const state = stateSnap.data();
    const shardIds = Array.isArray(state.shardIds) ? state.shardIds : [];
    const shardSnaps = shardIds.length > 0 ? await db.getAll(
        ...shardIds.map((shardId) => db.doc(`${configuration.shards}/${shardId}`)),
    ) : [];
    const entries = {};
    shardSnaps.forEach((shardSnap) => {
        if (shardSnap.exists) Object.assign(entries, shardSnap.data().e || {});
    });
    return {entries, state};
};

const replaceMapIndex = async (
    db,
    family,
    scopeId,
    entries,
    {metadata} = {},
) => {
    const configuration = getFamily(family);
    const safeScopeId = requireSafeSegment(scopeId, "Index scope ID");
    const stateRef = db.doc(`${configuration.states}/${safeScopeId}`);
    const [previousStateSnap, previousLocationsSnap] = await Promise.all([
        stateRef.get(),
        db.collection(configuration.locations)
            .where("scopeId", "==", safeScopeId)
            .get(),
    ]);
    const generation = createGeneration();
    const shards = buildMapIndexShards({
        entries,
        generation,
        scopeId: safeScopeId,
    });
    const operations = [];
    const nextEntryIds = new Set(Object.keys(entries || {}));

    shards.forEach((shard) => {
        operations.push({
            data: shard.data,
            ref: db.doc(`${configuration.shards}/${shard.id}`),
            type: "set",
        });
        Object.keys(shard.data.e || {}).forEach((entryId) => operations.push({
            data: {
                entryId,
                scopeId: safeScopeId,
                shardId: shard.id,
                updatedAt: Timestamp.now(),
            },
            ref: db.doc(
                `${configuration.locations}/${getLocationId(safeScopeId, entryId)}`,
            ),
            type: "set",
        }));
    });
    previousLocationsSnap.docs.forEach((locationDoc) => {
        if (!nextEntryIds.has(locationDoc.data().entryId)) {
            operations.push({ref: locationDoc.ref, type: "delete"});
        }
    });
    await commitOperations(db, operations);

    await stateRef.set({
        count: nextEntryIds.size,
        generation,
        headNumber: shards.length,
        headShardId: shards.at(-1).id,
        ...(metadata !== undefined ? {m: metadata} : {}),
        shardIds: shards.map((shard) => shard.id),
        updatedAt: Timestamp.now(),
        version: INDEX_VERSION,
    });

    const previousShardIds = previousStateSnap.exists &&
        Array.isArray(previousStateSnap.data().shardIds) ?
        previousStateSnap.data().shardIds : [];
    await commitOperations(db, previousShardIds.map((shardId) => ({
        ref: db.doc(`${configuration.shards}/${shardId}`),
        type: "delete",
    })));
    return {count: nextEntryIds.size, shards: shards.length};
};

const deleteMapIndex = async (db, family, scopeId) => {
    const configuration = getFamily(family);
    const safeScopeId = requireSafeSegment(scopeId, "Index scope ID");
    const stateRef = db.doc(`${configuration.states}/${safeScopeId}`);
    const [stateSnap, locationsSnap] = await Promise.all([
        stateRef.get(),
        db.collection(configuration.locations)
            .where("scopeId", "==", safeScopeId)
            .get(),
    ]);
    const shardIds = stateSnap.exists && Array.isArray(stateSnap.data().shardIds) ?
        stateSnap.data().shardIds : [];
    const operations = [
        ...shardIds.map((shardId) => ({
            ref: db.doc(`${configuration.shards}/${shardId}`),
            type: "delete",
        })),
        ...locationsSnap.docs.map((locationDoc) => ({
            ref: locationDoc.ref,
            type: "delete",
        })),
        {ref: stateRef, type: "delete"},
    ];
    await commitOperations(db, operations);
};

module.exports = {
    INDEX_FAMILIES,
    INDEX_VERSION,
    MAX_SHARD_BYTES,
    buildMapIndexShards,
    buildShardWithEntry,
    deleteMapIndex,
    estimateShardBytes,
    getLocationId,
    getShardId,
    readMapIndex,
    removeMapIndexEntry,
    replaceMapIndex,
    upsertMapIndexEntry,
};
