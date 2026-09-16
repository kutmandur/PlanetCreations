"use strict";
const {getEffectiveCommunityPermissionKeys} = require("./communityMembership");
const VOTE_SHARDS = 4;
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value));
function voteShard(id) {
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return String((hash >>> 0) % VOTE_SHARDS);
}
function votingError(code, message) { return Object.assign(new Error(message), {code}); }
async function setEventVote(db, uid, input, role = "user", now = Date.now()) {
    const {eventId, creationId, selected, revision} = input || {};
    if (!safeId(eventId) || !safeId(creationId) || typeof selected !== "boolean" || !Number.isSafeInteger(revision) || revision < 0) {
        throw votingError("invalid-argument", "A valid event, creation, selection and ballot revision are required.");
    }
    const eventRef = db.doc(`events/${eventId}`);
    const ballotRef = eventRef.collection("ballots").doc(uid);
    return db.runTransaction(async tx => {
        const [eventSnap, ballotSnap, creationSnap] = await Promise.all([
            tx.get(eventRef), tx.get(ballotRef), tx.get(db.doc(`creations/${creationId}`)),
        ]);
        if (!eventSnap.exists) throw votingError("not-found", "Event not found.");
        const event = eventSnap.data();
        if (event.voteSchemaVersion !== 2) throw votingError("failed-precondition", "Voting is being upgraded for this event. Please try again shortly.");
        if (!safeId(event.communityId)) throw votingError("failed-precondition", "Event community is missing.");
        const [community, member] = await Promise.all([
            tx.get(db.doc(`communitys/${event.communityId}`)), tx.get(db.doc(`communitys/${event.communityId}/members/${uid}`)),
        ]);
        const canVote = community.exists && (['admin', 'moderator'].includes(role) || community.data().ownerId === uid ||
            (member.exists && getEffectiveCommunityPermissionKeys(community.data(), member.data()).includes("participateEvents")));
        if (!canVote) throw votingError("permission-denied", "Your community rank cannot participate in this event.");
        const start = millis(event.voteStartDate || event.startDate);
        const end = millis(event.voteEndDate || event.endDate);
        if (event.votingEnabled === false || !Number.isFinite(start) || !Number.isFinite(end) || now < start || now > end) {
            throw votingError("failed-precondition", "Voting is not open.");
        }
        const ballot = ballotSnap.data() || {creationIds: [], revision: 0};
        const ids = Array.isArray(ballot.creationIds) ? ballot.creationIds : [];
        if (ids.includes(creationId) === selected) return {creationIds: ids, revision: ballot.revision};
        if (revision !== ballot.revision) throw votingError("aborted", "Your ballot changed in another window. Please try again.");
        if (selected && (!creationSnap.exists || !(creationSnap.data().eventIds || []).includes(eventId))) {
            throw votingError("failed-precondition", "This creation is not participating in this event.");
        }
        const limit = event.voteType === "multiple" ? Math.max(1, Math.floor(Number(event.voteLimit) || 1)) : 1;
        const next = selected ? [...ids, creationId] : ids.filter(id => id !== creationId);
        if (Buffer.byteLength(JSON.stringify(next)) > 700 * 1024) throw votingError("resource-exhausted", "This ballot reached the document size limit.");
        if (next.length > limit) throw votingError("failed-precondition", "You have reached this event's vote limit.");
        const tallyRef = eventRef.collection("voteTotals").doc(voteShard(creationId));
        const tallySnap = await tx.get(tallyRef);
        const counts = {...(tallySnap.data()?.counts || {})};
        counts[creationId] = Math.max(0, (counts[creationId] || 0) + (selected ? 1 : -1));
        if (Buffer.byteLength(JSON.stringify(counts)) > 700 * 1024) throw votingError("resource-exhausted", "Event totals need maintenance.");
        const result = {creationIds: next, revision: ballot.revision + 1};
        tx.set(ballotRef, {...result, userId: uid, eventId, updatedAt: new Date(now)});
        tx.set(tallyRef, {counts, updatedAt: new Date(now)});
        return result;
    });
}
module.exports = {setEventVote, voteShard, VOTE_SHARDS, safeId};
