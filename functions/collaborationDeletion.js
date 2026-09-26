"use strict";
const {isAccountActive} = require("./accountLifecycle");

// Identity fields are removed together with their display fields, including
// embedded snapshots. Timestamps and other Firestore value types stay intact.
function anonymizeHistory(value, uid) {
    if (Array.isArray(value)) return value.filter(item => item !== uid).map(item => anonymizeHistory(item, uid));
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, anonymizeHistory(item, uid)]));
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

async function scrubTree(db, ref, uid) {
    for (const collection of await ref.listCollections()) {
        for (const child of await collection.listDocuments()) await scrubTree(db, child, uid);
    }
    await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists) return;
        const next = anonymizeHistory(current.data(), uid);
        if (JSON.stringify(next) !== JSON.stringify(current.data())) tx.set(ref, next);
    });
}

async function removeAccountFromCollaboration(db, ref, uid, {
    deleteCollaboration, deleteObjects, deleteCreation, transferCreation, departureUpdate, isEligibleSuccessor = async () => true,
}) {
    let snapshot = await ref.get();
    if (!snapshot.exists) return;
    let collaboration = snapshot.data();
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
    await scrubTree(db, ref, uid);
    const publications = await db.collection("creations").where("sourceCollaborationId", "==", ref.id).get();
    for (const publication of publications.docs) await scrubTree(db, publication.ref, uid);
}

module.exports = {anonymizeHistory, scrubTree, removeAccountFromCollaboration};
