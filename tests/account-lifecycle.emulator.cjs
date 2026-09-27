"use strict";
const {test, after} = require("node:test");
const assert = require("node:assert/strict");
const {createRequire} = require("node:module");
const path = require("node:path");
const req = createRequire(path.resolve(__dirname, "../functions/package.json"));
if (process.env.GCLOUD_PROJECT !== "demo-planetcreations-rules" ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
    throw Error("Run only against the local demo Firestore emulator.");
}
const endpoints = require("../functions/index");
const {getFirestore} = req("firebase-admin/firestore");
const {getApps, deleteApp} = req("firebase-admin/app");
const {notifyUser} = require("../functions/notify");
const {withAccountOperation} = require("../functions/accountLifecycle");
const db = getFirestore();
const {deleteCommunityData} = require("../functions/communityDeletion");
const {removeAccountFromCollaboration} = require("../functions/collaborationDeletion");
const {createAccountDeletionService, anonymizeBallots} = require("../functions/accountDeletion");
const {removeReferences} = require("../functions/accountDeletionData");
const {migrateEventVotes} = require("../functions/securityMigration");
after(async () => { await Promise.all(getApps().map(deleteApp)); });

test("event votes retain totals without an account identifier, including retry", async () => {
    const event = db.doc("events/lifecycle-vote");
    await db.recursiveDelete(event);
    await event.set({voteSchemaVersion: 2});
    await event.collection("ballots").doc("private-voter").set({userId: "private-voter", creationIds: ["foreign-creation"]});
    await event.collection("voteTotals").doc("0").set({counts: {"foreign-creation": 1}});
    await anonymizeBallots(db, "private-voter");
    await anonymizeBallots(db, "private-voter");
    assert.equal((await event.collection("ballots").get()).size, 0);
    const anonymous = await event.collection("anonymousBallots").get();
    assert.equal(anonymous.size, 1);
    assert.deepEqual(anonymous.docs[0].data(), {creationIds: ["foreign-creation"]});
    assert.equal((await event.collection("voteTotals").doc("0").get()).data().counts["foreign-creation"], 1);
});

test("legacy event votes survive account cleanup and subsequent voting migration", async () => {
    const uid = 'lifecycle-legacy-voter', event = db.doc('events/lifecycle-legacy-vote');
    await db.recursiveDelete(event);
    await event.set({voteSchemaVersion: 1, voteType: 'single'});
    await db.doc('creations/lifecycle-legacy-entry').set({userId: 'remaining'});
    await db.doc(`creations/lifecycle-legacy-entry/votes/${uid}`).set({userId: uid, eventId: event.id, type: 'event_vote'});
    await removeReferences(db, uid);
    const report = await migrateEventVotes(db, event.id, {apply: true});
    assert.equal(report.votes, 1);
    assert.equal(report.applied, true);
    const totals = await event.collection('voteTotals').get();
    assert.equal(totals.docs.reduce((sum, doc) => sum + (doc.data().counts['lifecycle-legacy-entry'] || 0), 0), 1);
    assert.equal((await event.collection('anonymousBallots').get()).size, 1);
});

