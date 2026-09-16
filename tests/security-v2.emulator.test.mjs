import assert from 'node:assert/strict';
import {before, beforeEach, after, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch} from 'firebase/firestore';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const {initializeApp, deleteApp} = require('firebase-admin/app');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const {setEventVote, voteShard} = require('./eventVoting');
const {setCreationReaction} = require('./creationReactions');
const {recordCreationView, publishViewTotals} = require('./creationViews');
const {migrateEventVotes, removeBallot} = require('./securityMigration');
const {enqueueDelivery, enqueueCreationDeliveries} = require('./discordDelivery');
const projectId = 'demo-planetcreations-rules';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production.');
let env, app, db;
const creation = {title: 'A park', game: 'planet-coaster-2', category: 'Parks', userId: 'owner', tags: ['park'], likes: 0, dislikes: 0, views: 0};
const client = uid => env.authenticatedContext(uid).firestore();
before(async () => {
    env = await initializeTestEnvironment({projectId, firestore: {rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')}});
    app = initializeApp({projectId}); db = getFirestore(app);
});
beforeEach(async () => {
    await env.clearFirestore();
    await Promise.all([
        db.doc('communitys/community').set({name: 'Community', ownerId: 'owner', discordServerId: 'guild', discordGeneralChannelId: 'channel'}),
        db.doc('communitys/community/members/member').set({roles: ['member'], perms: ['addCreations', 'participateEvents']}),
        db.doc('profiles/owner').set({username: 'Owner', followers: ['existing'], following: []}),
        db.doc('profiles/member').set({username: 'Member', followers: [], following: []}),
        db.doc('creations/park').set({...creation, eventIds: ['event', 'second']}),
        db.doc('creations/other').set({...creation, eventIds: ['event']}),
        db.doc('creations/not-submitted').set(creation),
        db.doc('events/event').set({communityId: 'community', voteSchemaVersion: 2, voteType: 'single', voteStartDate: Timestamp.fromMillis(Date.now() - 60000), voteEndDate: Timestamp.fromMillis(Date.now() + 60000)}),
        db.doc('events/second').set({communityId: 'community', voteSchemaVersion: 2, voteType: 'single', voteStartDate: Timestamp.fromMillis(Date.now() - 60000), voteEndDate: Timestamp.fromMillis(Date.now() + 60000)}),
        db.doc('collaborations/collab').set({ownerId: 'owner', memberIds: ['owner', 'member'], status: 'active'}),
        db.doc('collaborations/collab/members/member').set({role: 'editor'}),
    ]);
});
after(async () => { await env.cleanup(); await deleteApp(app); });
test('creation payloads preserve editing while all client roles cannot forge counters', async () => {
    await assertSucceeds(setDoc(doc(client('owner'), 'creations/new'), creation));
    await assertSucceeds(updateDoc(doc(client('owner'), 'creations/new'), {title: 'Renamed park'}));
    for (const key of ['likes', 'dislikes', 'views', 'reportCount', 'activityScore']) {
        await assertFails(setDoc(doc(client('owner'), `creations/forged-${key}`), {...creation, [key]: 10}));
        await assertFails(updateDoc(doc(client('owner'), 'creations/new'), {[key]: 10}));
        await assertFails(updateDoc(doc(env.authenticatedContext('mod', {role: 'moderator'}).firestore(), 'creations/new'), {[key]: 10}));
    }
    await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'creations/new'), {views: 1}));
});
test('follows keep two-write batches and cannot replace anybody else or owner recipient lists', async () => {
    const memberDb = client('member');
    const batch = writeBatch(memberDb);
    batch.update(doc(memberDb, 'profiles/member'), {following: ['owner']});
    batch.update(doc(memberDb, 'profiles/owner'), {followers: ['existing', 'member']});
    await assertSucceeds(batch.commit());
    await assertFails(updateDoc(doc(client('member'), 'profiles/owner'), {followers: ['member', 'victim']}));
    await assertFails(updateDoc(doc(client('owner'), 'profiles/owner'), {followers: ['victim']}));
    await assertFails(updateDoc(doc(client('member'), 'profiles/owner'), {followers: ['existing', 'member', 'member']}));
    await assertSucceeds(updateDoc(doc(client('member'), 'profiles/owner'), {followers: ['existing']}));
    await assertFails(deleteDoc(doc(client('owner'), 'profiles/owner')));
});
test('Discord markers cannot be injected, edited or restored by recreation; member roles still apply', async () => {
    await db.doc('creations/own').set({...creation, userId: 'member'});
    const link = doc(client('member'), 'communitys/community/creations/own');
    await assertSucceeds(setDoc(link, {userId: 'member', creationId: 'own', linkedAt: 1}));
    await assertFails(updateDoc(link, {discordMessageId: 'victim', discordChannelId: 'foreign'}));
    await assertSucceeds(deleteDoc(link));
    await assertFails(setDoc(link, {userId: 'member', creationId: 'own', discordMessageId: 'victim'}));
    await assertFails(setDoc(doc(client('member'), 'communitys/community/creations/park'), {userId: 'member', creationId: 'park'}));
    await db.doc('communitys/community/members/member').update({perms: []});
    await assertFails(setDoc(link, {userId: 'member', creationId: 'own'}));
    await assertFails(setDoc(doc(client('owner'), 'discordDeliveries/forged'), {pending: true}));
});
test('comments and work sessions bind authors and immutable creation data', async () => {
    const comment = doc(client('member'), 'collaborations/collab/comments/comment');
    await assertFails(setDoc(comment, {authorId: 'owner', content: 'Forged'}));
    await assertSucceeds(setDoc(comment, {authorId: 'member', content: 'Hello', createdAt: 1}));
    await assertSucceeds(updateDoc(comment, {content: 'Edited', updatedAt: 2}));
    await assertFails(updateDoc(comment, {authorId: 'owner'}));
    await assertFails(setDoc(doc(client('member'), 'collaborations/collab/workSessions/forged'), {userId: 'owner', note: 'Forged'}));
    await assertSucceeds(setDoc(doc(client('member'), 'collaborations/collab/workSessions/own'), {userId: 'member', note: 'Built a park'}));
});
test('inbox deduplication ledger survives clearing items and cannot be forged or deleted', async () => {
    await db.doc('users/member/meta/inbox').set({items: [], deliveries: {event: 1}});
    await assertSucceeds(updateDoc(doc(client('member'), 'users/member/meta/inbox'), {items: [], unreadCount: 0}));
    await assertFails(updateDoc(doc(client('member'), 'users/member/meta/inbox'), {deliveries: {}}));
    await assertFails(deleteDoc(doc(client('member'), 'users/member/meta/inbox')));
});
test('event vote retries, concurrent tabs, ranks, phase and participation are server enforced', async () => {
    const input = {eventId: 'event', creationId: 'park', selected: true, revision: 0};
    const first = await setEventVote(db, 'member', input);
    assert.equal(first.revision, 1);
    await setEventVote(db, 'member', input);
    assert.equal((await db.doc(`events/event/voteTotals/${voteShard('park')}`).get()).data().counts.park, 1);
    await assert.rejects(setEventVote(db, 'member', {...input, creationId: 'other', revision: 0}), {code: 'aborted'});
    await assert.rejects(setEventVote(db, 'member', {...input, creationId: 'other', revision: 1}), {code: 'failed-precondition'});
    await assert.rejects(setEventVote(db, 'member', {...input, creationId: 'not-submitted', revision: 1}), {code: 'failed-precondition'});
    await assert.rejects(setEventVote(db, 'outsider', input), {code: 'permission-denied'});
    await assert.rejects(setEventVote(db, 'member', {...input, selected: false, revision: 1}, 'user', Date.now() + 120000), {code: 'failed-precondition'});
    await setEventVote(db, 'member', {...input, selected: false, revision: 1});
    assert.equal((await db.doc(`events/event/voteTotals/${voteShard('park')}`).get()).data().counts.park, 0);
    await assertFails(setDoc(doc(client('member'), 'events/event/ballots/member'), {creationIds: ['park']}));
    await assertFails(setDoc(doc(client('member'), 'creations/park/votes/member'), {type: 'event_vote'}));
    await assertFails(getDoc(doc(client('outsider'), 'events/event/ballots/member')));
});
test('likes coexist with two events and preserve idempotent desired state', async () => {
    for (const eventId of ['event', 'second']) await setEventVote(db, 'member', {eventId, creationId: 'park', selected: true, revision: 0});
    const reaction = {creationId: 'park', voteType: 'like', selected: true, revision: 0};
    await setCreationReaction(db, 'member', reaction);
    await setCreationReaction(db, 'member', reaction);
    assert.equal((await db.doc('creations/park').get()).data().likes, 1);
    await setCreationReaction(db, 'member', {...reaction, voteType: 'dislike', revision: 1});
    assert.equal((await db.doc('creations/park').get()).data().likes, 0);
    assert.equal((await db.doc('creations/park').get()).data().dislikes, 1);
    await assert.rejects(setCreationReaction(db, 'member', {...reaction, selected: false}), {code: 'aborted'});
    assert.deepEqual((await db.doc('events/second/ballots/member').get()).data().creationIds, ['park']);
});
test('parallel votes respect the single limit and migration preserves historical totals', async () => {
    const results = await Promise.allSettled(['park', 'other'].map(creationId => setEventVote(db, 'member', {eventId: 'event', creationId, selected: true, revision: 0})));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    await db.doc('events/legacy').set({communityId: 'community', voteType: 'single'});
    await db.doc('creations/park/votes/legacy-user').set({type: 'event_vote', userId: 'legacy-user', eventId: 'legacy'});
    const dryRun = await migrateEventVotes(db, 'legacy'); assert.equal(dryRun.votes, 1);
    assert.equal((await db.doc('events/legacy/ballots/legacy-user').get()).exists, false);
    await migrateEventVotes(db, 'legacy', {apply: true});
    await migrateEventVotes(db, 'legacy', {apply: true});
    assert.deepEqual((await db.doc('events/legacy/ballots/legacy-user').get()).data().creationIds, ['park']);
    assert.equal((await db.doc('creations/park/votes/legacy-user').get()).exists, false);
    await removeBallot(db, db.doc('events/legacy/ballots/legacy-user'));
    assert.equal((await db.doc(`events/legacy/voteTotals/${voteShard('park')}`).get()).data().counts.park, 1, 'closed-event aggregate remains anonymized');
});
test('anonymous views deduplicate and optionally batch publication without losing existing totals', async () => {
    await db.doc('creations/park').update({views: 25});
    const input = {creationId: 'park', sessionToken: 'a'.repeat(64)};
    await recordCreationView(db, input, 'test-ip', {aggregate: true});
    assert.equal((await recordCreationView(db, input, 'test-ip', {aggregate: true})).counted, false);
    assert.equal((await db.doc('creations/park').get()).data().views, 25);
    await publishViewTotals(db); await publishViewTotals(db);
    assert.equal((await db.doc('creations/park').get()).data().views, 26);
    await recordCreationView(db, {...input, sessionToken: 'b'.repeat(64)}, 'test-ip');
    assert.equal((await db.doc('creations/park').get()).data().views, 27);
    await recordCreationView(db, {...input, sessionToken: 'c'.repeat(64)}, 'test-ip', {aggregate: true});
    await recordCreationView(db, {...input, sessionToken: 'd'.repeat(64)}, 'test-ip');
    await publishViewTotals(db);
    assert.equal((await db.doc('creations/park').get()).data().views, 29, 'rolling flag changes preserve pending and direct views');
});
test('Discord queue ignores views, coalesces revisions and survives link deletion/reordered triggers', async () => {
    await db.doc('creations/park').update({eventIds: []});
    await db.doc('communitys/community/creations/park').set({creationId: 'park', userId: 'owner'});
    const target = {communityId: 'community', creationId: 'park'};
    await enqueueDelivery(db, target); await enqueueDelivery(db, target);
    let jobs = await db.collection('discordDeliveries').get();
    assert.equal(jobs.size, 1); assert.equal(jobs.docs[0].data().revision, 1);
    await enqueueCreationDeliveries(db, 'park', {...creation, views: 1}, {...creation, views: 2});
    assert.equal((await jobs.docs[0].ref.get()).data().revision, 1);
    await db.doc('communitys/community/creations/park').delete();
    await enqueueDelivery(db, target); await enqueueDelivery(db, target);
    const deleted = (await jobs.docs[0].ref.get()).data();
    assert.equal(deleted.present, false); assert.equal(deleted.pending, true); assert.equal(deleted.revision, 2);
});

