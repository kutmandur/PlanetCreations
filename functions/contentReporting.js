"use strict";
const {HttpsError}=require('firebase-functions/v2/https');
const {FieldValue,Timestamp}=require('firebase-admin/firestore');
const {createHash}=require('node:crypto');
const COLLECTIONS={creation:'creations',user:'profiles',community:'communitys',event:'events',showcase:'showcaseIndexState',collaboration:'collaborations'};
// eslint-disable-next-line no-control-regex
function safeId(value) {return typeof value==='string' && /^[^/\\\x00-\x1f]{1,200}$/.test(value) && !['.','..'].includes(value);}
async function resolveReportTarget(db,uid,data) {
    const type=data?.targetType;
    if (!Object.hasOwn(COLLECTIONS,type) && !['comment','changelog'].includes(type)) throw new HttpsError('invalid-argument','Unsupported report target.');
    let id=data.targetId, snap, parentId=data.parentId;
    if(type==='community' && data.targetSlug) {
        if(!/^[a-z0-9-]{1,200}$/.test(data.targetSlug)) throw new HttpsError('invalid-argument','Invalid community.');
        const results=await db.collection('communitys').where('slug','==',data.targetSlug).limit(1).get();
        snap=results.docs[0]; id=snap?.id;
    } else {
        if(!safeId(id)) throw new HttpsError('invalid-argument','Invalid target.');
        if(['comment','changelog'].includes(type)) {
            if(!safeId(parentId)) throw new HttpsError('invalid-argument','Invalid collaboration.');
            const [member,profile]=await Promise.all([db.doc(`collaborations/${parentId}/members/${uid}`).get(),db.doc(`profiles/${uid}`).get()]);
            if(!member.exists && !['admin','moderator'].includes(profile.data()?.role)) throw new HttpsError('permission-denied','Join this collaboration to report its private content.');
            snap=await db.doc(`collaborations/${parentId}/${type==='comment'?'comments':'uploads'}/${id}`).get();
        } else snap=await db.doc(`${COLLECTIONS[type]}/${id}`).get();
    }
    if(!snap?.exists) throw new HttpsError('not-found','This content is no longer available.');
    const entity=type==='showcase' ? (snap.data().m || snap.data()) : snap.data();
    if(type==='collaboration' && entity.visibility!=='public') {
        const [member,profile]=await Promise.all([db.doc(`collaborations/${id}/members/${uid}`).get(),db.doc(`profiles/${uid}`).get()]);
        if(!member.exists && !['admin','moderator'].includes(profile.data()?.role)) throw new HttpsError('permission-denied','This collaboration is private.');
    }
    let targetPath=type==='community'?`/${encodeURIComponent(entity.slug)}`:type==='user'?`/profile/${encodeURIComponent(id)}`:`/${type}/${encodeURIComponent(id)}`;
    if(parentId && ['comment','changelog'].includes(type)) {targetPath=`/collaboration/${encodeURIComponent(parentId)}#${type}-${encodeURIComponent(id)}`;id=`${parentId}/${id}`;}
    const target={targetType:type,targetId:id,targetPath,targetTitle:String(entity.title||entity.name||entity.username||`${type} content`).slice(0,500)};
    target.contentVersion=createHash('sha256').update(JSON.stringify(Object.fromEntries(['title','name','username','description','bio','text','content','changelog','note','imageUrls','videoUrls','galleryImageUrls','videoUrl','imageUrl','bannerImageUrl','bannerUrl','profilePictureUrl','profileImageUrl','profileBannerUrl','profileMobileBannerUrl'].map(key=>[key,entity[key]??null])))).digest('hex');
    if(type==='collaboration' || ['comment','changelog'].includes(type)) target.collaborationId=type==='collaboration'?id:parentId;
    let owner=entity.authorId||entity.userId||entity.ownerId||entity.creatorId||(type==='user'?id:null);
    if(type==='showcase') {
        if(!safeId(entity.communityId))throw new HttpsError('failed-precondition','This showcase has no community.');
        const community=await db.doc(`communitys/${entity.communityId}`).get();
        owner=community.data()?.ownerId;
        target.communityId=entity.communityId;
    }
    if(safeId(owner)) target.targetUserId=owner;
    if(data.mediaUrl!==undefined) {
        const urls=[...(entity.imageUrls||[]),...(entity.videoUrls||[]),...(entity.galleryImageUrls||[]),entity.videoUrl,entity.imageUrl,entity.bannerImageUrl,entity.bannerUrl,entity.profilePictureUrl,entity.profileImageUrl,entity.profileBannerUrl,entity.profileMobileBannerUrl];
        if(typeof data.mediaUrl!=='string'||!urls.includes(data.mediaUrl)) throw new HttpsError('invalid-argument','Select media belonging to this content.');
        // The URL hash identifies the exact item without copying personal media into reports.
        target.mediaKey=createHash('sha256').update(data.mediaUrl).digest('hex');
        target.mediaType=entity.videoUrl===data.mediaUrl||(entity.videoUrls||[]).includes(data.mediaUrl)?'video':'image';
        target.targetTitle=`Media in ${target.targetTitle}`.slice(0,500);
    }
    target.markerId=encodeURIComponent(`${type}:${id}${target.mediaKey?':'+target.mediaKey:''}`);
    if(Buffer.byteLength(target.markerId,'utf8') > 1400) throw new HttpsError('invalid-argument','The report target is too long.');
    return target;
}
async function submitContentReport(db,uid,data) {
    if(!uid) throw new HttpsError('unauthenticated','Sign in to report content, or use the contact details in the Legal Notice.');
    if(typeof data?.reason!=='string'||!data.reason.trim()||data.reason.length>2000) throw new HttpsError('invalid-argument','Enter a report reason of 1–2000 characters.');
    const category=data.category??(data.mediaUrl?'images':'other');
    if(!['images','text','other'].includes(category))throw new HttpsError('invalid-argument','Choose images, text or other.');
    const target=await resolveReportTarget(db,uid,data);
    const marker=db.doc(`users/${uid}/reportedItems/${target.markerId}`);
    const report=db.collection('reports').doc();
    return db.runTransaction(async tx=>{
        const limitRef=db.doc(`users/${uid}/reportLimits/current`);
        const [existing,limits]=await Promise.all([tx.get(marker),tx.get(limitRef)]);
        const previous=existing.data()?.reportId?await tx.get(db.doc(`reports/${existing.data().reportId}`)):null;
        const sameVersion=!existing.data()?.contentVersion||existing.data().contentVersion===target.contentVersion;
        const closed=previous?.exists&&['restore','publish','dismiss','deleted'].includes(previous.data().status);
        if(existing.exists&&sameVersion&&!closed)return {accepted:true,duplicate:true,...target};
        const now=Date.now(),last=existing.data()?.reportedAt?.toMillis()||0;
        if(existing.exists&&now-last<3600000)throw new HttpsError('resource-exhausted','Please wait one hour before reporting this content again. For urgent concerns, use the Legal Notice contact.');
        const history=(limits.data()?.recent||[]).filter(time=>time>now-86400000);
        if(history.length>=30||history.filter(time=>time>now-3600000).length>=10)throw new HttpsError('resource-exhausted','Report limit reached (10 per hour, 30 per day). Please try later or use the Legal Notice contact for urgent concerns.');
        tx.set(limitRef,{recent:[...history,now]});
        tx.create(report,{...target,category,reason:data.reason.trim(),reporterId:uid,timestamp:FieldValue.serverTimestamp(),dueAt:Timestamp.fromMillis(now+86400000),status:'open'});
        tx.set(marker,{reportId:report.id,contentVersion:target.contentVersion,reportedAt:FieldValue.serverTimestamp(),targetId:target.targetId,targetType:target.targetType});
        return {accepted:true,...target};
    });
}
module.exports={resolveReportTarget,submitContentReport,safeId};
