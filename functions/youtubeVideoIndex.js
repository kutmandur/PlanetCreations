"use strict";

const {Timestamp} = require("firebase-admin/firestore");

const INDEX_STATE_PATH = "youtubeVideoIndexState/current";
const INDEX_SHARDS_COLLECTION = "youtubeVideoIndexShards";
const VIDEO_LOCATIONS_COLLECTION = "youtubeVideoLocations";
const INDEX_VERSION = 1;
const MAX_SHARD_BYTES = 700 * 1024;

const getShardId = (number) => String(number).padStart(6, "0");

const parseRelativePublishedMs = (value, nowMs = Date.now()) => {
    const match = String(value || "").toLowerCase().match(
        /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/,
    );
    if (!match) return null;
    const amount = Number(match[1]);
    const unitMs = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000,
    }[match[2]];
    return nowMs - (amount * unitMs);
};

const normalizeYoutubeVideos = (videos, nowMs = Date.now()) => (
    (Array.isArray(videos) ? videos : []).flatMap((video, index) => {
        const id = String(video?.id || "");
        if (!/^[\w-]{11}$/.test(id)) return [];
        const parsedPublished = Date.parse(video.published || "");
        const relativePublished = parseRelativePublishedMs(
            video.publishedText,
            nowMs,
        );
        const publishedMs = Number.isFinite(parsedPublished) ?
            parsedPublished : (relativePublished || nowMs) - index;
        return [{
            id,
            publishedMs,
            title: String(video.title || "Untitled video").slice(0, 300),
        }];
    })
);

const encodeYoutubeVideo = (video) => (
    `${Math.max(0, Math.trunc(Number(video.publishedMs) || 0))}|${video.title}`
);

const decodeYoutubeVideo = (id, encoded) => {
    const separatorIndex = String(encoded).indexOf("|");
    if (separatorIndex < 0) return null;
    const publishedMs = Number(String(encoded).slice(0, separatorIndex));
    return {
        id,
        publishedMs: Number.isFinite(publishedMs) ? publishedMs : 0,
        title: String(encoded).slice(separatorIndex + 1),
    };
};

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
    128 + 32 + Object.entries(shardData).reduce(
        (total, [key, value]) => total + firestoreStringBytes(key) +
            estimateFirestoreValueBytes(value),
        0,
    )
);

const hasVideos = (shardData) => Object.values(shardData.c || {})
    .some((communityVideos) => Object.keys(communityVideos || {}).length > 0);

const buildShardWithVideo = (shardData, communityId, video) => {
    const communities = {...(shardData.c || {})};
    communities[communityId] = {
        ...(communities[communityId] || {}),
        [video.id]: encodeYoutubeVideo(video),
    };
    const next = {
        ...shardData,
        b: 0,
        c: communities,
        u: Timestamp.now(),
        v: INDEX_VERSION,
    };
    next.b = estimateShardBytes(next);
    return next;
};

const createEmptyShard = (number, previousShardId = null) => ({
    b: 0,
    c: {},
    n: number,
    p: previousShardId,
    u: Timestamp.now(),
    v: INDEX_VERSION,
});

const getLocationId = (communityId, videoId) => `${communityId}_${videoId}`;