test("durable deletion requires community confirmation and retries failures before deleting Auth", async () => {
    const uid = "lifecycle-job";
    for (const name of ["accountDeletionJobs", "accountDeletionLocks"]) await db.doc(`${name}/${uid}`).delete();
    await db.doc("communitys/lifecycle-confirm").set({ownerId: uid, name: "Must confirm"});
    let deletedAuth = false, fail = true;
    const service = createAccountDeletionService({db, graceMs: 0,
        auth: {getUser: async () => ({email: "private@example.test"}), updateUser: async () => {}, revokeRefreshTokens: async () => {}, deleteUser: async () => { deletedAuth = true; }},
        services: {revokeCredentials: async () => {}, removeCommunityContributions: async () => {},
            deleteStorage: async () => { if (fail) throw Error("Storage unavailable"); },
            deleteIdentity: async () => {}, removeReferences: async () => {}, verify: async () => {},
            deleteCollaboration: async () => {}, deleteObjects: async () => {}, deleteCreation: async () => {}, transferCreation: async () => {},
            departureUpdate: (_, data) => ({memberIds: data.memberIds || []})}});
    await assert.rejects(service.request(uid), error => error.code === "failed-precondition");
    assert.equal((await db.doc(`accountDeletionLocks/${uid}`).get()).exists, false);
    const requestOptions = {confirmedCommunityIds: ["lifecycle-confirm"], receipt: 'b'.repeat(64)};
    const [result, duplicate] = await Promise.all([service.request(uid, requestOptions), service.request(uid, requestOptions)]);
    assert.equal(result.receipt, duplicate.receipt);
    for (let i = 0; i < 5; i++) await service.run(uid);
    await assert.rejects(service.run(uid), /Storage unavailable/);
    assert.equal(deletedAuth, false);
    assert.equal((await service.status(result.receipt)).state, "retrying");
    fail = false;
    for (let i = 0; i < 3; i++) await service.run(uid);
    assert.equal(deletedAuth, true);
    assert.equal((await service.status(result.receipt)).state, "complete");
    assert.equal((await service.status(result.receipt)).expiresAt - (await service.status(result.receipt)).completedAt, 30 * 86400000);
    assert.equal((await db.doc(`accountDeletionJobs/${uid}`).get()).exists, false);
});

test("collaboration transfers owner, removes personal saves and anonymizes history; last departure cascades", async () => {
    const ref = db.doc("collaborations/lifecycle-collab");
    await db.recursiveDelete(ref);
    const uid = "lifecycle-owner", other = "lifecycle-successor";
    await db.doc(`users/${other}`).set({role: "user"});
    await db.doc(`accountDeletionLocks/${other}`).delete();
    await ref.set({galleryOwnerId:uid,galleryImageUrls:['own-gallery'],bannerOwnerId:other,bannerImageUrl:'other-banner',ownerId: uid, memberIds: [uid, other], currentVersion: {uploadedBy: uid}, buildLock: {activeBuilderId: uid}});
    await ref.collection("members").doc(uid).set({role: "owner", username: "Private name"});
    await ref.collection("members").doc(other).set({role: "editor", username: "Remaining"});
    await ref.collection("comments").doc("history").set({authorId: uid, authorUsername: "Private name", authorAvatarUrl: "private-avatar", content: "History"});
    const file = ref.collection("files").doc("save");
    await file.set({currentVersion: {uploadedBy: uid}});
    await file.collection("versions").doc("own").set({uploadedBy: uid, versionNumber: 2, storageKey: "collaboration-files/lifecycle-collab/save/own"});
    await file.collection("versions").doc("other").set({uploadedBy: other, versionNumber: 1, storageKey: "collaboration-files/lifecycle-collab/save/other"});
    await ref.collection('todos').doc('personal-task').set({createdBy:uid,text:'Personal task details'});
    await ref.collection('uploads').doc('other-history').set({userId:other,completedTodos:[{id:'personal-task',text:'Personal task details'}]});
    const deleted = [];
    const services = {deleteObjects: async keys => deleted.push(...keys), deleteCreation: doc => db.recursiveDelete(doc.ref),
        transferCreation: () => assert.fail("no publication"), deleteCollaboration: doc => db.recursiveDelete(doc.ref),
        departureUpdate: (_, data, departing) => ({memberIds: data.memberIds.filter(id => id !== departing)})};
    for (let i = 0; i < 2; i++) await removeAccountFromCollaboration(db, ref, uid, services);
    assert.deepEqual(deleted, ["collaboration-files/lifecycle-collab/save/own"]);
    assert.equal((await ref.get()).data().ownerId, other);
    assert.deepEqual((await ref.get()).data().galleryImageUrls,[]);
    assert.equal((await ref.get()).data().bannerImageUrl,'other-banner');
    assert.equal((await ref.collection('uploads').doc('other-history').get()).data().completedTodos[0].text,'Content removed after account deletion.');
    assert.equal((await ref.get()).data().currentVersion.versionId, "other");
    assert.equal((await file.collection("versions").doc("other").get()).exists, true);
    assert.deepEqual((await ref.collection("comments").doc("history").get()).data(),
        {authorId: null, authorUsername: "Deleted user", authorAvatarUrl: null, content: "Content removed after account deletion.", contentDeleted: true});
    await removeAccountFromCollaboration(db, ref, other, services);
    assert.equal((await ref.get()).exists, false);
    assert.equal((await ref.collection("comments").doc("history").get()).exists, false);
});

