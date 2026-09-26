"use strict";

// Transactions preserve concurrent edits and retries never delete the canonical
// creation. Recursive deletion also covers histories and orphan subcollections.
async function detachCreations(db, field, id) {
    const creations = await db.collection("creations").where(field, "array-contains", id).get();
    for (const creation of creations.docs) await db.runTransaction(async tx => {
        const current = await tx.get(creation.ref);
        if (!current.exists) return;
        const data = current.data();
        const update = {[field]: (data[field] || []).filter(value => value !== id)};
        if (field === "communityIds" && Array.isArray(data.communityAssignments)) {
            update.communityAssignments = data.communityAssignments.filter(value => value.communityId !== id);
        }
        if (field === "communityIds" && data.communitySpecificData && id in data.communitySpecificData) {
            update.communitySpecificData = {...data.communitySpecificData};
            delete update.communitySpecificData[id];
        }
        tx.update(creation.ref, update);
    });
}

async function deleteCommunityData(db, communityId, {deleteIndex = async () => {}, prepareCommunity = async () => {}, finishCommunity = async () => {}} = {}) {
    const ref = db.doc(`communitys/${communityId}`);
    await prepareCommunity(ref);
    await detachCreations(db, "communityIds", communityId);
    const events = await db.collection("events").where("communityId", "==", communityId).get();
    for (const event of events.docs) {
        await detachCreations(db, "eventIds", event.id);
        await db.recursiveDelete(event.ref);
    }
    const memberships = await db.collectionGroup("communityMemberships").where("communityId", "==", communityId).get();
    for (const member of memberships.docs) await member.ref.delete();
    // Legacy mirrors can have only the community ID in their document name.
    const members = await db.collection(`communitys/${communityId}/members`).get();
    for (const member of members.docs) await db.doc(`profiles/${member.id}/communityMemberships/${communityId}`).delete();
    const showcases = await db.collection("showcaseIndexState").where("m.communityId", "==", communityId).get();
    for (const showcase of showcases.docs) await deleteIndex("showcase", showcase.id);
    await deleteIndex("community", communityId);
    await db.recursiveDelete(ref);
    await finishCommunity(ref);
}

module.exports = {deleteCommunityData, detachCreations};
