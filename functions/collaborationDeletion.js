"use strict";
const {createHash} = require("node:crypto");
const {isAccountActive} = require("./accountLifecycle");

// Identity fields are removed together with their display fields, including
// embedded snapshots. Timestamps and other Firestore value types stay intact.
const DELETED_CONTENT = "Content removed after account deletion.";
const AUTHOR_FIELDS = ["authorId", "userId", "uid", "uploadedBy", "createdBy", "contributorId"];
const PERSONAL_TEXT = ["content", "text", "note", "description", "changelog", "message"];
function anonymizeHistory(value, uid, removedMedia = new Set(), removedTodos = new Set()) {
    if (Array.isArray(value)) return value.filter(item => item !== uid && !removedMedia.has(item)).map(item => anonymizeHistory(item, uid, removedMedia, removedTodos));
    if (typeof value === "string" && removedMedia.has(value)) return null;
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, anonymizeHistory(item, uid, removedMedia, removedTodos)]));
    if (removedTodos.has(value.id) && typeof value.text === "string") result.text = DELETED_CONTENT;
    const authored = AUTHOR_FIELDS.some(key => value[key] === uid);
    if (authored) {
        for (const key of PERSONAL_TEXT) if (typeof value[key] === "string") result[key] = DELETED_CONTENT;
        for (const key of ["imageUrls", "media", "attachments"]) if (Array.isArray(value[key])) result[key] = [];
        for (const key of ["imageUrl", "videoUrl", "thumbnailUrl"]) if (key in value) result[key] = null;
        result.contentDeleted = true;
    }
    for (const [key, item] of Object.entries(value)) {
        if (item === uid) {
            result[key] = null;
            const prefix = key === "uid" || key === "userId" ? "" : key.replace(/Id$/, "");
            for (const nameKey of [prefix ? `${prefix}Username` : "username", prefix ? `${prefix}Name` : "displayName"]) {
                if (nameKey in value) result[nameKey] = "Deleted user";
            }
            for (const avatarKey of [prefix ? `${prefix}AvatarUrl` : "avatarUrl", "profileUrl"]) {
                if (avatarKey in value) result[avatarKey] = null;
            }
            if (key === "uid") result.deleted = true;
        }
    }
    if (value.userId === uid && ("hasSave" in value)) {
        result.hasSave = false;
        if ("versionId" in value) result.versionId = null;
    }
    return result;
}

async function scrubTree(db, ref, uid, removedMedia, removedTodos) {
    for (const collection of await ref.listCollections()) {
        for (const child of await collection.listDocuments()) await scrubTree(db, child, uid, removedMedia, removedTodos);
    }
    await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists) return;
        const next = anonymizeHistory(current.data(), uid, removedMedia, removedTodos);
        if (JSON.stringify(next) !== JSON.stringify(current.data())) tx.set(ref, next);
    });
}