test("community cascade preserves others' creations and other assignments across retries", async () => {
    const id = "lifecycle-community";
    await db.doc(`communitys/${id}`).set({ownerId: "departing"});
    await db.doc(`communitys/${id}/members/remaining`).set({roles: ["member"]});
    await db.doc(`profiles/remaining/communityMemberships/${id}`).set({roles: ["member"]});
    await db.doc("creations/lifecycle-preserved").set({userId: "remaining", backupObjectKey: "untouched",
        communityIds: [id, "other"], eventIds: ["lifecycle-event", "other-event"],
        communityAssignments: [{communityId: id}, {communityId: "other"}]});
    await db.doc("events/lifecycle-event").set({communityId: id});
    await db.doc("events/lifecycle-event/anonymousBallots/history").set({creationIds: ["lifecycle-preserved"]});
    await db.doc(`communitys/${id}/history/orphan`).set({content: "remove"});
    for (let i = 0; i < 2; i++) await deleteCommunityData(db, id);
    const creation = (await db.doc("creations/lifecycle-preserved").get()).data();
    assert.equal(creation.userId, "remaining");
    assert.equal(creation.backupObjectKey, "untouched");
    assert.deepEqual(creation.communityIds, ["other"]);
    assert.deepEqual(creation.eventIds, ["other-event"]);
    assert.deepEqual(creation.communityAssignments, [{communityId: "other"}]);
    for (const ref of [`communitys/${id}/history/orphan`, `profiles/remaining/communityMemberships/${id}`,
        "events/lifecycle-event/anonymousBallots/history", `communitys/${id}`]) {
        assert.equal((await db.doc(ref).get()).exists, false);
    }
});

test("notifications retain normal delivery but never recreate a deleted/locked inbox", async () => {
    for (const uid of ["lifecycle-active", "lifecycle-missing", "lifecycle-locked"]) {
        await db.recursiveDelete(db.doc(`users/${uid}`));
        await db.doc(`accountDeletionLocks/${uid}`).delete();
    }
    await db.doc("users/lifecycle-active").set({role: "user"});
    await db.doc("users/lifecycle-locked").set({role: "user"});
    await db.doc("accountDeletionLocks/lifecycle-locked").set({state: "deleting"});
    for (const uid of ["lifecycle-active", "lifecycle-missing", "lifecycle-locked"]) {
        await notifyUser(uid, "test", {title: "A real notification", message: "body", link: "/"});
    }
    const inbox = await db.doc("users/lifecycle-active/meta/inbox").get();
    assert.equal(inbox.data().items.length, 1);
    assert.equal(inbox.data().unreadCount, 1);
    for (const uid of ["lifecycle-missing", "lifecycle-locked"]) {
        assert.equal((await db.doc(`users/${uid}/meta/inbox`).get()).exists, false);
    }
});

