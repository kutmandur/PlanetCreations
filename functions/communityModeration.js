"use strict";
const {HttpsError}=require('firebase-functions/v2/https');
const {safeId}=require('./contentReporting');
const {getEffectiveCommunityPermissionKeys}=require('./communityMembership');
async function canAppeal(db,uid,communityId,tx) {
    if(!uid||!safeId(communityId))return false;
    const read=ref=>tx?tx.get(ref):ref.get();
    const [community,member,lock]=await Promise.all([read(db.doc(`communitys/${communityId}`)),read(db.doc(`communitys/${communityId}/members/${uid}`)),read(db.doc(`accountDeletionLocks/${uid}`))]);
    return community.exists&&!lock.exists&&(community.data().ownerId===uid||(member.exists&&getEffectiveCommunityPermissionKeys(community.data(),member.data()).includes('manageModerationAppeals')));
}
async function getCommunityModeration(db,uid,data) {
    await db.runTransaction(async tx=>{
        if(!await canAppeal(db,uid,data?.communityId,tx))throw new HttpsError('permission-denied','Community moderation appeal permission required.');
        const memberRef=db.doc(`communitys/${data.communityId}/members/${uid}`);
        const [community,member]=await Promise.all([tx.get(db.doc(`communitys/${data.communityId}`)),tx.get(memberRef)]);
        if(member.exists)tx.update(memberRef,{perms:getEffectiveCommunityPermissionKeys(community.data(),member.data())});
    });
    const snapshots=await db.collection('contentReviews').where('communityId','==',data.communityId).limit(100).get();
    return {items:snapshots.docs.map(doc=>{const r=doc.data();return {id:doc.id,targetPath:r.targetPath,status:r.status,reason:r.reason||'Original review content expired.',canAppeal:['withhold','reviewing'].includes(r.status)&&Boolean(r.original)&&r.expiresAt?.toMillis()>Date.now(),expiresAtMillis:r.expiresAt?.toMillis()||0,updatedAtMillis:r.updatedAt?.toMillis()||0};})};
}
module.exports={canAppeal,getCommunityModeration};
