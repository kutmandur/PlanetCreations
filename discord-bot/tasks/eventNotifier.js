const cron = require('node-cron');
const { getActiveEventsCache } = require('./firestoreListeners');
const { db, admin } = require('../utils/firebase');
const { notifyCommunityEvent } = require('../utils/notify');
const { EmbedBuilder, Client } = require('discord.js');

/**
 * @param {Client} client 
 */
function startEventNotifier(client) {
    console.log('[Tasks] Starting Event Notifier (Cron Job)...');
    
    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);
        const activeEvents = getActiveEventsCache();

        const parseReminder = (reminderString) => {
            if (!reminderString || typeof reminderString !== 'string' || reminderString.length < 2) return 0;
            const unit = reminderString.slice(-1);
            const value = parseInt(reminderString.slice(0, -1), 10);
            if (isNaN(value)) return 0;
            switch (unit) {
                case 'm': return value * 60 * 1000;
                case 'h': return value * 60 * 60 * 1000;
                case 'd': return value * 24 * 60 * 60 * 1000;
                default: return 0;
            }
        };

        try {
            for (const event of activeEvents) {
                const eventDocRef = db.collection('events').doc(event.id);
                const communityDoc = await db.collection('communitys').doc(event.communityId).get();
                if (!communityDoc.exists) continue;

                const community = communityDoc.data();
                const eventClass = event.classes?.[0] || 'general';
                const channelId = community.discordChannelMapping?.[eventClass.toLowerCase()];
                if (!channelId) continue;
                
                let channel;
                try {
                    channel = await client.channels.fetch(channelId);
                } catch (error) { continue; }
                if (!channel) continue;
                
                const startDate = event.startDate.toDate();
                if (startDate >= now && startDate < oneMinuteFromNow && !event.notificationsSent?.start) {
                    console.log(`[Event Notifier] Sending START for: ${event.title}`);
                    const startEmbed = new EmbedBuilder().setColor(community.themeColor || '#5865F2').setTitle(`🎉 Event Started: ${event.title}`).setURL(`https://planetcreations.net/event/${event.id}`).setDescription(event.description ? event.description.substring(0, 500) : 'The event has now begun!').setTimestamp(startDate);
                    if (event.bannerImageUrl) startEmbed.setImage(event.bannerImageUrl);
                    await channel.send({ embeds: [startEmbed] });
                    await notifyCommunityEvent(event.communityId, { title: `Event started: ${event.title}`, message: event.description ? String(event.description).slice(0, 140) : 'The event has now begun!', link: `/event/${event.id}` });
                    await eventDocRef.update({ 'notificationsSent.start': true });
                }
                
                if (event.reminders?.length > 0) {
                    for (const reminderType of event.reminders) {
                        if (event.sentReminders?.includes(reminderType)) continue;
                        const reminderTimeMs = parseReminder(reminderType);
                        const reminderFireTime = new Date(event.endDate.toDate().getTime() - reminderTimeMs);
                        if (reminderTimeMs > 0 && reminderFireTime >= now && reminderFireTime < oneMinuteFromNow) {
                            console.log(`[Event Notifier] Sending SUBMISSION REMINDER for: ${event.title}`);
                            const timeValue = reminderType.slice(0, -1);
                            const timeUnit = reminderType.slice(-1) === 'd' ? 'day(s)' : (reminderType.slice(-1) === 'h' ? 'hour(s)' : 'minute(s)');
                            const message = `⏳ Reminder: Submissions for the event **${event.title}** ends in ${timeValue} ${timeUnit}!`;
                            await channel.send(message);
                            await notifyCommunityEvent(event.communityId, { title: `Reminder: ${event.title}`, message: `Submissions end in ${timeValue} ${timeUnit}.`, link: `/event/${event.id}` });
                            await eventDocRef.update({ sentReminders: admin.firestore.FieldValue.arrayUnion(reminderType) });
                        }
                    }
                }

                const endDate = event.endDate.toDate();
                if(endDate >= now && endDate < oneMinuteFromNow && !event.notificationsSent?.end) {
                    console.log(`[Event Notifier] Sending SUBMISSION END for: ${event.title}`);
                    const message = event.separateVoteTime ? `🛑 The submission period for **${event.title}** has now ended! Don't forget to vote on your favorite entries.` : `🏁 The event **${event.title}** has now ended! Thanks to everyone who participated.`;
                    await channel.send(message);
                    await notifyCommunityEvent(event.communityId, { title: event.separateVoteTime ? `Submissions closed: ${event.title}` : `Event ended: ${event.title}`, message: event.separateVoteTime ? 'Submissions are closed — time to vote!' : 'Thanks to everyone who participated.', link: `/event/${event.id}` });
                    await eventDocRef.update({ 'notificationsSent.end': true });
                }

                if (event.separateVoteTime && event.voteReminders?.length > 0) {
                    for (const reminderType of event.voteReminders) {
                        if (event.sentVoteReminders?.includes(reminderType)) continue;
                        const reminderTimeMs = parseReminder(reminderType);
                        const reminderFireTime = new Date(event.voteEndDate.toDate().getTime() - reminderTimeMs);
                        if (reminderTimeMs > 0 && reminderFireTime >= now && reminderFireTime < oneMinuteFromNow) {
                            console.log(`[Event Notifier] Sending VOTING REMINDER for: ${event.title}`);
                            const timeValue = reminderType.slice(0, -1);
                            const timeUnit = reminderType.slice(-1) === 'd' ? 'day(s)' : (reminderType.slice(-1) === 'h' ? 'hour(s)' : 'minute(s)');
                            const message = `⏳ Reminder: Voting for the event **${event.title}** ends in ${timeValue} ${timeUnit}!`;
                            await channel.send(message);
                            await notifyCommunityEvent(event.communityId, { title: `Voting reminder: ${event.title}`, message: `Voting ends in ${timeValue} ${timeUnit}.`, link: `/event/${event.id}` });
                            await eventDocRef.update({ sentVoteReminders: admin.firestore.FieldValue.arrayUnion(reminderType) });
                        }
                    }
                }

                const voteEndDate = event.voteEndDate.toDate();
                if(event.separateVoteTime && voteEndDate >= now && voteEndDate < oneMinuteFromNow && !event.notificationsSent?.voteEnd) {
                    console.log(`[Event Notifier] Sending VOTE END for: ${event.title}`);
                    await channel.send(`🏁 Voting for **${event.title}** has now ended! Thanks to everyone who voted.`);
                    await notifyCommunityEvent(event.communityId, { title: `Voting ended: ${event.title}`, message: 'Thanks to everyone who voted.', link: `/event/${event.id}` });
                    await eventDocRef.update({ 'notificationsSent.voteEnd': true });
                }
            }
        } catch (error) {
            console.error("[Event Notifier] Error during minutely check:", error);
        }
    });
}

module.exports = { startEventNotifier };