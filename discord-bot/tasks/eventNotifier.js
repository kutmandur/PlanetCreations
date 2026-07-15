const cron = require('node-cron');
const { getActiveEventsCache, getManagingEventsCache } = require('./firestoreListeners');
const { db, admin } = require('../utils/firebase');
const { notifyCommunityEvent, notifyUser } = require('../utils/notify');
const { EmbedBuilder, Client } = require('discord.js');

const SITE_ORIGIN = 'https://planetcreations.net';

// Kanalwahl des Veranstalters: 'both' (Default) | 'discord' | 'site' | 'none'
function resolveChannels(event) {
    const rc = event.reminderChannels || 'both';
    return {
        wantDiscord: rc === 'both' || rc === 'discord',
        wantSite: rc === 'both' || rc === 'site',
    };
}

// Custom-Notification-Template anwenden (Platzhalter: {eventName}, {eventLink},
// {timeRemaining}); leeres Template → Fallback-Text.
function applyTemplate(event, key, vars, fallback) {
    const tpl = event.notificationTemplates?.[key];
    if (!tpl || !String(tpl).trim()) return fallback;
    return String(tpl)
        .replace(/\{eventName\}/g, vars.eventName || '')
        .replace(/\{eventLink\}/g, vars.eventLink || '')
        .replace(/\{timeRemaining\}/g, vars.timeRemaining || '');
}

/**
 * @param {Client} client
 */
