"use strict";
const {HttpsError}=require('firebase-functions/v2/https');
const {Timestamp,FieldValue}=require('firebase-admin/firestore');
const {createHash}=require('node:crypto');
const {safeId}=require('./contentReporting');
const COLLECTIONS={creation:'creations',user:'profiles',community:'communitys',event:'events',collaboration:'collaborations'};
const TEXT=['name','title','description','bio','content','text','changelog','note'];
const MEDIA=['imageUrls','videoUrls','galleryImageUrls','imageUrl','bannerImageUrl','bannerUrl','profilePictureUrl','profileImageUrl','profileBannerUrl','profileMobileBannerUrl'];
const PLACEHOLDER='Content withheld after moderation. The author can request a review in Settings.';
// Written in the decision transaction so an accepted review always reaches the inbox.
function writeReviewNotification(tx,ref,snapshot,caseId,revision,status,now) {
    const inbox=snapshot.data()||{};
    if(inbox.prefs?.moderation?.inApp===false)return;
    const labels={withhold:'Content withheld',reviewing:'Content review in progress',restore:'Content restored',publish:'Edited content approved',dismiss:'Content review resolved',amend_reason:'Review reason updated'};
    const item={id:`moderation-${caseId}-${revision}`,type:'moderation',title:labels[status]||'Content review updated',message:'There is an update to your content review. Open it to see the reason and available actions.',link:`/settings?section=reviews&case=${encodeURIComponent(caseId)}`,timestamp:now,isRead:false,relatedUserIds:[]};
    const items=[item,...(inbox.items||[]).filter(entry=>entry.id!==item.id)].slice(0,30);
    tx.set(ref,{items,unreadCount:items.filter(entry=>!entry.isRead).length},{merge:true});
}
function targetRef(db,report) {
    if(['comment','changelog'].includes(report.targetType)) {
        const parts=String(report.targetId).split('/');
        if(parts.length!==2||!parts.every(safeId)) throw new HttpsError('invalid-argument','Invalid reported item.');
        return db.doc(`collaborations/${parts[0]}/${report.targetType==='comment'?'comments':'uploads'}/${parts[1]}`);
    }
    if(!Object.hasOwn(COLLECTIONS,report.targetType)||!safeId(report.targetId)) throw new HttpsError('invalid-argument','Open this content to moderate it using its management tools.');
    return db.doc(`${COLLECTIONS[report.targetType]}/${report.targetId}`);
}
function redaction(data,mediaKey) {
    const original={},replacement={};
    for(const field of [...TEXT,...MEDIA]) {
        if(!(field in data)) continue;
        if(mediaKey) {
            const matches=url=>typeof url==='string' && createHash('sha256').update(url).digest('hex')===mediaKey;
            if(Array.isArray(data[field]) && data[field].some(matches)) {original[field]=data[field];replacement[field]=data[field].filter(url=>!matches(url));}
            else if(matches(data[field])) {original[field]=data[field];replacement[field]='';}
        } else if(TEXT.includes(field)&&typeof data[field]==='string'&&data[field]) {original[field]=data[field];replacement[field]=PLACEHOLDER;}
        else if(MEDIA.includes(field)&&(typeof data[field]==='string'||Array.isArray(data[field]))) {original[field]=data[field];replacement[field]=Array.isArray(data[field])?[]:'';}
    }
    return {original,replacement};
}
async function reviewContentReport(db,uid,data) {
    const role=uid?(await db.doc(`profiles/${uid}`).get()).data()?.role:null;
    if(!['admin','moderator'].includes(role)) throw new HttpsError('permission-denied','Moderation access required.');
    if(data?.action==='reopen'&&role!=='admin') throw new HttpsError('permission-denied','Only admins can reopen completed reviews.');
    if(!safeId(data?.reportId)||!['reviewing','dismiss','withhold','restore','publish','reopen','edit'].includes(data.action)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>1000) throw new HttpsError('invalid-argument','Choose an action and enter a reason (up to 1000 characters).');
    const reportRef=db.doc(`reports/${data.reportId}`),caseRef=db.doc(`contentReviews/${data.reportId}`);
    return db.runTransaction(async tx=>{
        const [reportSnap,caseSnap]=await Promise.all([tx.get(reportRef),tx.get(caseRef)]);
        if(!reportSnap.exists) throw new HttpsError('not-found','Report no longer available.');
        const report=reportSnap.data(),existing=caseSnap.data();
        if(report.targetType==='showcase')return require('./showcaseReview').reviewShowcase(tx,db,uid,role,data,report,existing,reportRef,caseRef,writeReviewNotification);
        if(data.action==='edit')throw new HttpsError('invalid-argument','Use the creation editor for this content.');
        if(data.action==='reopen'&&(!existing||!['restore','dismiss','publish'].includes(existing.status))) throw new HttpsError('failed-precondition','Only completed reviews can be reopened.');
        if(data.action==='reopen'&&data.expectedRevision!==(existing.revision||0)) throw new HttpsError('aborted','This review changed. Reload it before reopening.');
        if(data.action==='reopen'&&existing.expiresAt?.toMillis()<=Date.now()) throw new HttpsError('failed-precondition','This review has reached its retention limit.');
        const ref=targetRef(db,report),content=await tx.get(ref);
        if(!content.exists) throw new HttpsError('not-found','Content no longer available.');
        const entity=content.data();
        const author=existing?.authorId || entity.authorId || entity.userId || entity.ownerId || entity.creatorId || (report.targetType==='user'?report.targetId:null);
        if(!safeId(author)) throw new HttpsError('failed-precondition','This content has no active author. Use its management tools.');
        const deletionLock=await tx.get(db.doc(`accountDeletionLocks/${author}`));
        if(deletionLock.exists) throw new HttpsError('failed-precondition','Account deletion is in progress.');
        const inboxRef=db.doc(`users/${author}/meta/inbox`),inboxSnap=await tx.get(inboxRef);
        const held=Boolean(existing?.original&&Object.keys(existing.original).length);
        const activeHold=held||(report.targetType==='creation'&&entity.moderationHolds?.[data.reportId]===true);
        if(data.action==='dismiss'&&activeHold) throw new HttpsError('failed-precondition','Restore or approve the edited creation before resolving this report.');
        if(['restore','dismiss','publish'].includes(existing?.status)&&data.action==='reviewing') throw new HttpsError('failed-precondition','This report is already closed.');
        const now=Timestamp.now(),expiresAt=(held||data.action==='reopen')&&existing?.expiresAt?existing.expiresAt:Timestamp.fromMillis(now.toMillis()+30*86400000);
        const status=data.action==='reopen'?'reviewing':data.action;
        const history=[...(existing?.history||[]),{action:data.action,reason:data.reason.trim(),actorUid:uid,at:now}].slice(-100);
        let update={collaborationId:report.collaborationId||null,authorId:author,targetPath:report.targetPath||'/',targetType:report.targetType,targetId:report.targetId,reason:data.reason.trim(),status,reviewedBy:uid,reviewedByDeleted:false,revision:(existing?.revision||0)+1,updatedAt:now,expiresAt,history};
        if(report.targetType==='community')update.communityId=report.targetId;
        if(data.action==='withhold') {
            if(TEXT.some(field=>entity[field]===PLACEHOLDER)) throw new HttpsError('failed-precondition','This content is already withheld. Use its existing review case.');
            if(existing?.original && Object.keys(existing.original).length) throw new HttpsError('failed-precondition','This case already has withheld content. Review or restore it first.');
            const {original,replacement}=redaction(entity,report.mediaKey);
            if(!Object.keys(original).length) throw new HttpsError('failed-precondition','No matching display content remains.');
            tx.update(ref,replacement);update={...update,original,replacement};
            if(report.targetType==='creation') {update.holdActive=true;tx.update(ref,{moderationWithheld:true,moderationHolds:{...(entity.moderationHolds||{}),[data.reportId]:true}});}
        }
        if(data.action==='restore') {
            if(existing?.expiresAt?.toMillis() <= Date.now()) throw new HttpsError('failed-precondition','The restoration period has expired.');
            if(!existing?.original||!Object.keys(existing.original).length) throw new HttpsError('failed-precondition','No retained content to restore.');
            // Never overwrite a newer edit or resurrect content removed by its author.
            for(const [key,value] of Object.entries(existing.replacement)) if(JSON.stringify(entity[key])!==JSON.stringify(value)) throw new HttpsError('failed-precondition','The author edited this content. Do not overwrite the newer version.');
            tx.update(ref,existing.original);update.original=FieldValue.delete();update.replacement=FieldValue.delete();
            if(report.targetType==='creation') {
                update.holdActive=false;
                const holds={...(entity.moderationHolds||{})};delete holds[data.reportId];
                tx.update(ref,{moderationWithheld:Object.keys(holds).length>0,moderationHolds:holds});
            }
        }
        if(data.action==='publish') {
            if(report.targetType!=='creation'||!activeHold) throw new HttpsError('failed-precondition','No withheld creation to approve.');
            if(TEXT.some(field=>entity[field]===PLACEHOLDER)) throw new HttpsError('failed-precondition','Replace withheld text placeholders before approving the edited creation.');
            const holds={...(entity.moderationHolds||{})};delete holds[data.reportId];
            tx.update(ref,{moderationWithheld:Object.keys(holds).length>0,moderationHolds:holds});
            update.holdActive=false;
            if(existing?.original)update.retainedEvidence=existing.original;
            update.original=FieldValue.delete();update.replacement=FieldValue.delete();
        }
        tx.set(caseRef,update,{merge:true});
        tx.set(caseRef,{reportReason:report.reason||'',category:report.category||null,mediaKey:report.mediaKey||null,mediaType:report.mediaType||null},{merge:true});
        tx.update(reportRef,{status,reviewedAt:now});
        const notice={caseId:data.reportId,targetPath:update.targetPath,status,canAppeal:data.action==='withhold'||(held&&data.action==='reviewing'),reason:update.reason,updatedAt:now,expiresAt};
        tx.set(db.doc(`users/${author}/moderationNotices/${data.reportId}`),notice);
        writeReviewNotification(tx,inboxRef,inboxSnap,data.reportId,update.revision,status,now);
        return {status};
    });
}
async function amendContentReview(db,uid,data) {
    if(!uid||(await db.doc(`profiles/${uid}`).get()).data()?.role!=='admin') throw new HttpsError('permission-denied','Admin access required.');
    if(!safeId(data?.caseId)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>1000||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0) throw new HttpsError('invalid-argument','Enter a reason of 1–1000 characters and the current revision.');
    return db.runTransaction(async tx=>{
        const ref=db.doc(`contentReviews/${data.caseId}`),snap=await tx.get(ref);
        if(!snap.exists)throw new HttpsError('not-found','Review no longer available.');
        const existing=snap.data();
        if((existing.revision||0)!==data.expectedRevision)throw new HttpsError('aborted','This review changed. Reload it before saving your correction.');
        if(existing.evidenceExpired||!existing.expiresAt||existing.expiresAt.toMillis()<=Date.now())throw new HttpsError('failed-precondition','This review has reached its retention limit.');
        if(safeId(existing.authorId)&&(await tx.get(db.doc(`accountDeletionLocks/${existing.authorId}`))).exists)throw new HttpsError('failed-precondition','Account deletion is in progress.');
        const noticeRef=safeId(existing.authorId)?db.doc(`users/${existing.authorId}/moderationNotices/${data.caseId}`):null;
        const notice=noticeRef?await tx.get(noticeRef):null;
        const inboxRef=notice?.exists?db.doc(`users/${existing.authorId}/meta/inbox`):null;
        const inboxSnap=inboxRef?await tx.get(inboxRef):null;
        const now=Timestamp.now(),reason=data.reason.trim();
        const history=[...(existing.history||[]),{action:'amend_reason',previousReason:existing.reason||'',reason,actorUid:uid,at:now}].slice(-100);
        tx.update(ref,{reason,history,amendedBy:uid,amendedByDeleted:false,updatedAt:now,revision:data.expectedRevision+1});
        if(notice?.exists)tx.update(noticeRef,{reason,updatedAt:now});
        if(inboxRef)writeReviewNotification(tx,inboxRef,inboxSnap,data.caseId,data.expectedRevision+1,'amend_reason',now);
        return {updated:true};
    });
}
async function appealContentDecision(db,uid,data) {
    if(!uid) throw new HttpsError('unauthenticated','Sign in first.');
    if(!safeId(data?.caseId)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>2000) throw new HttpsError('invalid-argument','Enter an appeal of 1–2000 characters.');
    return db.runTransaction(async tx=>{
        const ref=db.doc(`contentReviews/${data.caseId}`),snap=await tx.get(ref);
        if(!snap.exists)throw new HttpsError('permission-denied','This review is not available to this account.');
        const allowed=snap.data().communityId?await require('./communityModeration').canAppeal(db,uid,snap.data().communityId,tx):snap.data().authorId===uid;
        if(!allowed)throw new HttpsError('permission-denied','This review is not available to this account.');
        if(!['withhold','reviewing'].includes(snap.data().status))throw new HttpsError('failed-precondition','This case already has an appeal or is closed. Wait for a moderation decision.');
        if(snap.data().expiresAt.toMillis()<=Date.now()||!Object.keys(snap.data().original||{}).length) throw new HttpsError('failed-precondition','This decision cannot be appealed here. Contact support via the Legal Notice.');
        tx.update(ref,{status:'appealed',appeal:data.reason.trim(),updatedAt:Timestamp.now(),revision:(snap.data().revision||0)+1,history:[...(snap.data().history||[]),{action:'appeal',reason:data.reason.trim(),actorUid:uid,at:Timestamp.now()}].slice(-100)});
        tx.update(db.doc(`reports/${data.caseId}`),{status:'appealed'});
        tx.update(db.doc(`users/${snap.data().authorId}/moderationNotices/${data.caseId}`),{status:'appealed'});
        return {accepted:true};
    });
}
async function expireContentReviews(db) {
    const snapshots=await db.collection('contentReviews').where('expiresAt','<=',Timestamp.now()).limit(200).get();
    for(const snap of snapshots.docs) {
        await db.runTransaction(async tx=>{
            const current=await tx.get(snap.ref);
            if(!current.exists||!current.data().expiresAt||current.data().expiresAt.toMillis()>Date.now())return;
            const data=current.data(),reportRef=db.doc(`reports/${snap.id}`);
            const report=await tx.get(reportRef);
            const creation=data.targetType==='creation'&&safeId(data.targetId)?await tx.get(db.doc(`creations/${data.targetId}`)):null;
            const showcase=data.targetType==='showcase'&&safeId(data.targetId)?await tx.get(db.doc(`showcaseModeration/${data.targetId}`)):null;
            const active=creation?.data()?.moderationHolds?.[snap.id]===true||(showcase?.data()?.withheld===true&&showcase.data().caseId===snap.id);
            const marker=report.data()?.markerId,reporter=report.data()?.reporterId;
            if(safeId(reporter)&&typeof marker==='string'&&marker.length<=1400&&!marker.includes('/')) {
                const markerRef=db.doc(`users/${reporter}/reportedItems/${marker}`),markerSnap=await tx.get(markerRef);
                if(markerSnap.exists&&(!markerSnap.data().reportId||markerSnap.data().reportId===snap.id))tx.delete(markerRef);
            }
            if(safeId(data.authorId))tx.delete(db.doc(`users/${data.authorId}/moderationNotices/${snap.id}`));
            if(active) {
                // Retain only the operational hold, never expired originals or
                // free-text reports. Staff must still be able to release it.
                const minimal={targetType:data.targetType,targetId:data.targetId,targetPath:data.targetPath||'/',status:'withhold',holdActive:true,evidenceExpired:true,...(data.communityId?{communityId:data.communityId}:{})};
                tx.set(snap.ref,{...minimal,authorId:data.authorId});
                tx.set(reportRef,{...minimal,targetTitle:'Withheld content',reason:'Original review content expired.',timestamp:Timestamp.now()});
            } else {tx.delete(snap.ref);tx.delete(reportRef);}
        });
    }
    return snapshots.size;
}
async function deleteCollaborationReviews(db, collaborationId) {
    for(const collection of ['contentReviews','reports']) {
        const snapshots=await db.collection(collection).where('collaborationId','==',collaborationId).get();
        for(const snap of snapshots.docs) {
            if(collection==='contentReviews') await db.doc(`users/${snap.data().authorId}/moderationNotices/${snap.id}`).delete();
            await db.recursiveDelete(snap.ref);
        }
    }
}
async function getOwnerModerationPreview(db,uid,data) {
    if(!uid)throw new HttpsError('unauthenticated','Sign in first.');
    if(!safeId(data?.creationId))throw new HttpsError('invalid-argument','Invalid creation.');
    return db.runTransaction(async tx=>{
        const snap=await tx.get(db.doc(`creations/${data.creationId}`));
        if(!snap.exists||snap.data().userId!==uid)throw new HttpsError('permission-denied','Only the owner can view this preview.');
        const entity=snap.data();
        if(!entity.moderationWithheld)return {displayFields:{}};
        const reviews=await tx.get(db.collection('contentReviews').where('targetId','==',data.creationId));
        const cases=reviews.docs.map(d=>d.data()).filter(r=>r.targetType==='creation'&&r.authorId===uid&&r.original&&r.expiresAt?.toMillis()>Date.now());
        const withheldAt=r=>r.history?.findLast(h=>h.action==='withhold')?.at?.toMillis()||0;
        cases.sort((a,b)=>withheldAt(b)-withheldAt(a));
        const displayFields={};
        for(const field of [...TEXT,...MEDIA])if(Object.hasOwn(entity,field))displayFields[field]=entity[field];
        for(const review of cases)for(const [field,value] of Object.entries(review.original)) {
            if([...TEXT,...MEDIA].includes(field)&&JSON.stringify(displayFields[field])===JSON.stringify(review.replacement?.[field]))displayFields[field]=value;
        }
        return {displayFields,evidenceExpired:cases.length===0};
    });
}
module.exports={getOwnerModerationPreview,amendContentReview,deleteCollaborationReviews,reviewContentReport,appealContentDecision,expireContentReviews,redaction};