async function removeAccountFromCollaboration(db, ref, uid, {
    deleteCollaboration, deleteObjects, deleteCreation, transferCreation, departureUpdate, isEligibleSuccessor = async () => true,
}) {
    let snapshot = await ref.get();
    if (!snapshot.exists) return;
    let collaboration = snapshot.data();
    const inventory = db.doc(`accountDeletionLocks/${uid}/collaborationMedia/${ref.id}`);
    // Capture root gallery provenance before ownership transfer removes the old UID.
    if(collaboration.galleryOwnerId === uid) {
        for(const url of (collaboration.galleryImageUrls||[]).filter(value=>typeof value==='string'&&value))
            await inventory.collection('items').doc(createHash('sha256').update(url).digest('hex')).set({url});
    }
    if(collaboration.bannerOwnerId === uid && typeof collaboration.bannerImageUrl === 'string' && collaboration.bannerImageUrl) await inventory.collection('items').doc(createHash('sha256').update(collaboration.bannerImageUrl).digest('hex')).set({url:collaboration.bannerImageUrl});
    const todos = await ref.collection('todos').where('createdBy','==',uid).get();
    for(const todo of todos.docs) await inventory.collection('todos').doc(todo.id).set({id:todo.id});
    const removedTodos = new Set((await inventory.collection('todos').get()).docs.map(doc=>doc.id));
    const invitations = await ref.collection("invitations").get();
    for (const invitation of invitations.docs) if ([invitation.data().targetUserId, invitation.data().senderId].includes(uid)) await db.recursiveDelete(invitation.ref);
    if (collaboration.ownerId === uid) {
        const members = await ref.collection("members").get();
        const ordered = members.docs.filter(member => member.id !== uid).sort((a, b) =>
            (a.data().joinedAt?.toMillis?.() || 0) - (b.data().joinedAt?.toMillis?.() || 0) || a.id.localeCompare(b.id));
        let successor;
        for (const member of ordered) if (await isAccountActive(db, member.id) && await isEligibleSuccessor(member.id)) { successor = member; break; }
        if (!successor) { await deleteCollaboration(snapshot); return; }
        // Transfer file ownership before the old owner's storage prefix is swept.
        const publications = await db.collection("creations").where("sourceCollaborationId", "==", ref.id).get();
        for (const publication of publications.docs) {
            if (publication.data().backupSignerUid === uid) await deleteCreation(publication);
            else if (publication.data().userId === uid) await transferCreation(publication, successor.id);
        }
        await db.runTransaction(async tx => {
            const current = await tx.get(ref);
            const member = await tx.get(successor.ref);
            const active = await isAccountActive(db, successor.id, tx);
            if (current.data()?.ownerId !== uid) return;
            if (!member.exists || !active) throw Error("Collaboration successor changed; retry required.");
            tx.update(ref, {ownerId: successor.id, ownerUsername: member.data().username || "Unknown contributor"});
            tx.update(successor.ref, {role: "owner"});
        });
    }
    // Remove exact save objects first, while their metadata still permits retry.
    const files = await ref.collection("files").get();
    for (const file of files.docs) {
        const versions = await file.ref.collection("versions").get();
        for (const version of versions.docs.filter(doc => doc.data().uploadedBy === uid)) {
            const key = version.data().storageKey;
            if (key) {
                if (!key.startsWith(`collaboration-files/${ref.id}/`)) throw Error("Unrecognized collaboration storage key.");
                await deleteObjects([key]);
            } else if (version.data().storageUrl) throw Error("Legacy save storage requires manual resolution.");
            // Copies of this version are also personal save data.
            const publications = await db.collection("creations").where("sourceCollaborationId", "==", ref.id).get();
            for (const publication of publications.docs) if (publication.data().sourceCollaborationVersionId === version.id) {
                await deleteCreation(publication);
            }
            await db.recursiveDelete(version.ref);
        }
        const remaining = await file.ref.collection("versions").get();
        const latest = remaining.docs.sort((a, b) => (b.data().versionNumber || 0) - (a.data().versionNumber || 0))[0];
        const replacement = latest ? {versionId: latest.id, ...latest.data(), number: latest.data().versionNumber} : null;
        await db.runTransaction(async tx => {
            const [currentFile, currentCollab] = await Promise.all([tx.get(file.ref), tx.get(ref)]);
            if (currentFile.exists && currentFile.data().currentVersion?.uploadedBy === uid) tx.update(file.ref, {currentVersion: replacement});
            if (currentCollab.exists && currentCollab.data().currentVersion?.uploadedBy === uid) tx.update(ref, {currentVersion: replacement});
        });
    }
    await db.runTransaction(async tx => {
        snapshot = await tx.get(ref);
        if (!snapshot.exists) return;
        collaboration = snapshot.data();
        const update = (collaboration.memberIds || []).includes(uid) ? departureUpdate(tx, collaboration, uid) : {};
        if (collaboration.buildLock?.activeBuilderId === uid) update.buildLock = null;
        if (Object.keys(update).length) tx.update(ref, update);
        tx.delete(ref.collection("members").doc(uid));
    });
    // Keep a recoverable inventory until the whole scrub completes. A retry must
    // still remove copies from shared galleries after their author entry is scrubbed.
    const mediaRef = inventory;
    const savedMedia = await mediaRef.collection("items").get();
    const removedMedia = new Set(savedMedia.docs.map(doc => doc.data().url));
    async function collectMedia(record) {
        const snap = await record.get();
        const data = snap.data() || {};
        if (AUTHOR_FIELDS.some(key => data[key] === uid)) {
            for (const url of [...(data.imageUrls || []), data.imageUrl, data.videoUrl, data.thumbnailUrl]) if (typeof url === "string") removedMedia.add(url);
        }
        for (const collection of await record.listCollections()) for (const child of await collection.listDocuments()) await collectMedia(child);
    }
    await collectMedia(ref);
    for (const url of removedMedia) await mediaRef.collection("items").doc(createHash("sha256").update(url).digest("hex")).set({url});
    await scrubTree(db, ref, uid, removedMedia, removedTodos);
    const publications = await db.collection("creations").where("sourceCollaborationId", "==", ref.id).get();
    for (const publication of publications.docs) await scrubTree(db, publication.ref, uid, removedMedia, removedTodos);
}

module.exports = {anonymizeHistory, scrubTree, removeAccountFromCollaboration, DELETED_CONTENT};
