const {randomUUID} = require('node:crypto');
const {buildCreationEmbed} = require('../utils/embedBuilder');
const {assertOwnedMessage, assertCommunityGuildAccess} = require('../utils/messageOwnership');
const missing = error => [10003, 10008].includes(error.code);
const timestampMs = value => value?.toMillis?.() || 0;
async function fetchOwned(client, binding, creationId) {
    try {
        const channel = await client.channels.fetch(binding.channelId);
        const message = await channel.messages.fetch(binding.messageId);
        assertOwnedMessage(client, channel, message, binding, creationId);
        return message;
    } catch (error) { if (missing(error)) return null; throw error; }
}
async function processDelivery(client, db, ref) {
    const token = randomUUID();
    const job = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!data?.pending || timestampMs(data.leaseUntil) > Date.now()) return null;
        tx.update(ref, {leaseToken: token, leaseUntil: new Date(Date.now() + 120000)});
        return data;
    });
    if (!job) return;
    let binding = job.binding || null;
    try {
        const [communitySnap, creationSnap, linkSnap, eventSnap] = await Promise.all([
            db.doc(`communitys/${job.communityId}`).get(), db.doc(`creations/${job.creationId}`).get(),
            db.doc(`communitys/${job.communityId}/creations/${job.creationId}`).get(),
            job.eventId ? db.doc(`events/${job.eventId}`).get() : Promise.resolve(null),
        ]);
        const community = communitySnap.data() || {};
        const creation = creationSnap.data();
        const link = linkSnap.data() || {};
        const event = eventSnap?.data() || {};
        const channelId = job.kind === 'event' ? event.discordSubmissionChannelId : job.kind === 'showcase' ? community.discordShowcaseChannelId : community.discordGeneralChannelId;
        const present = !!(job.present && communitySnap.exists && creation && channelId &&
            (job.kind === 'event' ? eventSnap?.exists && (creation.eventIds || []).includes(job.eventId) :
                linkSnap.exists && (job.kind === 'showcase' ? link.showcaseVideoUrl : !(creation.eventIds || []).length)));
        let channel;
        if (present || (!binding && job.legacy)) {
            channel = await client.channels.fetch(present ? channelId : job.legacy.channelId);
            await assertCommunityGuildAccess(client, db, community, channel);
        }
        if (!binding && job.legacy) {
            const candidate = {...job.legacy, guildId: community.discordServerId};
            const message = await fetchOwned(client, candidate, job.creationId);
            if (message) binding = candidate;
        }
        if (binding && (!present || binding.channelId !== channelId || binding.guildId !== community.discordServerId)) {
            const oldMessage = await fetchOwned(client, binding, job.creationId);
            if (oldMessage) await oldMessage.delete();
            binding = null;
            await ref.update({binding: null, sendingSince: null, legacy: null});
        }
        if (present) {
            let message = binding ? await fetchOwned(client, binding, job.creationId) : null;
            // A crashed send can have succeeded. Recover by a stable bot-owned footer first.
            if (!message && job.sendingSince) {
                const recent = await channel.messages.fetch({limit: 100});
                message = recent.find(m => m.author?.id === client.user.id && m.embeds?.some(e => e.footer?.text === `PlanetCreations:${ref.id}`));
                if (!message) throw Object.assign(new Error('An earlier send has an uncertain outcome; review channel history before retrying.'), {needsReview: true});
                assertOwnedMessage(client, channel, message, {guildId: community.discordServerId, channelId}, job.creationId);
            }
            const embed = await buildCreationEmbed(job.creationId, job.communityId, job.kind === 'general', {communityData: community, creationData: creation});
            if (job.kind === 'showcase') embed.setTitle(`🌟 New Showcase: ${embed.data.title}`.slice(0, 256));
            if (job.kind === 'event') embed.setTitle(`📥 New submission for "${event.title}": ${embed.data.title}`.slice(0, 256));
            embed.setFooter({text: `PlanetCreations:${ref.id}`});
            const payload = {content: job.kind === 'showcase' ? link.showcaseVideoUrl || '' : '', embeds: [embed], allowedMentions: {parse: []}};
            if (message) await message.edit(payload);
            else {
                await ref.update({sendingSince: new Date()});
                message = await channel.send(payload);
            }
            binding = {messageId: message.id, channelId: channel.id, guildId: channel.guildId};
        }
        await db.runTransaction(async tx => {
            const latest = await tx.get(ref);
            if (latest.data()?.leaseToken !== token) return;
            tx.update(ref, {binding, legacy: null, sendingSince: null, leaseUntil: null, leaseToken: null,
                pending: latest.data().revision !== job.revision, status: 'delivered', lastError: null});
        });
    } catch (error) {
        await db.runTransaction(async tx => {
            const latest = await tx.get(ref);
            if (latest.data()?.leaseToken !== token) return;
            tx.update(ref, {binding, leaseUntil: null, leaseToken: null, pending: !error.needsReview,
                status: error.needsReview ? 'needs-review' : 'retry', retryAt: new Date(Date.now() + 60000), lastError: String(error.message).slice(0, 300)});
        });
    }
}
function startDeliveryListener(client, db) {
    const jobs = new Map();
    let running = false;
    const coalesceMs = process.env.DISCORD_COALESCE_UPDATES === 'true' ? 45000 : 0;
    const unsubscribe = db.collection('discordDeliveries').where('pending', '==', true).onSnapshot(snapshot => {
        for (const change of snapshot.docChanges()) {
            if (change.type === 'removed') jobs.delete(change.doc.id);
            else jobs.set(change.doc.id, change.doc);
        }
    }, error => console.error('[Discord delivery] Listener failed:', error.message));
    const timer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
            for (const doc of [...jobs.values()]) {
                const job = doc.data();
                if (timestampMs(job.retryAt) > Date.now() || timestampMs(job.leaseUntil) > Date.now()) continue;
                if (job.present && job.binding && timestampMs(job.updatedAt) + coalesceMs > Date.now()) continue;
                await processDelivery(client, db, doc.ref);
            }
        } catch (error) { console.error('[Discord delivery]', error.message); }
        finally { running = false; }
    }, 1000);
    timer.unref();
    return () => { clearInterval(timer); unsubscribe(); };
}
module.exports = {processDelivery, startDeliveryListener, fetchOwned};