test("Auth-only deletion records captured identity and a late profile event cannot recreate data", async () => {
    const uid = 'lifecycle-auth-only';
    for (const name of ['users', 'profiles', 'accountDeletionJobs', 'accountDeletionLocks']) await db.recursiveDelete(db.doc(`${name}/${uid}`));
    const before = await db.doc(`profiles/${uid}`).get();
    await db.doc(`profiles/${uid}`).set({username: 'Private name'});
    const after = await db.doc(`profiles/${uid}`).get();
    await endpoints.onAuthAccountDeleted.run({data: {uid, email: 'deleted-auth@example.test'}});
    await endpoints.onAuthAccountDeleted.run({data: {uid, email: 'deleted-auth@example.test'}});
    const job = await db.doc(`accountDeletionJobs/${uid}`).get();
    assert.equal(job.data().email, 'deleted-auth@example.test');
    await db.doc(`profiles/${uid}`).delete();
    await db.doc(`accountDeletionLocks/${uid}`).delete(); // Also safe after tombstone expiry.
    await endpoints.onProfileWrite.run({id: 'late-profile-event', params: {userId: uid}, data: {before, after}});
    assert.equal((await db.doc(`profiles/${uid}`).get()).exists, false);
    await job.ref.delete();
    await db.doc(`accountDeletionReceipts/${job.data().receiptHash}`).delete();
});

test("ending an orphan live session removes the session without recreating the account", async () => {
    const uid = "lifecycle-live";
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.doc(`liveSessions/${uid}`).set({sessionId: "orphan", creationId: "missing", status: "active"});
    await endpoints.endLive.run({auth: {uid, token: {}}, data: {}});
    assert.equal((await db.doc(`liveSessions/${uid}`).get()).exists, false);
    assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
});

test("admitted operations are journaled and new operations respect the deletion fence", async () => {
    const uid = "lifecycle-race";
    await db.doc(`accountDeletionLocks/${uid}`).delete();
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const running = withAccountOperation(uid, async () => {
        started();
        await new Promise(resolve => { release = resolve; });
        return "finished";
    });
    await ready;
    assert.equal((await db.collection("accountOperations").where("uid", "==", uid).get()).size, 1);
    await db.doc(`accountDeletionLocks/${uid}`).set({state: "deleting"});
    await assert.rejects(withAccountOperation(uid, () => assert.fail("must not execute")),
        error => error.code === "failed-precondition");
    release();
    assert.equal(await running, "finished");
    assert.equal((await db.collection("accountOperations").where("uid", "==", uid).get()).size, 0);
});

