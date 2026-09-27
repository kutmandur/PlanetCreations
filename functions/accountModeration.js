"use strict";
const {HttpsError}=require('firebase-functions/v2/https');
const {Timestamp,FieldValue}=require('firebase-admin/firestore');
function isRestricted(state,now=Date.now()) {return state?.banned===true||state?.suspendedUntil?.toMillis()>now;}
async function assertAccountUnrestricted(db,uid) {
    if(!uid)return;
    const [state,user]=await Promise.all([db.doc(`users/${uid}/moderation/state`).get(),db.doc(`users/${uid}`).get()]);
    if(isRestricted(state.data())||user.data()?.role==='banned')throw new HttpsError('permission-denied','Your account is suspended. You can still read decisions, appeal and request account deletion.');
}
async function moderateAccount(db,uid,data) {
    if(!uid||!['admin','moderator'].includes((await db.doc(`profiles/${uid}`).get()).data()?.role))throw new HttpsError('permission-denied','Platform moderation access required.');
    if(typeof data?.targetUserId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.targetUserId)||data.targetUserId===uid||!['warn','suspend','ban','release'].includes(data.action)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>1000||!['1','7','30'].includes(String(data.days||1)))throw new HttpsError('invalid-argument','Select another account, an action and a reason of up to 1,000 characters.');
    const target=data.targetUserId,ref=db.doc(`users/${target}/moderation/state`),audit=db.collection(`users/${target}/moderationHistory`).doc();
    return db.runTransaction(async tx=>{
        const [user,profile,state,lock,inbox]=await Promise.all([tx.get(db.doc(`users/${target}`)),tx.get(db.doc(`profiles/${target}`)),tx.get(ref),tx.get(db.doc(`accountDeletionLocks/${target}`)),tx.get(db.doc(`users/${target}/meta/inbox`))]);
        if(!user.exists||lock.exists)throw new HttpsError('not-found','Account unavailable.');
        if(['admin','moderator'].includes(profile.data()?.role))throw new HttpsError('failed-precondition','Remove platform staff access before applying account sanctions.');
        const now=Timestamp.now(),record={action:data.action,reason:data.reason.trim(),actorUid:uid,createdAt:now,...(state.data()?.appealPending?{appeal:state.data().appeal}:{})};
        tx.create(audit,record);
        const patch=data.action==='ban'?{banned:true,suspendedUntil:null}:data.action==='suspend'?{banned:false,suspendedUntil:Timestamp.fromMillis(now.toMillis()+Number(data.days||1)*86400000)}:data.action==='release'?{banned:false,suspendedUntil:null}:{};
        tx.set(ref,{...patch,reason:record.reason,updatedAt:now,revision:(state.data()?.revision||0)+1,lastAction:data.action,...(data.action==='warn'?{}:{appealPending:false,appeal:null})},{merge:true});
        if(data.action==='warn')tx.update(user.ref,{strikes:FieldValue.increment(1)});
        if(data.action==='release'&&user.data().role==='banned'){
            tx.update(user.ref,{role:'user'});
            if(profile.exists)tx.update(profile.ref,{role:'user'});
        }
        const items=[{id:audit.id,type:'moderation',title:'Account moderation decision',message:record.reason,link:'/settings?section=reviews',timestamp:now,isRead:false,relatedUserIds:[]},...(inbox.data()?.items||[])].slice(0,30);
        tx.set(inbox.ref,{items,unreadCount:items.filter(item=>!item.isRead).length},{merge:true});
        return {action:data.action};
    });
}
async function appealAccountModeration(db,uid,data) {
    if(!uid||typeof data?.reason!=='string'||!data.reason.trim()||data.reason.length>1000)throw new HttpsError('invalid-argument','Sign in and enter an appeal of up to 1,000 characters.');
    const result=await db.runTransaction(async tx=>{
        const ref=db.doc(`users/${uid}/moderation/state`),snap=await tx.get(ref);
        if(!isRestricted(snap.data())||snap.data().appealPending)throw new HttpsError('failed-precondition','No new account appeal is available.');
        tx.update(ref,{appeal:data.reason.trim(),appealPending:true,appealedAt:Timestamp.now()});
        return {accepted:true};
    });
    return result;
}
async function listAccountModeration(db,uid) {
    if(!uid||!['admin','moderator'].includes((await db.doc(`profiles/${uid}`).get()).data()?.role))throw new HttpsError('permission-denied','Platform moderation access required.');
    const snapshots=await Promise.all([db.collectionGroup('moderation').where('appealPending','==',true).limit(100).get(),db.collectionGroup('moderation').where('banned','==',true).limit(100).get(),db.collectionGroup('moderation').where('suspendedUntil','>',Timestamp.now()).limit(100).get()]);
    return {items:[...new Map(snapshots.flatMap(snap=>snap.docs).filter(doc=>/^users\/[^/]+\/moderation\/state$/.test(doc.ref.path)).map(doc=>[doc.ref.path,{userId:doc.ref.parent.parent.id,appealPending:doc.data().appealPending===true}])).values()]};
}
module.exports={isRestricted,assertAccountUnrestricted,moderateAccount,appealAccountModeration,listAccountModeration};
