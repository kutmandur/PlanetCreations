/* Explicit project, dry-run default. Run after a database export and closed vote rules. */
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {migrateEventVotes} = require('../securityMigration');
const {enqueueDelivery} = require('../discordDelivery');
const {getEffectiveCommunityPermissionKeys} = require('../communityMembership');
async function runMigration({db, mode = 'events', apply = false, eventId, jobId, log = console.log}) {
    if (mode === 'events') {
        const events = eventId ? [await db.doc(`events/${eventId}`).get()] : (await db.collection('events').get()).docs;
        for (const event of events) log(JSON.stringify(await migrateEventVotes(db, event.id, {apply})));
    } else if (mode === 'discord' || mode === 'permissions') {
        for (const community of (await db.collection('communitys').get()).docs) {
            if (mode === 'permissions') {
                for (const member of (await community.ref.collection('members').get()).docs) {
                    const perms = getEffectiveCommunityPermissionKeys(community.data(), member.data());
                    if (JSON.stringify(perms) === JSON.stringify(member.data().perms || [])) continue;
                    log(JSON.stringify({path: member.ref.path, perms, apply}));
                    if (apply) await member.ref.update({perms});
                }
                continue;
            }
            for (const link of (await community.ref.collection('creations').get()).docs) for (const kind of ['general', 'showcase']) {
                const data = link.data();
                const messageId = kind === 'general' ? data.discordMessageId : data.discordShowcaseMessageId;
                const channelId = kind === 'general' ? data.discordChannelId : data.discordShowcaseChannelId;
                // No marker means no historical proof of a sent post. Do not spam old creations.
                if (!messageId || !channelId) continue;
                const job = {communityId: community.id, creationId: link.id, kind, legacy: {messageId, channelId}};
                log(JSON.stringify({...job, apply}));
                if (apply) await enqueueDelivery(db, job);
            }
        }
        if (mode === 'discord') for (const event of (await db.collection('events').get()).docs) {
            const data = event.data();
            for (const [creationId, messageId] of Object.entries(data.autoPostedSubmissions || {})) {
                if (!data.communityId || !data.discordSubmissionChannelId) continue;
                const job = {communityId: data.communityId, creationId, eventId: event.id, kind: 'event', legacy: {messageId, channelId: data.discordSubmissionChannelId}};
                log(JSON.stringify({...job, apply}));
                if (apply) await enqueueDelivery(db, job);
            }
        }
    } else if (mode === 'retry-discord') {
        const id = jobId; if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Specify --job=DELIVERY_ID.');
        const ref = db.doc(`discordDeliveries/${id}`); const snap = await ref.get();
        if (!snap.exists) throw new Error('Delivery not found.');
        log(JSON.stringify({job: id, status: snap.data().status, apply}));
        if (apply) await ref.update({pending: true, retryAt: null});
    } else if (mode === 'manifests') {
        const {INDEX_FAMILIES} = require('../scalableMapIndex');
        const {randomUUID} = require('node:crypto');
        for (const family of Object.values(INDEX_FAMILIES)) for (const state of (await db.collection(family.states).get()).docs) {
            for (const shardId of state.data().shardIds || []) {
                const shardRef = db.doc(`${family.shards}/${shardId}`);
                if (!apply) {
                    const shard = await shardRef.get();
                    log(JSON.stringify({state: state.ref.path, shardId, missing: !shard.exists, needsRevision: !shard.data()?.r, apply}));
                    continue;
                }
                await db.runTransaction(async tx => {
                    const [current, shard] = await Promise.all([tx.get(state.ref), tx.get(shardRef)]);
                    if (!current.exists || !shard.exists || !(current.data().shardIds || []).includes(shardId)) return;
                    const revision = shard.data().r || randomUUID();
                    if (current.data().revisions?.[shardId] === revision) return;
                    const revisions = {...(current.data().revisions || {}), [shardId]: revision};
                    if (Buffer.byteLength(JSON.stringify(revisions)) >= 200 * 1024) throw new Error('Manifest requires partitioning; full-index reader remains supported.');
                    if (!shard.data().r) tx.update(shardRef, {r: revision});
                    tx.update(state.ref, {revisions});
                });
            }
        }
    } else if (mode === 'counters') {
        for (const creation of (await db.collection('creations').get()).docs) {
            const votes = await creation.ref.collection('votes').get();
            const counts = {like: 0, dislike: 0, event_vote: 0};
            for (const vote of votes.docs) if (Object.hasOwn(counts, vote.data().type)) counts[vote.data().type]++;
            const reports = await db.collection('reports').where('targetId', '==', creation.id).get();
            const sourceReports = reports.docs.filter(report => report.data().targetType === 'creation').length;
            if (creation.data().likes !== counts.like || creation.data().dislikes !== counts.dislike || (creation.data().reportCount || 0) !== sourceReports) {
                log(JSON.stringify({creationId: creation.id, stored: {likes: creation.data().likes, dislikes: creation.data().dislikes, reports: creation.data().reportCount || 0}, source: {...counts, reports: sourceReports}, apply: false, reason: 'Review historical overwritten/deleted evidence before correction.'}));
            }
        }
    } else if (mode === 'followers') {
        const profiles = await db.collection('profiles').get();
        const byId = new Map(profiles.docs.map(doc => [doc.id, doc]));
        for (const profile of profiles.docs) {
            const followers = [...new Set(profile.data().followers || [])];
            const inconsistent = followers.filter(uid => !byId.get(uid)?.data()?.following?.includes(profile.id));
            // Report only: historical inconsistency is not proof of which user intended a change.
            if (inconsistent.length || followers.length !== (profile.data().followers || []).length) log(JSON.stringify({profile: profile.id, inconsistent, duplicates: (profile.data().followers || []).length - followers.length, apply: false}));
        }
    } else throw new Error('Unknown migration mode.');
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const option = name => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    const projectId = option('--project');
    const apply = args.includes('--apply');
    if (!projectId || (apply && option('--confirm-project') !== projectId)) throw new Error('Specify --project=ID. Apply also requires --apply --confirm-project=ID.');
    initializeApp({projectId});
    runMigration({db: getFirestore(), mode: option('--mode') || 'events', apply, eventId: option('--event'), jobId: option('--job')})
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {runMigration};
