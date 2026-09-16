"use strict";
const {voteShard, VOTE_SHARDS, safeId} = require("./eventVoting");
// Requires the closed v2 vote rules during apply. Dry-run never changes live data.
async function migrateEventVotes(db, eventId, {apply = false} = {}) {
    const ref = db.doc(`events/${eventId}`);
    const event = await ref.get();
    if (!event.exists) throw new Error("Event not found.");
    const legacy = await db.collectionGroup("votes").where("eventId", "==", eventId).get();
    const ballots = new Map();
    const issues = [];
    for (const vote of legacy.docs) {
        if (vote.data().type !== "event_vote") continue;
        const parts = vote.ref.path.split("/");
        const uid = vote.data().userId;
        if (parts.length !== 4 || parts[0] !== "creations" || uid !== parts[3] || !safeId(parts[1]) || !uid) {
            issues.push({path: vote.ref.path, reason: "Unverifiable author/path"}); continue;
        }
        const ids = ballots.get(uid) || new Set(); ids.add(parts[1]); ballots.set(uid, ids);
    }
    const report = {eventId, schema: event.data().voteSchemaVersion || 1, ballots: ballots.size,
        votes: [...ballots.values()].reduce((sum, ids) => sum + ids.size, 0), issues, applied: false};
    // Historical limits/permissions may have changed; flag, never silently discard votes.
    const limit = event.data().voteType === "multiple" ? Number(event.data().voteLimit) || 1 : 1;
    for (const [uid, ids] of ballots) if (ids.size > limit) issues.push({uid, reason: "Historical ballot exceeds current limit"});
    if (!apply || issues.length) return report;
    if (event.data().voteSchemaVersion !== 2) {
        await ref.update({voteSchemaVersion: 1.5}); // Resumable migration lock; readers retain old totals.
        const writer = db.bulkWriter();
        const counts = Array.from({length: VOTE_SHARDS}, () => ({}));
        for (const [uid, ids] of ballots) {
            writer.set(ref.collection("ballots").doc(uid), {userId: uid, eventId, creationIds: [...ids], revision: 0});
            for (const id of ids) counts[Number(voteShard(id))][id] = (counts[Number(voteShard(id))][id] || 0) + 1;
        }
        for (let i = 0; i < counts.length; i++) {
            if (Buffer.byteLength(JSON.stringify(counts[i])) > 700 * 1024) throw new Error("Vote totals exceed shard size; migration remains locked.");
            writer.set(ref.collection("voteTotals").doc(String(i)), {counts: counts[i]});
        }
        await writer.close();
        const migrated = await ref.collection("ballots").get();
        const sum = migrated.docs.reduce((total, ballot) => total + ballot.data().creationIds.length, 0);
        if (sum !== report.votes || migrated.size !== ballots.size) throw new Error("Ballot verification failed; migration remains locked.");
        await ref.update({voteSchemaVersion: 2, voteMigration: {sourceVotes: report.votes, ballotCount: report.ballots, completedAt: new Date()}});
    }
    // The old shared slot is released only after its ballot was durably transferred.
    for (const vote of legacy.docs) {
        if (vote.data().type !== "event_vote") continue;
        const ballot = await ref.collection("ballots").doc(vote.data().userId).get();
        if (ballot.data()?.creationIds?.includes(vote.ref.path.split("/")[1])) await db.runTransaction(async tx => {
            const current = await tx.get(vote.ref);
            if (current.data()?.type === "event_vote" && current.data()?.eventId === eventId) tx.delete(vote.ref);
        });
    }
    return {...report, applied: true};
}
async function removeBallot(db, ballotRef, {creationId = null} = {}) {
    await db.runTransaction(async tx => {
        const ballot = await tx.get(ballotRef);
        if (!ballot.exists) return;
        const eventRef = ballotRef.parent.parent;
        const event = await tx.get(eventRef);
        const ids = ballot.data().creationIds || [];
        const removed = creationId ? ids.filter(id => id === creationId) : ids;
        const end = event.data()?.voteEndDate || event.data()?.endDate;
        const active = event.exists && (end?.toMillis?.() || 0) > Date.now();
        const shards = active ? [...new Set(removed.map(voteShard))] : [];
        const totals = await Promise.all(shards.map(shard => tx.get(eventRef.collection("voteTotals").doc(shard))));
        totals.forEach((total, index) => {
            const counts = {...(total.data()?.counts || {})};
            for (const id of removed.filter(id => voteShard(id) === shards[index])) counts[id] = Math.max(0, (counts[id] || 0) - 1);
            tx.set(total.ref, {counts});
        });
        if (creationId) tx.update(ballotRef, {creationIds: ids.filter(id => id !== creationId), revision: (ballot.data().revision || 0) + 1});
        else tx.delete(ballotRef);
    });
}
module.exports = {migrateEventVotes, removeBallot};
