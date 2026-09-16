"use strict";
const {safeId} = require("./eventVoting");
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
async function setCreationReaction(db, uid, input) {
    const {creationId, voteType, selected, revision} = input || {};
    const explicit = typeof selected === "boolean";
    if (!safeId(creationId) || !["like", "dislike"].includes(voteType) ||
        (explicit && (!Number.isSafeInteger(revision) || revision < 0))) fail("invalid-argument", "Invalid reaction.");
    const creationRef = db.doc(`creations/${creationId}`);
    const voteRef = creationRef.collection("votes").doc(uid);
    return db.runTransaction(async tx => {
        const [creation, vote] = await Promise.all([tx.get(creationRef), tx.get(voteRef)]);
        if (!creation.exists) fail("not-found", "Creation not found.");
        const current = vote.data() || {};
        // Do not overwrite an unmigrated historical ballot with a reaction.
        if (current.type === "event_vote") fail("failed-precondition", "This event vote must be migrated before reacting. Please try again shortly.");
        const currentType = current.type || null;
        const nextType = explicit ? (selected ? voteType : null) : currentType === voteType ? null : voteType;
        if (currentType === nextType) return {success: true, type: currentType, revision: current.revision || 0};
        if (explicit && revision !== (current.revision || 0)) fail("aborted", "Your reaction changed in another window. Please try again.");
        const data = creation.data();
        const result = {type: nextType, revision: (current.revision || 0) + 1};
        tx.set(voteRef, {...result, userId: uid});
        tx.update(creationRef, {
            likes: Math.max(0, (data.likes || 0) + Number(nextType === "like") - Number(currentType === "like")),
            dislikes: Math.max(0, (data.dislikes || 0) + Number(nextType === "dislike") - Number(currentType === "dislike")),
        });
        return {success: true, ...result};
    });
}
module.exports = {setCreationReaction};