function startEventNotifier(client) {
    console.log('[Tasks] Starting Event Notifier (Cron Job)...');

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

    // Discord-Channel der Community für das Event auflösen (null = keiner gemappt)
    const resolveDiscordChannel = async (event, community) => {
        const eventClass = event.classes?.[0] || 'general';
        const channelId = community.discordChannelMapping?.[eventClass.toLowerCase()];
        if (!channelId) return null;
        try {
            return await client.channels.fetch(channelId);
        } catch (error) { return null; }
    };

    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);
        const activeEvents = getActiveEventsCache();

        try {
            for (const event of activeEvents) {
                const { wantDiscord, wantSite } = resolveChannels(event);
                const votingEnabled = event.votingEnabled !== false;
                const eventDocRef = db.collection('events').doc(event.id);
                const communityDoc = await db.collection('communitys').doc(event.communityId).get();
                if (!communityDoc.exists) continue;
                const community = communityDoc.data();

                // Kein Discord-Channel darf Site-Benachrichtigungen nicht mehr blockieren.
                const channel = wantDiscord ? await resolveDiscordChannel(event, community) : null;

                const eventLink = `${SITE_ORIGIN}/#/event/${event.id}`;
                const vars = { eventName: event.title, eventLink };

                const startDate = event.startDate.toDate();
                if (startDate >= now && startDate < oneMinuteFromNow && !event.notificationsSent?.start) {
                    console.log(`[Event Notifier] Sending START for: ${event.title}`);
                    const customText = applyTemplate(event, 'eventStart', vars, null);
                    if (channel) {
                        const startEmbed = new EmbedBuilder().setColor(community.themeColor || '#5865F2').setTitle(`🎉 Event Started: ${event.title}`).setURL(`https://planetcreations.net/event/${event.id}`).setDescription(customText || (event.description ? event.description.substring(0, 500) : 'The event has now begun!')).setTimestamp(startDate);
                        if (event.bannerImageUrl) startEmbed.setImage(event.bannerImageUrl);
                        await channel.send({ embeds: [startEmbed] });
                    }
                    if (wantSite) {
                        await notifyCommunityEvent(event.communityId, { title: `Event started: ${event.title}`, message: customText || (event.description ? String(event.description).slice(0, 140) : 'The event has now begun!'), link: `/event/${event.id}` });
                    }
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
                            const timeRemaining = `${timeValue} ${timeUnit}`;
                            const customText = applyTemplate(event, 'submissionReminder', { ...vars, timeRemaining }, null);
                            if (channel) {
                                await channel.send(customText || `⏳ Reminder: Submissions for the event **${event.title}** ends in ${timeRemaining}!`);
                            }
                            if (wantSite) {
                                await notifyCommunityEvent(event.communityId, { title: `Reminder: ${event.title}`, message: customText || `Submissions end in ${timeRemaining}.`, link: `/event/${event.id}` });
                            }
                            await eventDocRef.update({ sentReminders: admin.firestore.FieldValue.arrayUnion(reminderType) });
                        }
                    }
                }

                const endDate = event.endDate.toDate();
                if (endDate >= now && endDate < oneMinuteFromNow && !event.notificationsSent?.end) {
                    console.log(`[Event Notifier] Sending SUBMISSION END for: ${event.title}`);
                    const hasVotePhase = votingEnabled && event.separateVoteTime;
                    const customText = applyTemplate(event, 'submissionEnd', vars, null);
                    const defaultText = hasVotePhase ? `🛑 The submission period for **${event.title}** has now ended! Don't forget to vote on your favorite entries.` : `🏁 The event **${event.title}** has now ended! Thanks to everyone who participated.`;
                    if (channel) {
                        await channel.send(customText || defaultText);
                    }
                    if (wantSite) {
                        await notifyCommunityEvent(event.communityId, { title: hasVotePhase ? `Submissions closed: ${event.title}` : `Event ended: ${event.title}`, message: customText || (hasVotePhase ? 'Submissions are closed — time to vote!' : 'Thanks to everyone who participated.'), link: `/event/${event.id}` });
                    }
                    await eventDocRef.update({ 'notificationsSent.end': true });
                }

                if (votingEnabled && event.separateVoteTime && event.voteReminders?.length > 0) {
                    for (const reminderType of event.voteReminders) {
                        if (event.sentVoteReminders?.includes(reminderType)) continue;
                        const reminderTimeMs = parseReminder(reminderType);
                        const reminderFireTime = new Date(event.voteEndDate.toDate().getTime() - reminderTimeMs);
                        if (reminderTimeMs > 0 && reminderFireTime >= now && reminderFireTime < oneMinuteFromNow) {
                            console.log(`[Event Notifier] Sending VOTING REMINDER for: ${event.title}`);
                            const timeValue = reminderType.slice(0, -1);
                            const timeUnit = reminderType.slice(-1) === 'd' ? 'day(s)' : (reminderType.slice(-1) === 'h' ? 'hour(s)' : 'minute(s)');
                            const timeRemaining = `${timeValue} ${timeUnit}`;
                            const customText = applyTemplate(event, 'votingReminder', { ...vars, timeRemaining }, null);
                            if (channel) {
                                await channel.send(customText || `⏳ Reminder: Voting for the event **${event.title}** ends in ${timeRemaining}!`);
                            }
                            if (wantSite) {
                                await notifyCommunityEvent(event.communityId, { title: `Voting reminder: ${event.title}`, message: customText || `Voting ends in ${timeRemaining}.`, link: `/event/${event.id}` });
                            }
                            await eventDocRef.update({ sentVoteReminders: admin.firestore.FieldValue.arrayUnion(reminderType) });
                        }
                    }
                }

                const voteEndDate = event.voteEndDate.toDate();
                if (votingEnabled && event.separateVoteTime && voteEndDate >= now && voteEndDate < oneMinuteFromNow && !event.notificationsSent?.voteEnd) {
                    console.log(`[Event Notifier] Sending VOTE END for: ${event.title}`);
                    const customText = applyTemplate(event, 'votingEnd', vars, null);
                    if (channel) {
                        await channel.send(customText || `🏁 Voting for **${event.title}** has now ended! Thanks to everyone who voted.`);
                    }
                    if (wantSite) {
                        await notifyCommunityEvent(event.communityId, { title: `Voting ended: ${event.title}`, message: customText || 'Thanks to everyone who voted.', link: `/event/${event.id}` });
                    }
                    await eventDocRef.update({ 'notificationsSent.voteEnd': true });
                }
            }
        } catch (error) {
            console.error("[Event Notifier] Error during minutely check:", error);
        }

        // --- Ergebnis-Publishing (Managing-Phase): geplante Video-Gruppen live
        // schalten, Teilnehmer benachrichtigen, Publish-All abschließen. ---
        try {
            const managingEvents = getManagingEventsCache();
            for (const event of managingEvents) {
                const { wantDiscord } = resolveChannels(event);
                const notifyParticipants = event.notifyParticipantsOnResults !== false;
                const eventDocRef = db.collection('events').doc(event.id);
                const groups = event.managerGroups || [];
                const assignments = event.managerGroupAssignments || {};

                let communityData = null;
                let channel = null;
                const getChannel = async () => {
                    if (!wantDiscord) return null;
                    if (!communityData) {
                        const cSnap = await db.collection('communitys').doc(event.communityId).get();
                        if (!cSnap.exists) return null;
                        communityData = cSnap.data();
                        channel = await resolveDiscordChannel(event, communityData);
                    }
                    return channel;
                };

                // userId je Creation einer Gruppe auflösen
                const getGroupParticipants = async (groupId) => {
                    const creationIds = Object.keys(assignments).filter(cid => assignments[cid] === groupId);
                    const results = [];
                    for (const cid of creationIds) {
                        const snap = await db.collection('creations').doc(cid).get();
                        if (snap.exists) results.push({ creationId: cid, userId: snap.data().userId, title: snap.data().title });
                    }
                    return results;
                };

                // 1) Gruppen: geplantes Publishing + Benachrichtigung
                let groupsChanged = false;
                const nextGroups = [];
                for (const g of groups) {
                    const group = { ...g };
                    const publishAtDate = group.publishAt && group.publishAt.toDate ? group.publishAt.toDate() : (group.publishAt ? new Date(group.publishAt) : null);
                    if (!group.published && publishAtDate && publishAtDate <= now) {
                        group.published = true;
                        groupsChanged = true;
                    }
                    if (group.published && !group.notified) {
                        console.log(`[Event Notifier] Publishing group "${group.name}" for: ${event.title}`);
                        const participants = await getGroupParticipants(group.id);
                        if (notifyParticipants) {
                            for (const p of participants) {
                                if (!p.userId) continue;
                                await notifyUser(p.userId, 'eventResults', {
                                    title: `Results are out: ${event.title}`,
                                    message: `Your entry "${p.title}" is featured in "${group.name}"${group.videoUrl ? ' — watch the video!' : '.'}`,
                                    link: `/event/${event.id}`,
                                });
                            }
                        }
                        const ch = await getChannel();
                        if (ch) {
                            await ch.send(`🎬 Results for **${event.title}** — **${group.name}** ${group.videoUrl ? `is out: ${group.videoUrl}` : 'has been published!'}\nSee all results: https://planetcreations.net/event/${event.id}`);
                        }
                        group.notified = true;
                        groupsChanged = true;
                    }
                    nextGroups.push(group);
                }
                if (groupsChanged) {
                    await eventDocRef.update({ managerGroups: nextGroups });
                }

                // 2) Publish-All: Platzierungen benachrichtigen + Status abschließen
                if (event.resultsPublishRequestedAt && !event.notificationsSent?.results) {
                    console.log(`[Event Notifier] Publishing RESULTS for: ${event.title}`);
                    if (notifyParticipants) {
                        const subsSnap = await db.collection('creations').where('eventIds', 'array-contains', event.id).get();
                        const order = event.resultsOrder || [];
                        for (const doc of subsSnap.docs) {
                            const data = doc.data();
                            if (!data.userId) continue;
                            const place = order.indexOf(doc.id);
                            const placeText = place >= 0 ? `Your entry "${data.title}" placed #${place + 1}.` : `See how your entry "${data.title}" did!`;
                            await notifyUser(data.userId, 'eventResults', {
                                title: `Results are out: ${event.title}`,
                                message: placeText,
                                link: `/event/${event.id}`,
                            });
                        }
                    }
                    const ch = await getChannel();
                    if (ch) {
                        await ch.send(`🏆 The results for **${event.title}** are out! https://planetcreations.net/event/${event.id}`);
                    }
                    await eventDocRef.update({ 'notificationsSent.results': true, resultsStatus: 'published' });
                }
            }
        } catch (error) {
            console.error("[Event Notifier] Error during results publishing check:", error);
        }
    });
}

module.exports = { startEventNotifier };
