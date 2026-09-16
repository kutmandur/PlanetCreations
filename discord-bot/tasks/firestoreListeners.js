const { db } = require('../utils/firebase');
const {startDeliveryListener} = require('./discordDeliveries');
const { Client } = require('discord.js');

let activeEventsCache = [];
let managingEventsCache = [];


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

    return startDeliveryListener(client, db);
}

module.exports = { initializeAllListeners, getActiveEventsCache: () => activeEventsCache, getManagingEventsCache: () => managingEventsCache };