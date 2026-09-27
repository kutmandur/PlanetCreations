"use strict";
const {FieldPath, FieldValue} = require("firebase-admin/firestore");
const {enqueueDelivery} = require("./discordDelivery");

async function* documents(collection, {checkpointRef, checkpointKey} = {}) {
    let cursor;
    if (checkpointRef) {
        const checkpoint = await checkpointRef.get();
        if (!checkpoint.exists) checkpointRef = null;
        else {
            const progress = checkpoint.data().referenceCursors?.[checkpointKey];
            if (progress?.done) return;
            cursor = progress?.cursor;
        }
    }
    do {
        let query = collection.orderBy(FieldPath.documentId()).limit(25);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const doc of page.docs) yield doc;
        cursor = page.size === 25 ? page.docs.at(-1).id : null;
        if (checkpointRef) await checkpointRef.update({[`referenceCursors.${checkpointKey}`]: {cursor, done: !cursor}});
    } while (cursor);
}

async function removeCommunityContributions(db, community, uid) {
    for (const name of ["members", "invites", "joinRequests"]) await db.recursiveDelete(community.ref.collection(name).doc(uid));
    // Contributions may belong to users no longer listed as members.
    for (const name of ["posts", "comments", "announcements", "messages"]) {
        for await (const doc of documents(community.ref.collection(name))) {
            if ([doc.data().userId, doc.data().authorId, doc.data().createdBy].includes(uid)) await db.recursiveDelete(doc.ref);
        }
    }
}

async function removeReferences(db, uid, {deleteObjects = async () => {}} = {}) {
    const decisions=await db.collectionGroup('moderationHistory').where('actorUid','==',uid).get();
    for(const decision of decisions.docs)await decision.ref.update({actorUid:null,actorDeleted:true});
    const scan = collection => documents(collection, {checkpointRef: db.doc(`accountDeletionJobs/${uid}`), checkpointKey: collection.id});
    const removed = await db.collection(`accountDeletionLocks/${uid}/creations`).get();
    const removedIds = new Set(removed.docs.map(doc => doc.id));
    for (const collection of ["bugReports", "reports", "contentReviews", "collaborationInvitationGrants", "backupUploadSessions", "liveChannelClaims", "oauthStates"]) {
        for await (const doc of scan(db.collection(collection))) {
            const data = doc.data();
            if ([data.uid, data.userId, data.authorId, data.reporterId, data.targetUserId, data.senderId, data.ownerId].includes(uid) ||
                (data.targetType === "user" && data.targetId === uid) || removedIds.has(data.targetId)) {
                if (collection === "backupUploadSessions") {
                    const keys = [data.objectKey, data.destinationKey, data.collaborationId ? null : data.previousObjectKey, data.rideAnalysisObjectKey].filter(Boolean);
                    if (keys.some(key => key.includes("..") || key.includes("\\"))) throw Error("Unsafe upload session key.");
                    for (const key of keys) if (!["temp-uploads", "creation-backups", "creation-ride-analysis"].some(prefix => key.startsWith(`${prefix}/${uid}/`)) &&
                        !(data.collaborationId && key.startsWith(`collaboration-files/${data.collaborationId}/`))) throw Error("Unknown upload session storage ownership.");
                    await deleteObjects(keys);
                }
                await db.recursiveDelete(doc.ref);
            } else if(collection==='contentReviews'&&(data.reviewedBy===uid||data.amendedBy===uid||(data.history||[]).some(entry=>entry.actorUid===uid))) {
                await db.runTransaction(async tx=>{
                    const current=await tx.get(doc.ref);if(!current.exists)return;
                    const review=current.data(),update={};
                    if(review.reviewedBy===uid){update.reviewedBy=null;update.reviewedByDeleted=true;}
                    if(review.amendedBy===uid){update.amendedBy=null;update.amendedByDeleted=true;}
                    if((review.history||[]).some(entry=>entry.actorUid===uid))update.history=review.history.map(entry=>entry.actorUid===uid?{...entry,actorUid:null,actorDeleted:true}:entry);
                    if(Object.keys(update).length){update.revision=(review.revision||0)+1;tx.update(doc.ref,update);}
                });
            }
        }
    }
    for await (const profile of scan(db.collection("profiles"))) {
        await db.runTransaction(async tx => {
            const current = await tx.get(profile.ref);
            if (!current.exists) return;
            const update = {};
            for (const key of ["followers", "following"]) if (current.data()[key]?.includes(uid)) update[key] = FieldValue.arrayRemove(uid);
            if (Object.keys(update).length) tx.update(profile.ref, update);
        });
    }
    for await (const creation of scan(db.collection("creations"))) {
        const voteRef = creation.ref.collection("votes").doc(uid);
        await db.runTransaction(async tx => {
            const [vote, current] = await Promise.all([tx.get(voteRef), tx.get(creation.ref)]);
            if (!vote.exists) return;
            const type = vote.data().type;
            if (type === "event_vote" && vote.data().eventId) {
                const event = await tx.get(db.doc(`events/${vote.data().eventId}`));
                if (event.exists) tx.create(event.ref.collection("anonymousBallots").doc(), {creationIds: [creation.id], legacy: true});
            }
            // Legacy event votes keep their aggregate. Only the personal slot goes.
            if (current.exists && ["like", "dislike"].includes(type)) {
                const field = type === "like" ? "likes" : "dislikes";
                tx.update(creation.ref, {[field]: Math.max(0, (current.data()[field] || 0) - 1)});
            }
            tx.delete(voteRef);
        });
        await db.doc(`creationFollowers/${creation.id}/followers/${uid}`).delete();
    }
    for await (const event of scan(db.collection("events"))) {
        for (const name of ["voters", "submissionClaims"]) await db.recursiveDelete(event.ref.collection(name).doc(uid));
    }
    for await (const user of scan(db.collection("users"))) {
        await user.ref.collection("blocks").doc(uid).delete();
        const inbox = user.ref.collection("meta").doc("inbox");
        await db.runTransaction(async tx => {
            const current = await tx.get(inbox);
            if (!current.exists || !Array.isArray(current.data().items)) return;
            const items = current.data().items.filter(item => ![item.userId, item.actorId, item.senderId].includes(uid) &&
                !item.relatedUserIds?.includes(uid) && !String(item.link || "").includes(`/profile/${uid}`) &&
                ![...removedIds].some(id => String(item.link || "").includes(`/creation/${id}`)));
            if (items.length !== current.data().items.length) tx.update(inbox, {items, unreadCount: items.filter(item => !item.isRead).length});
        });
        for (const name of ["collaborationInvites", "reportedItems"]) {
            for await (const doc of documents(user.ref.collection(name))) {
                if ([doc.data().senderId, doc.data().targetUserId, doc.data().targetId].includes(uid) || removedIds.has(doc.id)) await doc.ref.delete();
            }
        }
    }
    await db.recursiveDelete(db.doc(`liveSessions/${uid}`));
}

