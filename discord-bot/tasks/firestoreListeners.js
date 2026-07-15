const { admin, db } = require('../utils/firebase');
const { buildCreationEmbed } = require('../utils/embedBuilder');
const { Client } = require('discord.js');

let activeEventsCache = [];
let managingEventsCache = [];
let isInitialLoad = true;

/**
 * @param {Client} client 
 */
function initializeAllListeners(client) {
    console.log('[Tasks] Initializing all Firestore listeners...');
    
    // --- Event Cache Listener ---
    const eventsQuery = db.collection('events').where('voteEndDate', '>', new Date());
    eventsQuery.onSnapshot(snapshot => {
        activeEventsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`[Event Cache] Cache updated. Now tracking ${activeEventsCache.length} active events.`);
    }, error => console.error('[Event Cache] Listener failed:', error));

    // --- Managing-Phase Cache: beendete Events mit noch unveröffentlichten
    // Ergebnissen. Vom Event Notifier für geplantes Publishing + Ergebnis-
    // Benachrichtigungen genutzt (der aktive Cache verliert Events nach voteEndDate).
    const managingQuery = db.collection('events').where('resultsStatus', '==', 'managing');
    managingQuery.onSnapshot(snapshot => {
        managingEventsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`[Event Cache] Managing cache updated. Now tracking ${managingEventsCache.length} events.`);
    }, error => console.error('[Managing Cache] Listener failed:', error));

    // --- Creation Announcer & Unlink Listener ---
    const creationsQuery = db.collectionGroup('creations');
    creationsQuery.onSnapshot(snapshot => {
        if (isInitialLoad) {
            isInitialLoad = false;
            console.log(`[Creation Announcer] Initial data processed. Now listening for real-time changes.`);
            return; 
        }
        snapshot.docChanges().forEach(async (change) => {
            const linkDoc = change.doc;
            const linkData = linkDoc.data();

            if (change.type === 'added') {
                if (linkData.discordMessageId) return;
                console.log(`[Creation Announcer] Detected new creation link: ${linkDoc.id}`);
                try {
                    // FIX: Use path parsing for robustness instead of .parent.parent
                    const pathParts = linkDoc.ref.path.split('/');
                    if (pathParts.length < 4 || pathParts[0] !== 'communitys') {
                        console.warn(`[Creation Announcer] Document with unexpected path: ${linkDoc.ref.path}`);
                        return;
                    }
                    const communityId = pathParts[1];
                    const creationId = linkDoc.id;
                    
                    const communityDoc = await db.collection('communitys').doc(communityId).get();
                    const creationDoc = await db.collection('creations').doc(creationId).get();
                    if (!communityDoc.exists || !creationDoc.exists) return;
                    
                    const communityData = communityDoc.data();
                    const creationData = creationDoc.data();
                    let eventClass = "general";
                    if (creationData.eventIds?.length > 0) {
                        const eventId = creationData.eventIds[0];
                        const eventDoc = await db.collection('events').doc(eventId).get();
                        if (eventDoc.exists && eventDoc.data().classes?.length > 0) {
                            eventClass = eventDoc.data().classes[0];
                        }
                    }
                    
                    const channelId = communityData.discordChannelMapping?.[eventClass.toLowerCase()];
                    if (!channelId) return;

                    const includeVotes = (eventClass === "general");
                    const embed = await buildCreationEmbed(creationId, communityId, includeVotes);
                    embed.setTitle(`New Creation Added: ${embed.data.title}`);
                    const channel = await client.channels.fetch(channelId);
                    if (channel) {
                        const message = await channel.send({ embeds: [embed] });
                        await linkDoc.ref.update({ discordMessageId: message.id, discordChannelId: channel.id });
                        console.log(`[Creation Announcer] ✅ Successfully announced creation ${creationId}`);
                    }
                } catch (error) {
                    console.error(`[Creation Announcer] ❌ Failed to announce creation ${linkDoc.id}:`, error);
                }
            } else if (change.type === 'removed') {
                if (!linkData.discordMessageId || !linkData.discordChannelId) return;
                console.log(`[Creation Announcer] Detected creation unlink: ${linkDoc.id}. Deleting message...`);
                try {
                    const channel = await client.channels.fetch(linkData.discordChannelId);
                    const message = await channel.messages.fetch(linkData.discordMessageId);
                    await message.delete();
                    console.log(`[Creation Announcer] ✅ Successfully deleted message for unlinked creation ${linkDoc.id}`);
                } catch (error) {
                    console.warn(`[Creation Announcer] Could not delete message for ${linkDoc.id}: ${error.message}`);
                }
            }
        });
    }, error => console.error('[Creation Announcer] Listener failed:', error));

    // --- Vote Update & Creation Deletion Listener ---
    db.collection('creations').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async (change) => {
            const creationId = change.doc.id;
            const creationData = change.doc.data();

            if (change.type === 'modified') {
                if (creationData.eventIds?.length > 0) return;
                try {
                    // FIX: Use query on 'creationId' field (requires index)
                    const linksQuery = await db.collectionGroup('creations').where('creationId', '==', creationId).get();
                    if (linksQuery.empty) return;

                    for (const linkDoc of linksQuery.docs) {
                        const linkData = linkDoc.data();
                        if (linkData.discordMessageId && linkData.discordChannelId) {
                            const pathParts = linkDoc.ref.path.split('/');
                            if (pathParts.length < 2) continue;
                            const communityId = pathParts[1];
                            console.log(`[Vote Updater] Updating message for creation ${creationId}`);
                            const embed = await buildCreationEmbed(creationId, communityId, true);
                            const channel = await client.channels.fetch(linkData.discordChannelId);
                            const message = await channel.messages.fetch(linkData.discordMessageId);
                            await message.edit({ embeds: [embed] });
                        }
                    }
                } catch (error) {
                    console.warn(`[Vote Updater] Could not update a message for creation ${creationId}: ${error.message}`);
                }
            } else if (change.type === 'removed') {
                console.log(`[Vote Updater] Detected deletion of creation ${creationId}. Finding messages...`);
                try {
                    // FIX: Use query on 'creationId' field (requires index)
                    const linksQuery = await db.collectionGroup('creations').where('creationId', '==', creationId).get();
                    if (linksQuery.empty) return;

                    for (const linkDoc of linksQuery.docs) {
                        const linkData = linkDoc.data();
                        if (linkData.discordMessageId && linkData.discordChannelId) {
                            console.log(`[Vote Updater] Deleting message in channel ${linkData.discordChannelId}`);
                            const channel = await client.channels.fetch(linkData.discordChannelId);
                            const message = await channel.messages.fetch(linkData.discordMessageId);
                            await message.delete();
                        }
                    }
                    console.log(`[Vote Updater] ✅ Successfully deleted messages for deleted creation ${creationId}`);
                } catch (error) {
                    console.warn(`[Vote Updater] Could not delete messages for creation ${creationId}: ${error.message}`);
                }
            }
        });
    }, error => console.error('[Vote Updater] Listener failed:', error));
}

module.exports = { initializeAllListeners, getActiveEventsCache: () => activeEventsCache, getManagingEventsCache: () => managingEventsCache };