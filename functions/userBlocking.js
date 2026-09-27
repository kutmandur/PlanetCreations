"use strict";
const {HttpsError} = require("firebase-functions/v2/https");
const {FieldValue} = require("firebase-admin/firestore");

async function isInteractionBlocked(db, a, b, tx = null) {
    if (!a || !b || a === b) return false;
    const read = ref => tx ? tx.get(ref) : ref.get();
    const blocks = await Promise.all([read(db.doc(`users/${a}/blocks/${b}`)), read(db.doc(`users/${b}/blocks/${a}`))]);
    return blocks.some(doc => doc.exists);
}
async function assertInteractionAllowed(db, a, b, tx = null) {
    if (await isInteractionBlocked(db, a, b, tx)) throw new HttpsError("permission-denied", "This interaction is unavailable because of a block.");
}
async function setUserBlock(db, uid, data) {
    const target = data?.targetUserId;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    if (typeof target !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(target) || uid === target || typeof data.blocked !== "boolean") {
        throw new HttpsError("invalid-argument", "Select another account and a block state.");
    }
    await db.runTransaction(async tx => {
        const ref = db.doc(`users/${uid}/blocks/${target}`);
        const [account, other, first, second, profile] = await Promise.all([
            tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`users/${target}`)),
            tx.get(db.doc(`users/${uid}/meta/inbox`)), tx.get(db.doc(`users/${target}/meta/inbox`)), tx.get(db.doc(`profiles/${target}`)),
        ]);
        if (!account.exists) throw new HttpsError("failed-precondition", "Account unavailable.");
        if (data.blocked && !other.exists) throw new HttpsError("not-found", "Account unavailable.");
        if (data.blocked) {
            tx.set(ref, {targetUserId: target, targetUsername: profile.data()?.username || target, createdAt: FieldValue.serverTimestamp()});
            for (const [snap, actor] of [[first, target], [second, uid]]) {
                if (!snap.exists || !Array.isArray(snap.data().items)) continue;
                const items = snap.data().items.filter(item => !item.relatedUserIds?.includes(actor) && item.link !== `/profile/${actor}`);
                tx.update(snap.ref, {items, unreadCount: items.filter(item => !item.isRead).length});
            }
        } else tx.delete(ref);
    });
    if (data.blocked) {
        // Existing invitations are cancelled too, so unblocking cannot resurrect
        // a contact request that the recipient already rejected by blocking.
        for (const [recipient,sender] of [[uid,target],[target,uid]]) {
            const grants=await db.collection('collaborationInvitationGrants').where('targetUserId','==',recipient).get();
            for(const grant of grants.docs) if(grant.data().senderId===sender && grant.data().status==='pending') await db.runTransaction(async tx=>{
                const current=await tx.get(grant.ref);
                if(current.data()?.status==='pending') tx.update(grant.ref,{status:'cancelled',respondedAt:FieldValue.serverTimestamp()});
            });
            const invites=await db.collectionGroup('invites').where('userId','==',recipient).get();
            for(const invite of invites.docs) if(invite.data().invitedBy===sender && invite.ref.path.startsWith('communitys/')) await invite.ref.delete();
        }
    }
    return {blocked: data.blocked};
}
module.exports = {isInteractionBlocked, assertInteractionAllowed, setUserBlock};
