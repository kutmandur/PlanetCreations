"use strict";
const {HttpsError}=require('firebase-functions/v2/https');
const {Timestamp,FieldValue}=require('firebase-admin/firestore');
const {safeId}=require('./contentReporting');

// Showcase moderation never writes to the featured creation documents.
async function reviewShowcase(tx,db,uid,role,data,report,existing,reportRef,caseRef,notify) {
    const stateRef=db.doc(`showcaseIndexState/${report.targetId}`),controlRef=db.doc(`showcaseModeration/${report.targetId}`);
    const [stateSnap,controlSnap]=await Promise.all([tx.get(stateRef),tx.get(controlRef)]);
    const metadata=stateSnap.data()?.m;
    const communityId=controlSnap.data()?.communityId||metadata?.communityId||report.communityId;
    if(!safeId(communityId))throw new HttpsError('not-found','Showcase no longer available.');
    const communityRef=db.doc(`communitys/${communityId}`),community=await tx.get(communityRef);
    const owner=community.data()?.ownerId;
    if(!safeId(owner))throw new HttpsError('failed-precondition','The showcase community has no active owner.');
    const [links,lock,inbox]=await Promise.all([tx.get(db.collection(`communitys/${communityId}/creations`).where('showcaseGroupId','==',report.targetId)),tx.get(db.doc(`accountDeletionLocks/${owner}`)),tx.get(db.doc(`users/${owner}/meta/inbox`))]);
    if(lock.exists)throw new HttpsError('failed-precondition','Account deletion is in progress.');
    if(links.empty||(!stateSnap.exists&&!controlSnap.data()?.withheld))throw new HttpsError('not-found','Showcase no longer available.');
    const current=controlSnap.data()?.withheld?controlSnap.data():{name:metadata?.name||'',videoUrl:metadata?.videoUrl||'',...controlSnap.data(),...metadata};
    const held=controlSnap.data()?.withheld===true;
    const closed=['restore','publish','dismiss'].includes(existing?.status);
    if(data.action==='reopen') {
        if(role!=='admin'||!closed)throw new HttpsError('failed-precondition','Only an admin can reopen a completed review.');
        if(data.expectedRevision!==(existing.revision||0))throw new HttpsError('aborted','This review changed. Reload before reopening.');
        if(existing.expiresAt?.toMillis()<=Date.now())throw new HttpsError('failed-precondition','This review has expired.');
    } else if(closed)throw new HttpsError('failed-precondition','Reopen this review before making another decision.');
    if(data.action==='withhold'&&held)throw new HttpsError('failed-precondition','This showcase is already withheld. Use its active review.');
    if(data.action==='dismiss'&&held)throw new HttpsError('failed-precondition','Restore or approve the showcase before closing this report.');
    if(['restore','publish','edit'].includes(data.action)&&(!held||controlSnap.data()?.caseId!==data.reportId))throw new HttpsError('failed-precondition','Use the active withheld showcase review.');
    const now=Timestamp.now(),expiresAt=(held||data.action==='reopen')&&existing?.expiresAt?existing.expiresAt:Timestamp.fromMillis(now.toMillis()+30*86400000);
    const status=data.action==='reopen'?'reviewing':data.action==='edit'?(existing?.status||'withhold'):data.action;
    const revision=(existing?.revision||0)+1;
    const update={targetType:'showcase',targetId:report.targetId,communityId,authorId:owner,targetPath:`/showcase/${report.targetId}`,reason:data.reason.trim(),reportReason:report.reason||'',category:report.category||null,status,reviewedBy:uid,reviewedByDeleted:false,revision,updatedAt:now,expiresAt,history:[...(existing?.history||[]),{action:data.action,reason:data.reason.trim(),actorUid:uid,at:now}].slice(-100)};
    let next={...current,communityId,ownerId:owner};
    if(data.action==='withhold') {
        update.original={name:current.name||'',videoUrl:current.videoUrl||''};
        update.originalLinks=Object.fromEntries(links.docs.map(d=>[d.id,{name:d.data().showcaseName||null,videoUrl:d.data().showcaseVideoUrl||null}]));
        update.holdActive=true;next={...next,withheld:true,caseId:data.reportId};
    }
    if(data.action==='edit') {
        if(uid===owner)throw new HttpsError('permission-denied','The owner cannot edit a withheld showcase. Another moderator must make corrections.');
        if(typeof data.name!=='string'||!data.name.trim()||data.name.length>80||typeof data.videoUrl!=='string'||data.videoUrl.length>2000||(data.videoUrl&&!/^https:\/\//i.test(data.videoUrl)))throw new HttpsError('invalid-argument','Enter a name (up to 80 characters) and an HTTPS video URL, or leave the URL empty to remove it.');
        next={...next,name:data.name.trim(),videoUrl:data.videoUrl.trim()};update.edited=true;
    }
    if(data.action==='restore') {
        if(!existing?.original||existing.expiresAt?.toMillis()<=Date.now())throw new HttpsError('failed-precondition','The restoration period has expired.');
        if(existing.edited)throw new HttpsError('failed-precondition','The showcase was edited. Approve the current version instead of overwriting it.');
        next={...next,...existing.original,withheld:false};
    }
    if(data.action==='publish')next={...next,withheld:false};
    if(['restore','publish'].includes(data.action)){update.holdActive=false;update.original=FieldValue.delete();update.originalLinks=FieldValue.delete();}
    if(['withhold','restore','publish','edit'].includes(data.action)) {
        tx.set(controlRef,next);
        for(const link of links.docs) {
            const original=data.action==='restore'?existing.originalLinks?.[link.id]:null;
            tx.update(link.ref,{showcaseModerationWithheld:next.withheld,showcaseName:next.withheld?null:(original?original.name:next.name||null),showcaseVideoUrl:next.withheld?null:(original?original.videoUrl:next.videoUrl||null)});
        }
        const groups=(community.data().showcaseGroups||[]).map(g=>g.id===report.targetId?{...g,name:next.withheld?'Showcase under review':next.name}:g);
        tx.update(communityRef,{showcaseGroups:groups});
        if(stateSnap.exists)tx.update(stateRef,{'m.name':next.withheld?null:next.name||null,'m.videoUrl':next.withheld?null:next.videoUrl||null});
    }
    update.showcaseDetails={name:next.name||'',videoUrl:next.videoUrl||''};
    tx.set(caseRef,update,{merge:true});tx.update(reportRef,{status,reviewedAt:now,communityId,targetUserId:owner});
    tx.set(db.doc(`users/${owner}/moderationNotices/${data.reportId}`),{caseId:data.reportId,targetPath:update.targetPath,status,canAppeal:next.withheld&&['withhold','reviewing'].includes(status),reason:update.reason,updatedAt:now,expiresAt});
    notify(tx,db.doc(`users/${owner}/meta/inbox`),inbox,data.reportId,revision,status,now);
    return {status};
}
module.exports={reviewShowcase};