test('Discord enqueue retains legacy evidence even before the migration has run', async () => {
    await db.doc('creations/park').update({eventIds: []});
    await db.doc('communitys/community/creations/park').set({creationId: 'park', userId: 'owner', discordMessageId: 'old-message', discordChannelId: 'old-channel'});
    const target = {communityId: 'community', creationId: 'park'};
    await enqueueDelivery(db, target);
    await enqueueDelivery(db, target);
    const job = (await db.collection('discordDeliveries').get()).docs[0].data();
    assert.deepEqual(job.legacy, {messageId: 'old-message', channelId: 'old-channel'});
    assert.equal(job.revision, 1);
});

test('report and notification retries produce one durable result', async () => {
    const {countReport} = require('./reportCounts');
    const {notifyUser} = require('./notify');
    const ref = db.doc('reports/report');
    await ref.set({targetId: 'park', targetType: 'creation'});
    const snap = await ref.get();
    await Promise.all([countReport(db, snap), countReport(db, snap)]);
    assert.equal((await db.doc('creations/park').get()).data().reportCount, 1);
    await Promise.all([1, 2, 3].map(() => notifyUser('member', 'newCreation', {eventKey: 'stable-trigger', title: 'New park', link: '/creation/park'})));
    const inbox = (await db.doc('users/member/meta/inbox').get()).data();
    assert.equal(inbox.items.length, 1);
    await db.doc('users/member/meta/inbox').update({items: [], unreadCount: 0});
    await notifyUser('member', 'newCreation', {eventKey: 'stable-trigger', title: 'New park', link: '/creation/park'});
    assert.equal((await db.doc('users/member/meta/inbox').get()).data().items.length, 0);
    // Firestore map ordering is not insertion ordering. Keep the full ledger check
    // before eviction so a retry of its oldest entry cannot become a new message.
    const stableId = Object.keys(inbox.deliveries)[0];
    const deliveries = Object.fromEntries(Array.from({length: 511}, (_, i) => [`other-${i}`, Date.now()]));
    deliveries[stableId] = Date.now() - 1000;
    await db.doc('users/member/meta/inbox').update({deliveries});
    await notifyUser('member', 'newCreation', {eventKey: 'stable-trigger', title: 'New park', link: '/creation/park'});
    assert.equal((await db.doc('users/member/meta/inbox').get()).data().items.length, 0);
});

test('activity uses source time so late and reordered retries cannot inflate its daily bonus', async () => {
    const {recordCreationActivity} = require('./activityScore');
    const ref = db.doc('creations/park');
    const before = await ref.get();
    await ref.update({changelog: [{text: 'Updated park'}]});
    const after = await ref.get();
    const change = {before, after};
    await recordCreationActivity(db, change);
    assert.equal((await ref.get()).data().activityScore, 1);
    await recordCreationActivity(db, change);
    assert.equal((await ref.get()).data().activityScore, 1);
    await ref.update({activityScore: 3, activityAt: Timestamp.fromMillis(after.updateTime.toMillis() + 86400000)});
    await recordCreationActivity(db, change);
    assert.equal((await ref.get()).data().activityScore, 3, 'older source events cannot replace newer activity');
});