test("real deletion endpoints clean a complete account in pages while preserving foreign data", async () => {
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Local Auth emulator required.');
    const uid = 'lifecycle-integrated';
    const auth = req('firebase-admin/auth').getAuth();
    await auth.deleteUser(uid).catch(error => { if (error.code !== 'auth/user-not-found') throw error; });
    for (const collection of ['accountDeletionJobs', 'accountDeletionLocks', 'users', 'profiles']) await db.recursiveDelete(db.doc(`${collection}/${uid}`));
    await auth.createUser({uid, email: 'synthetic@example.test'});
    const writer = db.bulkWriter();
    writer.set(db.doc(`users/${uid}`), {role: 'user'});
    writer.set(db.doc(`profiles/${uid}`), {username: 'Synthetic'});
    writer.set(db.doc(`applications/${uid}`), {email: 'synthetic@example.test'});
    writer.set(db.doc('usernames/synthetic'), {email: 'synthetic@example.test'});
    writer.set(db.doc('profiles/lifecycle-foreign'), {followers: [uid], following: [uid]});
    writer.set(db.doc('creations/lifecycle-foreign'), {userId: 'lifecycle-foreign', likes: 1, communityIds: ['kept']});
    writer.set(db.doc(`creations/lifecycle-foreign/votes/${uid}`), {userId: uid, type: 'like'});
    writer.set(db.doc(`creationFollowers/lifecycle-foreign/followers/${uid}`), {});
    for (let i = 0; i < 501; i++) writer.set(db.doc(`creations/lifecycle-own-${i}`), {userId: uid});
    for (let i = 0; i < 501; i++) writer.set(db.doc(`users/${uid}/following/${i}`), {private: true});
    await writer.close();
    const sdk = req('@aws-sdk/client-s3'), original = sdk.S3Client.prototype.send;
    const ownObject = `temp-uploads/${uid}/orphan.PlanetCreations`;
    const foreignObject = 'creation-backups/lifecycle-foreign/keep/save.PlanetCreations';
    const objects = new Set([ownObject, foreignObject]);
    Object.assign(process.env, {R2_ACCOUNT_ID: 'local', R2_BUCKET_NAME: 'local-test', R2_ACCESS_KEY_ID: 'local', R2_SECRET_ACCESS_KEY: 'local'});
    sdk.S3Client.prototype.send = async command => {
        if (command.constructor.name === 'DeleteObjectCommand') { objects.delete(command.input.Key); return {}; }
        if (command.constructor.name === 'ListObjectsV2Command') return {Contents: [...objects].filter(key => key.startsWith(command.input.Prefix)).map(Key => ({Key})), IsTruncated: false};
        throw Error(`Unexpected storage operation ${command.constructor.name}`);
    };
    try {
        const request = {auth: {uid, token: {auth_time: Date.now() / 1000}}, data: {protocolVersion: 2, confirmedCommunityIds: [], receipt: 'a'.repeat(64)}};
        const result = await endpoints.deleteOwnAccount.run(request);
        assert.equal((await endpoints.deleteOwnAccount.run(request)).receipt, result.receipt);
        await db.doc(`accountDeletionJobs/${uid}`).update({notBefore: new Date(0)});
        for (let i = 0; i < 40 && (await db.doc(`accountDeletionJobs/${uid}`).get()).exists; i++) await endpoints.resumeAccountDeletions.run({});
        assert.equal((await endpoints.getAccountDeletionStatus.run({data: {receipt: result.receipt}})).state, 'complete');
        await assert.rejects(auth.getUser(uid), error => error.code === 'auth/user-not-found');
        assert.equal((await db.collection('creations').where('userId', '==', uid).get()).size, 0);
        assert.equal((await db.collection(`users/${uid}/following`).get()).size, 0);
        assert.equal((await db.doc('creations/lifecycle-foreign').get()).data().likes, 0);
        assert.deepEqual((await db.doc('profiles/lifecycle-foreign').get()).data().followers, []);
        assert.equal((await db.doc('usernames/synthetic').get()).exists, false);
        assert.equal((await db.doc(`applications/${uid}`).get()).exists, false);
        assert.deepEqual([...objects], [foreignObject]);
    } finally { sdk.S3Client.prototype.send = original; }
});

test("blocking suppresses both directions of personal notifications and preserves system messages", async () => {
    const {setUserBlock, assertInteractionAllowed} = require('../functions/userBlocking');
    for (const uid of ['block-a', 'block-b']) {
        await db.doc(`users/${uid}`).set({});
        await db.doc(`users/${uid}/meta/inbox`).set({items: [], unreadCount: 0});
    }
    await notifyUser('block-a', 'newFollower', {message:'before', relatedUserIds:['block-b']});
    await db.doc('collaborationInvitationGrants/block-invite').set({senderId:'block-b',targetUserId:'block-a',status:'pending'});
    await db.doc('communitys/block-community/invites/block-a').set({userId:'block-a',invitedBy:'block-b'});
    await setUserBlock(db, 'block-a', {targetUserId:'block-b',blocked:true});
    assert.equal((await db.doc('collaborationInvitationGrants/block-invite').get()).data().status,'cancelled');
    assert.equal((await db.doc('communitys/block-community/invites/block-a').get()).exists,false);
    assert.equal((await db.doc('users/block-a/meta/inbox').get()).data().items.length,0);
    await assert.rejects(assertInteractionAllowed(db,'block-b','block-a'),e=>e.code==='permission-denied');
    await notifyUser('block-a','newFollower',{message:'blocked',relatedUserIds:['block-b']});
    await notifyUser('block-b','newFollower',{message:'blocked',relatedUserIds:['block-a']});
    assert.equal((await db.doc('users/block-b/meta/inbox').get()).data().items.length,0);
    await notifyUser('block-a','system',{message:'shared project state'});
    assert.equal((await db.doc('users/block-a/meta/inbox').get()).data().items.length,1);
    await setUserBlock(db,'block-a',{targetUserId:'block-b',blocked:false});
    await assertInteractionAllowed(db,'block-a','block-b');
    await notifyUser('block-b','newFollower',{message:'restored',relatedUserIds:['block-a']});
    assert.equal((await db.doc('users/block-b/meta/inbox').get()).data().items.length,1);
});

