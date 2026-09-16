"use strict";
const {createHash} = require("node:crypto");
const {FieldValue} = require("firebase-admin/firestore");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function embedState(creation) {
    if (!creation) return null;
    return Object.fromEntries(["title", "description", "username", "userProfilePictureUrl", "createdAt", "imageUrls", "likes", "dislikes", "eventIds"].map(key => [key, creation[key] ?? null]));
}
function linkState(link) {
    if (!link) return null;
    return {showcaseVideoUrl: link.showcaseVideoUrl || null};
}
// Read the authoritative state inside the transaction, never a possibly reordered trigger payload.
async function enqueueDelivery(db, {communityId, creationId, eventId = null, kind = "general", legacy = null}) {
    const id = digest([communityId, creationId, eventId, kind]);
    const ref = db.doc(`discordDeliveries/${id}`);
    return db.runTransaction(async tx => {
        const refs = [ref, db.doc(`communitys/${communityId}`), db.doc(`creations/${creationId}`), db.doc(`communitys/${communityId}/creations/${creationId}`)];
        if (eventId) refs.push(db.doc(`events/${eventId}`));
        const [job, community, creation, link, event] = await Promise.all(refs.map(r => tx.get(r)));
        const c = community.data() || {};
        const e = event?.data() || {};
        const l = link.data() || {};
        const legacyMessage = kind === "event" ? e.autoPostedSubmissions?.[creationId] : kind === "showcase" ? l.discordShowcaseMessageId : l.discordMessageId;
        const legacyChannel = kind === "event" ? e.discordSubmissionChannelId : kind === "showcase" ? l.discordShowcaseChannelId : l.discordChannelId;
        const candidate = legacy || (legacyMessage && legacyChannel ? {messageId: legacyMessage, channelId: legacyChannel} : null);
        const adoptCandidate = candidate && !job.data()?.binding && !job.data()?.legacy && !job.data()?.sendingSince;
        const channelId = kind === "event" ? e.discordSubmissionChannelId : kind === "showcase" ? c.discordShowcaseChannelId : c.discordGeneralChannelId;
        const present = !!(community.exists && creation.exists && channelId && c.discordServerId &&
            (kind === "event" ? event?.exists && e.communityId === communityId && (creation.data().eventIds || []).includes(eventId) :
                link.exists && (kind === "showcase" ? l.showcaseVideoUrl : !(creation.data().eventIds || []).length)));
        const state = {present, channelId: channelId || null, guildId: c.discordServerId || null, ownerId: c.ownerId || null,
            creation: present ? embedState(creation.data()) : null, color: c.themeColor || null,
            video: kind === "showcase" ? l.showcaseVideoUrl || null : null, eventTitle: kind === "event" ? e.title || "" : null};
        const hash = digest(state);
        if (job.data()?.hash === hash && !adoptCandidate) return;
        if (!job.exists && !present && !candidate) return;
        tx.set(ref, {communityId, creationId, eventId, kind, hash, present, pending: true,
            revision: (job.data()?.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp(),
            // Legacy IDs are candidates only. The bot must prove authorship, guild and Creation URL.
            ...(adoptCandidate ? {legacy: candidate} : {}),
        }, {merge: true});
    });
}
async function enqueueCreationDeliveries(db, creationId, before, after) {
    if (digest(embedState(before)) === digest(embedState(after))) return;
    const queued = new Set();
    const once = async target => {
        const key = digest([target.communityId, target.creationId, target.eventId || null, target.kind || 'general']);
        if (queued.has(key)) return;
        queued.add(key); await enqueueDelivery(db, target);
    };
    const links = await db.collectionGroup("creations").where("creationId", "==", creationId).get();
    for (const link of links.docs) {
        const parts = link.ref.path.split("/");
        if (parts.length !== 4 || parts[0] !== "communitys") continue;
        for (const kind of ["general", ...(link.data().showcaseVideoUrl ? ["showcase"] : [])]) await once({communityId: parts[1], creationId, kind});
    }
    // Existing mappings survive deleted links and therefore keep deletion work recoverable.
    const jobs = await db.collection("discordDeliveries").where("creationId", "==", creationId).get();
    for (const job of jobs.docs) await once(job.data());
    for (const eventId of new Set([...(before?.eventIds || []), ...(after?.eventIds || [])])) {
        const event = await db.doc(`events/${eventId}`).get();
        if (event.data()?.communityId) await once({communityId: event.data().communityId, creationId, eventId, kind: "event",
            legacy: event.data().autoPostedSubmissions?.[creationId] ? {messageId: event.data().autoPostedSubmissions[creationId], channelId: event.data().discordSubmissionChannelId} : null});
    }
}
module.exports = {enqueueDelivery, enqueueCreationDeliveries, embedState, linkState, digest};
