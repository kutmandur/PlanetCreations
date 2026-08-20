const { Events, ActivityType } = require('discord.js');
const { initializeAllListeners } = require('../tasks/firestoreListeners');
const { startEventNotifier } = require('../tasks/eventNotifier');
const { startStreamChatBots } = require('../tasks/streamChatBots');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client, db) {
        console.log(`✅ Logged in as ${client.user.tag}! The bot is online and ready.`);
        client.user.setActivity('creations on PlanetCreations.net', { type: ActivityType.Watching });
        
        // Start all background tasks
        initializeAllListeners(client);
        startEventNotifier(client);
        startStreamChatBots(db);
    },
};