test('report resolution, media review, appeal and restoration preserve saves and reject unauthorized actions',async()=>{
    const {submitContentReport}=require('../functions/contentReporting');
    const {reviewContentReport,appealContentDecision}=require('../functions/contentReview');
    await db.doc('profiles/review-author').set({role:'user'});
    await db.doc('profiles/review-staff').set({role:'moderator'});
    await db.doc('communitys/review-community').set({slug:'review-slug',name:'Review community',ownerId:'review-author'});
    const canonical=await submitContentReport(db,'review-reporter',{targetType:'community',targetSlug:'review-slug',reason:'Test report'});
    assert.equal(canonical.targetId,'review-community');
    assert.equal((await submitContentReport(db,'review-reporter',{targetType:'community',targetId:'review-community',reason:'Duplicate'})).duplicate,true);
    const creation=db.doc('creations/review-creation');
    await creation.set({userId:'review-author',title:'Park',imageUrls:['https://example.test/a','https://example.test/b'],backupObjectKey:'keep-save',likes:8});
    await assert.rejects(submitContentReport(db,'review-reporter',{targetType:'creation',targetId:creation.id,mediaUrl:'https://foreign.test/a',reason:'Fake media'}),e=>e.code==='invalid-argument');
    const report=await submitContentReport(db,'review-reporter',{targetType:'creation',targetId:creation.id,mediaUrl:'https://example.test/a',reason:'Please review'});
    const reportSnap=(await db.collection('reports').where('markerId','==',report.markerId).get()).docs[0];
    await assert.rejects(reviewContentReport(db,'review-author',{reportId:reportSnap.id,action:'withhold',reason:'No staff role'}),e=>e.code==='permission-denied');
    await reviewContentReport(db,'review-staff',{reportId:reportSnap.id,action:'withhold',reason:'Review media'});
    assert.deepEqual((await creation.get()).data().imageUrls,['https://example.test/b']);
    assert.equal((await creation.get()).data().backupObjectKey,'keep-save');
    assert.equal((await creation.get()).data().likes,8);
    const reviewRef=db.doc(`contentReviews/${reportSnap.id}`);
    const expiry=(await reviewRef.get()).data().expiresAt.toMillis();
    await assert.rejects(reviewContentReport(db,'review-staff',{reportId:reportSnap.id,action:'dismiss',reason:'Cannot silently keep content hidden'}),e=>e.code==='failed-precondition');
    await reviewContentReport(db,'review-staff',{reportId:reportSnap.id,action:'reviewing',reason:'Reviewing retained content'});
    assert.equal((await reviewRef.get()).data().expiresAt.toMillis(),expiry);
    assert.equal((await db.doc(`users/review-author/moderationNotices/${reportSnap.id}`).get()).data().canAppeal,true);
    await assert.rejects(appealContentDecision(db,'review-reporter',{caseId:reportSnap.id,reason:'Wrong author'}),e=>e.code==='permission-denied');
    await appealContentDecision(db,'review-author',{caseId:reportSnap.id,reason:'Ordinary game image'});
    assert.equal((await db.doc(`reports/${reportSnap.id}`).get()).data().status,'appealed');
    await reviewContentReport(db,'review-staff',{reportId:reportSnap.id,action:'restore',reason:'Confirmed game screenshot'});
    assert.deepEqual((await creation.get()).data().imageUrls,['https://example.test/a','https://example.test/b']);
    assert.equal((await db.doc(`contentReviews/${reportSnap.id}`).get()).data().original,undefined);
    await assert.rejects(reviewContentReport(db,'review-staff',{reportId:reportSnap.id,action:'reviewing',reason:'Already closed'}),e=>e.code==='failed-precondition');
    await reviewContentReport(db,'review-staff',{reportId:reportSnap.id,action:'withhold',reason:'Second review'});
    await creation.update({imageUrls:['https://example.test/new']});
    await assert.rejects(reviewContentReport(db,'review-staff',{reportId:reportSnap.id,action:'restore',reason:'Would overwrite edit'}),e=>e.code==='failed-precondition');
    await removeReferences(db,'review-author');
    assert.equal((await db.doc(`contentReviews/${reportSnap.id}`).get()).exists,false);
});