async function deleteIdentity(db, uid, job) {
    // Legacy username claims store only email. Never release another owner's
    // reservation merely because a stale profile still contains its name.
    for await (const claim of documents(db.collection("usernames"))) {
        const data = claim.data();
        if (data.uid === uid || data.userId === uid || (!data.uid && !data.userId && job.email && data.email === job.email)) await claim.ref.delete();
    }
    for await (const link of documents(db.collection("discordAccountLinks"))) if (link.data().uid === uid) await link.ref.delete();
    for (const name of ["applications", "privateOAuthCredentials", "clientInstallQueues", "profiles", "users"]) {
        await db.recursiveDelete(db.doc(`${name}/${uid}`));
    }
}

async function deleteCreationData(db, snapshot, {deleteObjects, removeIndex}) {
    const data = snapshot.data();
    if (data.backupUrl && !data.backupObjectKey) throw Error("Legacy managed backup needs a verified storage key before deletion.");
    const keys = [data.backupObjectKey, data.rideAnalysisObjectKey].filter(Boolean);
    for (const key of keys) if (!["creation-backups", "creation-ride-analysis"].some(prefix =>
        key.startsWith(`${prefix}/${data.userId}/${snapshot.id}/`)) || key.includes("..") || key.includes("\\")) {
        throw Error("Unrecognized creation object ownership.");
    }
    await deleteObjects(keys);
    // Adopt legacy Discord bindings before their source records disappear.
    const deliveries = new Map();
    for (const communityId of data.communityIds || []) {
        const link = await db.doc(`communitys/${communityId}/creations/${snapshot.id}`).get();
        for (const kind of ["general", "showcase"]) {
            const messageId = kind === "general" ? link.data()?.discordMessageId : link.data()?.discordShowcaseMessageId;
            const channelId = kind === "general" ? link.data()?.discordChannelId : link.data()?.discordShowcaseChannelId;
            const target = {communityId, creationId: snapshot.id, kind, legacy: messageId && channelId ? {messageId, channelId} : null};
            await enqueueDelivery(db, target);
            deliveries.set(`${communityId}:${kind}`, target);
        }
        await link.ref.delete();
    }
    await db.recursiveDelete(db.doc(`creationFollowers/${snapshot.id}`));
    await db.recursiveDelete(snapshot.ref);
    for (const target of deliveries.values()) await enqueueDelivery(db, target);
    const existing = await db.collection("discordDeliveries").where("creationId", "==", snapshot.id).get();
    for (const delivery of existing.docs) await enqueueDelivery(db, delivery.data());
    await removeIndex(snapshot.id, data);
}

module.exports = {documents, removeCommunityContributions, removeReferences, deleteIdentity, deleteCreationData};