const upsertCommunityYoutubeVideo = async (
    db,
    communityId,
    channelId,
    video,
) => {
    if (!communityId || !channelId || !video?.id) {
        throw new Error("Community, channel and video IDs are required.");
    }
    const stateRef = db.doc(INDEX_STATE_PATH);
    const locationRef = db.doc(
        `${VIDEO_LOCATIONS_COLLECTION}/${getLocationId(communityId, video.id)}`,
    );

    return db.runTransaction(async (transaction) => {
        const locationSnap = await transaction.get(locationRef);
        if (locationSnap.exists) {
            const location = locationSnap.data();
            const shardRef = db.doc(
                `${INDEX_SHARDS_COLLECTION}/${location.shardId}`,
            );
            const shardSnap = await transaction.get(shardRef);
            if (shardSnap.exists) {
                const nextShard = buildShardWithVideo(
                    shardSnap.data(),
                    communityId,
                    video,
                );
                transaction.set(shardRef, nextShard);
                transaction.set(locationRef, {
                    channelId,
                    communityId,
                    shardId: location.shardId,
                    updatedAt: Timestamp.now(),
                });
                return location.shardId;
            }
        }

        const stateSnap = await transaction.get(stateRef);
        const state = stateSnap.exists ? stateSnap.data() : {};
        const activeNumber = Math.max(1, Number(state.headNumber) || 1);
        const activeShardId = state.headShardId || getShardId(activeNumber);
        const activeShardRef = db.doc(
            `${INDEX_SHARDS_COLLECTION}/${activeShardId}`,
        );
        const activeShardSnap = await transaction.get(activeShardRef);
        const activeShard = activeShardSnap.exists ? activeShardSnap.data() :
            createEmptyShard(activeNumber, null);
        const candidate = buildShardWithVideo(
            activeShard,
            communityId,
            video,
        );

        let targetShardId = activeShardId;
        if (candidate.b > MAX_SHARD_BYTES && hasVideos(activeShard)) {
            const nextNumber = activeNumber + 1;
            targetShardId = getShardId(nextNumber);
            const nextShardRef = db.doc(
                `${INDEX_SHARDS_COLLECTION}/${targetShardId}`,
            );
            const nextShard = buildShardWithVideo(
                createEmptyShard(nextNumber, activeShardId),
                communityId,
                video,
            );
            transaction.create(nextShardRef, nextShard);
            transaction.set(stateRef, {
                headNumber: nextNumber,
                headShardId: targetShardId,
                updatedAt: Timestamp.now(),
                version: INDEX_VERSION,
            });
        } else {
            transaction.set(activeShardRef, candidate);
            if (!stateSnap.exists) {
                transaction.set(stateRef, {
                    headNumber: activeNumber,
                    headShardId: activeShardId,
                    updatedAt: Timestamp.now(),
                    version: INDEX_VERSION,
                });
            }
        }

        transaction.set(locationRef, {
            channelId,
            communityId,
            shardId: targetShardId,
            updatedAt: Timestamp.now(),
        });
        return targetShardId;
    });
};

const backfillCommunityYoutubeVideos = async (
    db,
    communityId,
    channelId,
    videos,
) => {
    const normalizedVideos = normalizeYoutubeVideos(videos);
    for (const video of normalizedVideos) {
        await upsertCommunityYoutubeVideo(db, communityId, channelId, video);
    }
    return normalizedVideos.length;
};

const commitInChunks = async (db, operations) => {
    for (let offset = 0; offset < operations.length; offset += 400) {
        const batch = db.batch();
        operations.slice(offset, offset + 400).forEach((operation) => {
            if (operation.type === "delete") batch.delete(operation.ref);
            else batch.set(operation.ref, operation.data);
        });
        await batch.commit();
    }
};

const removeCommunityYoutubeVideos = async (db, communityId) => {
    const [shardsSnap, locationsSnap] = await Promise.all([
        db.collection(INDEX_SHARDS_COLLECTION).get(),
        db.collection(VIDEO_LOCATIONS_COLLECTION)
            .where("communityId", "==", communityId)
            .get(),
    ]);
    const operations = [];
    for (const shardDoc of shardsSnap.docs) {
        const shardData = shardDoc.data();
        if (!shardData.c?.[communityId]) continue;
        const communities = {...shardData.c};
        delete communities[communityId];
        const nextShard = {
            ...shardData,
            b: 0,
            c: communities,
            u: Timestamp.now(),
        };
        nextShard.b = estimateShardBytes(nextShard);
        operations.push({
            type: "set",
            ref: shardDoc.ref,
            data: nextShard,
        });
    }
    locationsSnap.docs.forEach((locationDoc) => operations.push({
        type: "delete",
        ref: locationDoc.ref,
    }));
    await commitInChunks(db, operations);
    return {
        locationsDeleted: locationsSnap.size,
        shardsUpdated: operations.length - locationsSnap.size,
    };
};

module.exports = {
    INDEX_SHARDS_COLLECTION,
    INDEX_STATE_PATH,
    INDEX_VERSION,
    MAX_SHARD_BYTES,
    backfillCommunityYoutubeVideos,
    buildShardWithVideo,
    decodeYoutubeVideo,
    encodeYoutubeVideo,
    estimateShardBytes,
    getShardId,
    normalizeYoutubeVideos,
    parseRelativePublishedMs,
    removeCommunityYoutubeVideos,
    upsertCommunityYoutubeVideo,
};