test('deletion receipts expose waiting, escalation and expiry without treating missing as complete',async()=>{
    let now=1800000000000;
    const uid='receipt-timing',receipt='d'.repeat(64);
    await db.doc(`accountDeletionJobs/${uid}`).delete(); await db.doc(`accountDeletionLocks/${uid}`).delete();
    const crypto=require('node:crypto');const receiptRef=db.doc(`accountDeletionReceipts/${crypto.createHash('sha256').update(receipt).digest('hex')}`);await receiptRef.delete();
    const service=createAccountDeletionService({db,now:()=>now,auth:{getUser:async()=>({})},services:{}});
    const accepted=await service.request(uid,{receipt});
    assert.equal(accepted.earliestProcessingAt-accepted.acceptedAt,22*60000);
    assert.equal(accepted.needsAttention,false);
    now+=25*3600000;assert.equal((await service.status(receipt)).needsAttention,true);
    const {Timestamp}=req('firebase-admin/firestore');
    await receiptRef.set({state:'complete',phase:'complete',completedAt:Timestamp.fromMillis(now-31*86400000),expiresAt:Timestamp.fromMillis(now-86400000)});
    assert.equal((await service.status(receipt)).state,'expired');
    await receiptRef.delete();await assert.rejects(service.status(receipt),e=>e.code==='not-found');
});

test('collaboration deletion removes retained moderation history and author notices',async()=>{
 const {deleteCollaborationReviews}=require('../functions/contentReview');
 await db.doc('contentReviews/collab-review').set({collaborationId:'review-collab',authorId:'remaining-author',original:{text:'private'}});
 await db.doc('users/remaining-author/moderationNotices/collab-review').set({status:'withhold'});
 await db.doc('reports/collab-review').set({collaborationId:'review-collab'});
 await deleteCollaborationReviews(db,'review-collab');
 await deleteCollaborationReviews(db,'review-collab');
 for(const path of ['contentReviews/collab-review','users/remaining-author/moderationNotices/collab-review','reports/collab-review']) assert.equal((await db.doc(path).get()).exists,false);
});

test('new task snapshots use canonical authorship and cannot resurrect deleted author text',async()=>{
 const uid='snapshot-builder',author='snapshot-author',collaborationId='snapshot-collab';
 await db.doc(`users/${uid}`).set({}); await db.doc(`users/${author}`).set({});
 await db.doc(`collaborations/${collaborationId}`).set({status:'active'});
 await db.doc(`collaborations/${collaborationId}/members/${uid}`).set({role:'editor'});
 await db.doc(`collaborations/${collaborationId}/uploads/update`).set({userId:uid});
 await db.doc(`collaborations/${collaborationId}/todos/task`).set({createdBy:author,text:'Actual task'});
 const invoke=()=>endpoints.updateCollaborationChangelogEntry.run({auth:{uid,token:{}},data:{collaborationId,changelogEntryId:'update',text:'Built station',imageUrls:[],completedTodos:[{id:'task',text:'Caller supplied text',createdBy:uid}]}});
 await invoke();
 const entry=db.doc(`collaborations/${collaborationId}/uploads/update`);
 assert.deepEqual((await entry.get()).data().completedTodos,[{id:'task',text:'Actual task',createdBy:author}]);
 await db.doc(`accountDeletionLocks/${author}`).set({state:'deleting'});
 await invoke();
 assert.deepEqual((await entry.get()).data().completedTodos,[{id:'task',text:'Content removed after account deletion.',createdBy:null}]);
});
