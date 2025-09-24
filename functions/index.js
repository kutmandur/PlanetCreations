const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Client, GatewayIntentBits, Partials, ChannelType, EmbedBuilder } = require("discord.js");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

admin.initializeApp();
const db = admin.firestore();

// Get secrets from Firebase Functions config
const DISCORD_BOT_TOKEN = functions.config().discord.token;
const DISCORD_CLIENT_ID = functions.config().discord.client_id;
const DISCORD_CLIENT_SECRET = functions.config().discord.client_secret;
const DISCORD_REDIRECT_URI = functions.config().discord.redirect_uri;


// Create an Express app to handle HTTP requests
const app = express();
app.use(cors({ origin: true }));

// Middleware to authenticate requests
const authenticate = async (req, res, next) => {
    if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
        res.status(403).send('Unauthorized');
        return;
    }
    const idToken = req.headers.authorization.split('Bearer ')[1];
    try {
        const decodedIdToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedIdToken;
        next();
        return;
    } catch (e) {
        res.status(403).send('Unauthorized');
        return;
    }
};

// --- HTTP Endpoint to handle the initial Discord auth redirect ---
app.get("/discordAuthRedirect", (req, res) => {
    const { appUserId } = req.query;
    if (!appUserId) {
        return res.status(400).send("Missing appUserId query parameter.");
    }

    if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
        console.error("Discord environment variables not set in Firebase config.");
        return res.status(500).send("Server configuration error.");
    }

    const state = appUserId;
    const scope = "identify guilds";

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${scope}&state=${state}`;
    
    res.redirect(authUrl);
});

// --- HTTP Endpoint to handle the callback from Discord ---
app.get("/discordCallback", async (req, res) => {
    const { code, state: appUserId } = req.query;

    if (!code || !appUserId) {
        return res.status(400).send("Missing code or state from Discord.");
    }

    try {
        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: "authorization_code",
                code,
                redirect_uri: DISCORD_REDIRECT_URI,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            throw new Error("Failed to get access token from Discord.");
        }
        
        const { access_token, refresh_token } = tokenData;

        const userResponse = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const discordUser = await userResponse.json();
        if (!discordUser.id || !discordUser.username) {
            throw new Error("Failed to fetch user info from Discord.");
        }
        
        const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const guildsData = await guildsResponse.json();
        const guildIds = Array.isArray(guildsData) ? guildsData.map(g => g.id) : [];

        const userRef = db.collection("users").doc(appUserId);
        await userRef.update({
            discordId: discordUser.id,
            discordUsername: discordUser.username,
            discordGuilds: guildIds,
            discordRefreshToken: refresh_token,
        });
        
        res.redirect("https://planetcreations.net/settings?discord-linked=success");

    } catch (error) {
        console.error("Error in Discord callback:", error);
        res.status(500).send("An error occurred while linking your Discord account.");
    }
});


// --- HTTP Endpoint to SEND a verification DM ---
app.post("/sendVerificationDM", async (req, res) => {
    const { discordId, appUserId } = req.body;
    if (!discordId || !appUserId) {
        return res.status(400).send("Missing discordId or appUserId.");
    }

    const client = new Client({ intents: [GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });
    
    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationRef = db.collection('discordVerifications');
        
        await verificationRef.add({
            appUserId,
            discordId,
            code,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await client.login(DISCORD_BOT_TOKEN);
        const user = await client.users.fetch(discordId);
        await user.send(`Your verification code for PlanetCreations is: **${code}**`);
        
        client.destroy();
        return res.status(200).send("Verification code sent successfully.");

    } catch (error) {
        console.error("Error sending verification DM:", error);
        client.destroy();
        return res.status(500).send("Could not send verification DM. Please check if your Discord User ID is correct and you allow DMs from server members.");
    }
});

// --- HTTP Endpoint to CONFIRM a verification code ---
app.post("/confirmVerificationCode", async (req, res) => {
    const { code, appUserId } = req.body;
    if (!code || !appUserId) {
        return res.status(400).send("Missing code or appUserId.");
    }

    try {
        const verificationsRef = db.collection("discordVerifications");
        const q = verificationsRef.where("code", "==", code).where("appUserId", "==", appUserId);
        const snapshot = await q.get();

        if (snapshot.empty) {
            return res.status(404).send("Invalid or expired verification code.");
        }

        const verificationDoc = snapshot.docs[0];
        const { discordId } = verificationDoc.data();
        
        const client = new Client({ intents: [] });
        await client.login(DISCORD_BOT_TOKEN);
        const discordUser = await client.users.fetch(discordId);
        
        const userRef = db.collection("users").doc(appUserId);
        await userRef.update({
            discordId: discordUser.id,
            discordUsername: discordUser.username,
        });

        await verificationDoc.ref.delete();
        
        client.destroy();
        return res.status(200).send("Account linked successfully!");

    } catch (error) {
        console.error("Error confirming code:", error);
        return res.status(500).send("An error occurred during verification.");
    }
});


// --- HTTP Endpoint for fetching roles ---
app.get("/getDiscordRoles", async (req, res) => {
    const serverId = req.query.serverId;
    if (!serverId) {
        return res.status(400).send("Missing 'serverId' query parameter.");
    }
    
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    try {
        await client.login(DISCORD_BOT_TOKEN);
        const guild = await client.guilds.fetch(serverId);
        if (!guild) {
            client.destroy();
            return res.status(404).send("Bot is not a member of the specified server.");
        }

        await guild.roles.fetch();
        
        const roles = guild.roles.cache
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.hexColor,
            }))
            .filter(role => role.name !== '@everyone');
        
        client.destroy();
        return res.status(200).json(roles);

    } catch (error) {
        console.error("Error fetching Discord roles:", error);
        client.destroy();
        return res.status(500).send("An error occurred while fetching roles.");
    }
});

// --- HTTP Endpoint for fetching text channels ---
app.get("/getDiscordChannels", async (req, res) => {
    const serverId = req.query.serverId;
    if (!serverId) {
        return res.status(400).send("Missing 'serverId' query parameter.");
    }
    
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    try {
        await client.login(DISCORD_BOT_TOKEN);
        const guild = await client.guilds.fetch(serverId);
        if (!guild) {
            client.destroy();
            return res.status(404).send("Bot is not a member of the specified server.");
        }

        await guild.channels.fetch();
        
        const channels = guild.channels.cache
            .filter(channel => channel.type === ChannelType.GuildText)
            .map(channel => ({
                id: channel.id,
                name: channel.name,
            }));
        
        client.destroy();
        return res.status(200).json(channels);

    } catch (error) {
        console.error("Error fetching Discord channels:", error);
        client.destroy();
        return res.status(500).send("An error occurred while fetching channels.");
    }
});

// --- HTTP Endpoint for manual rank sync ---
app.post("/syncUserDiscordRoles", authenticate, async (req, res) => {
    const appUserId = req.user.uid;

    try {
        const userDoc = await db.collection('users').doc(appUserId).get();
        if (!userDoc.exists() || !userDoc.data().discordId) {
            return res.status(400).json({ error: "Discord account not linked." });
        }
        const discordId = userDoc.data().discordId;

        const membershipsSnapshot = await db.collection('profiles').doc(appUserId).collection('communityMemberships').get();
        if (membershipsSnapshot.empty) {
            return res.status(200).json({ message: "You are not a member of any communities." });
        }
        const communityIds = membershipsSnapshot.docs.map(doc => doc.id);
        
        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
        await client.login(DISCORD_BOT_TOKEN);
        
        let successCount = 0;
        let errorCount = 0;

        for (const communityId of communityIds) {
            const communityDoc = await db.collection('communitys').doc(communityId).get();
            if (!communityDoc.exists() || !communityDoc.data().discordServerId) {
                continue;
            }
            
            const communityData = communityDoc.data();
            const discordServerId = communityData.discordServerId;

            try {
                const guild = await client.guilds.fetch(discordServerId);
                const member = await guild.members.fetch(discordId);

                const memberRoleIds = member.roles.cache.map(r => r.id);
                const newRanks = communityData.ranks
                    .filter(rank => memberRoleIds.includes(rank.discordRoleId))
                    .map(rank => rank.name.toLowerCase());

                if (communityData.ownerId === appUserId && !newRanks.includes('owner')) {
                    newRanks.push('owner');
                }
                
                const defaultRankName = communityData.defaultRankName.toLowerCase();
                if (newRanks.length === 0 && defaultRankName) {
                    newRanks.push(defaultRankName);
                }

                const memberRef = db.collection('communitys').doc(communityId).collection('members').doc(appUserId);
                await memberRef.update({ roles: newRanks });
                successCount++;

            } catch (error) {
                console.error(`Failed to sync for guild ${discordServerId}:`, error.message);
                errorCount++;
            }
        }

        client.destroy();
        return res.status(200).json({ message: `Sync complete. Successfully updated ${successCount} communities. Failed to update ${errorCount}.` });

    } catch (error) {
        console.error("Error during role sync:", error);
        return res.status(500).json({ error: "An internal error occurred." });
    }
});

// Export the single Express app as a Cloud Function
exports.api = functions.https.onRequest(app);


// --- Callable Functions ---
exports.deleteOwnAccount = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to perform this action.');
    }
    const userId = context.auth.uid;
    console.log(`User ${userId} initiating self-deletion.`);

    try {
        const batch = db.batch();
        const profileRef = db.doc(`profiles/${userId}`);
        const profileSnap = await profileRef.get();
        const username = profileSnap.exists ? profileSnap.data().username.toLowerCase() : null;
        
        const membershipsRef = db.collection(`profiles/${userId}/communityMemberships`);
        const membershipsSnap = await membershipsRef.get();
        const communityIds = membershipsSnap.docs.map(doc => doc.id);

        const creationsRef = db.collection('creations').where('userId', '==', userId);
        const creationsSnap = await creationsRef.get();
        creationsSnap.forEach(doc => batch.delete(doc.ref));

        communityIds.forEach(communityId => {
            const memberRef = db.doc(`communitys/${communityId}/members/${userId}`);
            batch.delete(memberRef);
        });

        batch.delete(profileRef);
        batch.delete(db.doc(`users/${userId}`));
        if (username) {
            batch.delete(db.doc(`usernames/${username}`));
        }
        
        await batch.commit();
        await admin.auth().deleteUser(userId);

        return { success: true, message: `User ${userId} and all their content has been deleted.` };
    } catch (error) {
        console.error(`Failed to delete user ${userId}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred during the account deletion process.');
    }
});


exports.refreshDiscordGuilds = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to perform this action.');
    }
    const userId = context.auth.uid;
    
    try {
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists || !userDoc.data().discordRefreshToken) {
            throw new functions.https.HttpsError('failed-precondition', 'Discord account not linked or refresh token is missing. Please relink your account.');
        }

        const refreshToken = userDoc.data().discordRefreshToken;

        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            }),
        });
        
        const tokenData = await tokenResponse.json();
        
        if (!tokenResponse.ok) {
            console.error("Discord token refresh failed:", tokenData);
            if (tokenData.error === 'invalid_grant') {
                throw new functions.https.HttpsError('unauthenticated', 'Your Discord connection has expired. Please unlink and relink your account.');
            }
            throw new functions.https.HttpsError('unavailable', 'Could not refresh access token from Discord. Please try again later.');
        }

        const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const guildsData = await guildsResponse.json();
        const guildIds = Array.isArray(guildsData) ? guildsData.map(g => g.id) : [];

        await userRef.update({
            discordGuilds: guildIds,
            discordRefreshToken: tokenData.refresh_token,
        });

        return { success: true, message: 'Your Discord server list has been refreshed.' };

    } catch (error) {
        console.error(`Error refreshing guilds for user ${userId}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'An unexpected error occurred while refreshing your server list.');
    }
});


exports.deleteUserAndContent = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only admins can perform this action.');
    }
    const { userIdToDelete } = data;
    if (!userIdToDelete) {
        throw new functions.https.HttpsError('invalid-argument', 'A userIdToDelete must be provided.');
    }
    if (userIdToDelete === context.auth.uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Admins cannot delete their own accounts.');
    }

    console.log(`Admin ${context.auth.uid} initiating deletion for user ${userIdToDelete}.`);

    try {
        const batch = db.batch();
        const profileRef = db.doc(`profiles/${userIdToDelete}`);
        const profileSnap = await profileRef.get();
        const username = profileSnap.exists ? profileSnap.data().username.toLowerCase() : null;
        
        const membershipsRef = db.collection(`profiles/${userIdToDelete}/communityMemberships`);
        const membershipsSnap = await membershipsRef.get();
        const communityIds = membershipsSnap.docs.map(doc => doc.id);

        const creationsRef = db.collection('creations').where('userId', '==', userIdToDelete);
        const creationsSnap = await creationsRef.get();
        creationsSnap.forEach(doc => batch.delete(doc.ref));
        console.log(`Deleting ${creationsSnap.size} creations...`);

        communityIds.forEach(communityId => {
            const memberRef = db.doc(`communitys/${communityId}/members/${userIdToDelete}`);
            batch.delete(memberRef);
        });
        console.log(`Deleting from ${communityIds.length} community member lists...`);

        batch.delete(profileRef);
        batch.delete(db.doc(`users/${userIdToDelete}`));
        if (username) {
            batch.delete(db.doc(`usernames/${username}`));
        }
        console.log("Deleting main user documents...");

        await batch.commit();
        console.log("Firestore data deleted successfully.");

        await admin.auth().deleteUser(userIdToDelete);
        console.log(`Successfully deleted user ${userIdToDelete} from Firebase Auth.`);

        return { success: true, message: `User ${userIdToDelete} and all their content has been deleted.` };
    } catch (error) {
        console.error(`Failed to delete user ${userIdToDelete}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred during the deletion process.');
    }
});


exports.getAllUserEmails = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied', 
      'This function can only be called by an administrator.'
    );
  }
  const emails = [];
  let nextPageToken;
  try {
    do {
      const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
      listUsersResult.users.forEach((userRecord) => { if (userRecord.email) { emails.push(userRecord.email); } });
      nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);
    return { emails };
  } catch (error) {
    console.error("Error listing users:", error);
    throw new functions.https.HttpsError('internal', 'An error occurred while fetching user emails.');
  }
});

exports.deleteEventAsStaff = functions.https.onCall(async (data, context) => {
    if (!context.auth) { throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.'); }
    const { eventId } = data;
    if (!eventId) { throw new functions.https.HttpsError('invalid-argument', 'An eventId must be provided.'); }
    const userId = context.auth.uid;
    const userRole = context.auth.token.role;
    try {
        const eventRef = db.collection('events').doc(eventId);
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists()) { throw new functions.https.HttpsError('not-found', 'Event does not exist.'); }
        const eventData = eventDoc.data();
        const communityId = eventData.communityId;
        const isSiteStaff = userRole === 'admin' || userRole === 'moderator';
        let isCommunityStaff = false;
        if (!isSiteStaff) {
            const memberRef = db.collection('communitys').doc(communityId).collection('members').doc(userId);
            const memberDoc = await memberRef.get();
            if (memberDoc.exists()) {
                const memberRoles = memberDoc.data().roles || [];
                isCommunityStaff = memberRoles.includes('owner') || memberRoles.includes('moderator');
            }
        }
        if (!isSiteStaff && !isCommunityStaff) { throw new functions.https.HttpsError('permission-denied', 'You do not have permission to delete this event.'); }
        const batch = db.batch();
        batch.delete(eventRef);
        const creationsQuery = db.collection('creations').where('eventIds', 'array-contains', eventId);
        const creationsSnapshot = await creationsQuery.get();
        creationsSnapshot.forEach(creationDoc => {
            batch.update(creationDoc.ref, { eventIds: admin.firestore.FieldValue.arrayRemove(eventId) });
        });
        const votersRef = db.collection('events').doc(eventId).collection('voters');
        const votersSnapshot = await votersRef.get();
        votersSnapshot.forEach(voterDoc => { batch.delete(voterDoc.ref); });
        await batch.commit();
        return { success: true, message: "Event deleted successfully." };
    } catch (error) {
        console.error("Error deleting event:", error);
        if (error.code) { throw error; }
        throw new functions.https.HttpsError('internal', 'An unexpected error occurred while deleting the event.');
    }
});

exports.getDiscordReactionCount = functions.https.onCall(async (data, context) => {
    const { channelId, messageId } = data;
    if (!channelId || !messageId) { throw new functions.https.HttpsError('invalid-argument', 'Missing channelId or messageId.'); }
    try {
        const client = new Client({ intents: [GatewayIntentBits.GuildMessageReactions] });
        await client.login(DISCORD_BOT_TOKEN);
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);
        const thumbsUp = message.reactions.cache.get('👍');
        const count = thumbsUp ? thumbsUp.count : 0;
        client.destroy();
        return { count };
    } catch (error) {
        console.error("Error fetching reaction count:", error);
        return { count: 0 };
    }
});


// --- Trigger Functions ---
exports.onMemberJoin = functions.firestore
    .document('communitys/{communityId}/members/{userId}')
    .onCreate(async (snap, context) => {
        const communityId = context.params.communityId;
        const communityRef = db.doc(`communitys/${communityId}`);
        return communityRef.update({ memberCount: admin.firestore.FieldValue.increment(1) });
    });

exports.onMemberLeave = functions.firestore
    .document('communitys/{communityId}/members/{userId}')
    .onDelete(async (snap, context) => {
        const communityId = context.params.communityId;
        const communityRef = db.doc(`communitys/${communityId}`);
        return communityRef.update({ memberCount: admin.firestore.FieldValue.increment(-1) });
    });

exports.onProfileWrite = functions.firestore.document("profiles/{userId}").onWrite(async (change, context) => {
    const afterData = change.after.data();
    const beforeData = change.before.data();
    if (afterData && (!beforeData || beforeData.username !== afterData.username)) {
        const username = afterData.username;
        const usernameLowercase = username.toLowerCase();
        return change.after.ref.set({ username_lowercase: usernameLowercase }, { merge: true });
    }
    return null;
});

exports.setCustomClaims = functions.firestore.document("users/{userId}").onWrite(async (change, context) => {
    const userId = context.params.userId;
    const userData = change.after.data();
    if (!userData || !userData.role) { return null; }
    const newRole = userData.role;
    try {
        await admin.auth().setCustomUserClaims(userId, { role: newRole });
        const profileRef = db.collection('profiles').doc(userId);
        await profileRef.set({ role: newRole }, { merge: true });
        console.log(`Custom claim and profile role set for user ${userId}: { role: '${newRole}' }`);
        return null;
    } catch (error) {
      console.error(`Error setting custom claim/profile role for ${userId}:`, error);
      return null;
    }
});

exports.onVoteCreate = functions.firestore
    .document('creations/{creationId}/votes/{userId}')
    .onCreate(async (snap, context) => {
        const creationId = context.params.creationId;
        const voteData = snap.data();
        const creationRef = db.doc(`creations/${creationId}`);

        if (voteData.type === 'like') {
            return creationRef.update({ likes: admin.firestore.FieldValue.increment(1) });
        } else if (voteData.type === 'dislike') {
            return creationRef.update({ dislikes: admin.firestore.FieldValue.increment(1) });
        }
        return null;
    });

exports.onVoteDelete = functions.firestore
    .document('creations/{creationId}/votes/{userId}')
    .onDelete(async (snap, context) => {
        const creationId = context.params.creationId;
        const voteData = snap.data();
        const creationRef = db.doc(`creations/${creationId}`);

        if (voteData.type === 'like') {
            return creationRef.update({ likes: admin.firestore.FieldValue.increment(-1) });
        } else if (voteData.type === 'dislike') {
            return creationRef.update({ dislikes: admin.firestore.FieldValue.increment(-1) });
        }
        return null;
    });

exports.onCreationLinked = functions.firestore.document('communitys/{communityId}/creations/{linkId}').onCreate(async (snap, context) => {
    const { communityId, linkId: creationId } = context.params;
    try {
        const communityDoc = await db.collection('communitys').doc(communityId).get();
        const creationDoc = await db.collection('creations').doc(creationId).get();
        if (!communityDoc.exists() || !creationDoc.exists()) {
            console.log(`Community (${communityId}) or Creation (${creationId}) not found.`);
            return null;
        }
        const communityData = communityDoc.data();
        const creationData = creationDoc.data();
        let eventClass = "general";
        if (creationData.eventIds && creationData.eventIds.length > 0) {
            const eventId = creationData.eventIds[0];
            const eventDoc = await db.collection('events').doc(eventId).get();
            if (eventDoc.exists() && eventDoc.data().classes?.length > 0) {
                eventClass = eventDoc.data().classes[0];
            }
        }
        const channelId = communityData.discordChannelMapping?.[eventClass.toLowerCase()];
        if (!channelId) {
            console.log(`No channel mapped for class "${eventClass}" in community ${communityId}.`);
            return null;
        }
        const embed = new EmbedBuilder()
            .setColor(communityData.themeColor || '#F97316')
            .setTitle(`New Creation Added: ${creationData.title}`)
            .setURL(`https://planetcreations.net/creation/${creationId}`)
            .setAuthor({ name: creationData.username, iconURL: creationData.userProfilePictureUrl || undefined })
            .setDescription(creationData.description ? creationData.description.substring(0, 250) + '...' : 'No description available.')
            .setTimestamp(creationData.createdAt.toDate());
        if (creationData.imageUrls && creationData.imageUrls.length > 0) {
            embed.setImage(creationData.imageUrls[0]);
        }
        const client = new Client({ intents: [] });
        await client.login(DISCORD_BOT_TOKEN);
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const message = await channel.send({ embeds: [embed] });
            await snap.ref.update({ discordMessageId: message.id, discordChannelId: channel.id });
        }
        client.destroy();
        return null;
    } catch (error) {
        console.error(`Error posting creation ${creationId} to Discord for community ${communityId}:`, error);
        return null;
    }
});

exports.onProfileUpdate = functions.firestore.document('profiles/{userId}').onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const beforeData = change.before.data();
    const afterData = change.after.data();

    const usernameChanged = beforeData.username !== afterData.username;
    const profilePicChanged = beforeData.profilePictureUrl !== afterData.profilePictureUrl;

    if (!usernameChanged && !profilePicChanged) {
        console.log(`No relevant profile changes for user ${userId}.`);
        return null;
    }

    const dataToUpdate = {};
    if (usernameChanged) {
        dataToUpdate.username = afterData.username;
    }
    if (profilePicChanged) {
        dataToUpdate.userProfilePictureUrl = afterData.profilePictureUrl || null;
    }

    const batch = db.batch();

    try {
        const creationsQuery = db.collection('creations').where('userId', '==', userId);
        const creationsSnapshot = await creationsQuery.get();
        creationsSnapshot.forEach(doc => {
            batch.update(doc.ref, dataToUpdate);
        });
        console.log(`Found ${creationsSnapshot.size} creations to update for user ${userId}.`);

        const membershipsQuery = db.collection('profiles').doc(userId).collection('communityMemberships');
        const membershipsSnapshot = await membershipsQuery.get();
        membershipsSnapshot.forEach(doc => {
            const communityId = doc.id;
            const memberRef = db.doc(`communitys/${communityId}/members/${userId}`);
            if (usernameChanged) {
                batch.update(memberRef, { username: afterData.username });
            }
        });
        console.log(`Found ${membershipsSnapshot.size} community memberships to update for user ${userId}.`);
        
        if (usernameChanged) {
            const ownedCommunitiesQuery = db.collection('communitys').where('ownerId', '==', userId);
            const ownedCommunitiesSnapshot = await ownedCommunitiesQuery.get();
            ownedCommunitiesSnapshot.forEach(doc => {
                batch.update(doc.ref, { ownerUsername: afterData.username });
            });
            console.log(`Found ${ownedCommunitiesSnapshot.size} owned communities to update for user ${userId}.`);
        }

        await batch.commit();
        console.log(`Successfully synchronized profile updates for user ${userId}.`);
        return null;

    } catch (error) {
        console.error(`Error synchronizing profile for user ${userId}:`, error);
        return null;
    }
});


// --- Scheduled Functions ---
exports.handleEventLifecycleNotifications = functions.pubsub.schedule('0 * * * *').onRun(async (context) => {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const parseReminder = (reminderString) => {
        if (!reminderString || typeof reminderString !== 'string') return 0;
        const unit = reminderString.slice(-1);
        const value = parseInt(reminderString.slice(0, -1), 10);
        if (isNaN(value)) return 0;
        if (unit === 'd') return value * 24 * 60 * 60 * 1000;
        if (unit === 'h') return value * 60 * 60 * 1000;
        return 0;
    };

    try {
        const client = new Client({ intents: [] });
        await client.login(DISCORD_BOT_TOKEN);

        const activeEventsQuery = db.collection('events').where('voteEndDate', '>', now);
        const activeEventsSnapshot = await activeEventsQuery.get();

        for (const eventDoc of activeEventsSnapshot.docs) {
            const event = { id: eventDoc.id, ...eventDoc.data() };
            const communityDoc = await db.collection('communitys').doc(event.communityId).get();
            if (!communityDoc.exists()) continue;

            const community = communityDoc.data();
            const eventClass = event.classes?.[0] || 'general';
            const channelId = community.discordChannelMapping?.[eventClass.toLowerCase()];
            if (!channelId) continue;
            
            const channel = await client.channels.fetch(channelId);
            if (!channel) continue;
            
            // Handle Start Notification
            const startDate = event.startDate.toDate();
            if (startDate >= now && startDate < oneHourFromNow && !event.notificationsSent?.start) {
                const startEmbed = new EmbedBuilder().setColor(community.themeColor || '#5865F2').setTitle(`🎉 Event Started: ${event.title}`).setURL(`https://planetcreations.net/event/${event.id}`).setDescription(event.description ? event.description.substring(0, 500) : 'The event has now begun!').setTimestamp(startDate);
                if (event.rules && event.rules.length > 0) {
                    const rulesText = event.rules.map(rule => `- ${rule.text}`).join('\n');
                    startEmbed.addFields({ name: 'Rules', value: rulesText.substring(0, 1024) });
                }
                if (event.bannerImageUrl) { startEmbed.setImage(event.bannerImageUrl); }
                await channel.send({ embeds: [embed] });

                const membersSnapshot = await db.collection('communitys').doc(event.communityId).collection('members').get();
                const batch = db.batch();
                membersSnapshot.forEach(memberDoc => {
                    const notifRef = db.collection('users').doc(memberDoc.id).collection('notifications').doc();
                    batch.set(notifRef, {
                        title: `Event Started: ${event.title}`,
                        message: `The event has officially begun. Good luck to all participants!`,
                        link: `/event/${event.id}`,
                        isRead: false,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                });
                await batch.commit();

                await eventDoc.ref.update({ 'notificationsSent.start': true });
            }
            
            // Handle Submission Reminders
            if (event.reminders && event.reminders.length > 0) {
                const timeLeftMs = event.endDate.toDate().getTime() - now.getTime();
                for (const reminderType of event.reminders) {
                    if (event.sentReminders?.includes(reminderType)) continue;
                    const reminderTimeMs = parseReminder(reminderType);
                    if (reminderTimeMs > 0 && timeLeftMs <= reminderTimeMs && timeLeftMs > (reminderTimeMs - 3600000)) {
                        const timeValue = reminderType.slice(0, -1);
                        const timeUnit = reminderType.endsWith('d') ? `day(s)` : `hour(s)`;
                        const message = `⏳ Reminder: Submissions for the event **${event.title}** ends in ${timeValue} ${timeUnit}!`;
                        await channel.send(message);

                        const membersSnapshot = await db.collection('communitys').doc(event.communityId).collection('members').get();
                        const batch = db.batch();
                        membersSnapshot.forEach(memberDoc => {
                            const notifRef = db.collection('users').doc(memberDoc.id).collection('notifications').doc();
                            batch.set(notifRef, {
                                title: "Event Reminder",
                                message: `Submissions for "${event.title}" end in ${timeValue} ${timeUnit}!`,
                                link: `/event/${event.id}`,
                                isRead: false,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            });
                        });
                        await batch.commit();
                        
                        await eventDoc.ref.update({ sentReminders: admin.firestore.FieldValue.arrayUnion(reminderType) });
                    }
                }
            }

            // Handle Voting Reminders
            if (event.separateVoteTime && event.voteReminders && event.voteReminders.length > 0) {
                const timeLeftVoteMs = event.voteEndDate.toDate().getTime() - now.getTime();
                for (const reminderType of event.voteReminders) {
                    if (event.sentVoteReminders?.includes(reminderType)) continue;
                    const reminderTimeMs = parseReminder(reminderType);
                    if (reminderTimeMs > 0 && timeLeftVoteMs <= reminderTimeMs && timeLeftVoteMs > (reminderTimeMs - 3600000)) {
                        const timeValue = reminderType.slice(0, -1);
                        const timeUnit = reminderType.endsWith('d') ? `day(s)` : `hour(s)`;
                        const message = `⏳ Reminder: Voting for the event **${event.title}** ends in ${timeValue} ${timeUnit}!`;
                        await channel.send(message);

                        const membersSnapshot = await db.collection('communitys').doc(event.communityId).collection('members').get();
                        const batch = db.batch();
                        membersSnapshot.forEach(memberDoc => {
                            const notifRef = db.collection('users').doc(memberDoc.id).collection('notifications').doc();
                            batch.set(notifRef, {
                                title: "Voting Reminder",
                                message: `Voting for "${event.title}" ends in ${timeValue} ${timeUnit}!`,
                                link: `/event/${event.id}`,
                                isRead: false,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            });
                        });
                        await batch.commit();

                        await eventDoc.ref.update({ sentVoteReminders: admin.firestore.FieldValue.arrayUnion(reminderType) });
                    }
                }
            }
        }
        
        // Handle Submission End Notifications
        const endedSubmissionQuery = db.collection('events').where('endDate', '<=', now).where('endDate', '>', oneHourAgo);
        const endedSubmissionSnapshot = await endedSubmissionQuery.get();
        for (const eventDoc of endedSubmissionSnapshot.docs) {
            const event = { id: eventDoc.id, ...eventDoc.data() };
            if (event.notificationsSent?.end) continue;
            const communityDoc = await db.collection('communitys').doc(event.communityId).get();
            if (!communityDoc.exists()) continue;
            const community = communityDoc.data();
            const eventClass = event.classes?.[0] || 'general';
            const channelId = community.discordChannelMapping?.[eventClass.toLowerCase()];
            if (!channelId) continue;
            const channel = await client.channels.fetch(channelId);
            if(channel) {
                if (event.separateVoteTime) {
                    await channel.send(`🛑 The submission period for **${event.title}** has now ended! Don't forget to vote on your favorite.`);
                } else {
                    await channel.send(`🏁 The event **${event.title}** has now ended! Thanks to everyone who participated.`);
                }
                await eventDoc.ref.update({ 'notificationsSent.end': true });
            }
        }

        // Handle Voting End Notifications
        const endedVotingQuery = db.collection('events').where('separateVoteTime', '==', true).where('voteEndDate', '<=', now).where('voteEndDate', '>', oneHourAgo);
        const endedVotingSnapshot = await endedVotingQuery.get();
        for (const eventDoc of endedVotingSnapshot.docs) {
            const event = { id: eventDoc.id, ...eventDoc.data() };
            if (event.notificationsSent?.voteEnd) continue;
            const communityDoc = await db.collection('communitys').doc(event.communityId).get();
            if (!communityDoc.exists()) continue;
            const community = communityDoc.data();
            const eventClass = event.classes?.[0] || 'general';
            const channelId = community.discordChannelMapping?.[eventClass.toLowerCase()];
            if (!channelId) continue;
            const channel = await client.channels.fetch(channelId);
            if(channel) {
                await channel.send(`🏁 Voting for **${event.title}** has now ended! Thanks to everyone who voted.`);
                await eventDoc.ref.update({ 'notificationsSent.voteEnd': true });
            }
        }
        
        client.destroy();
        return null;
    } catch (error) {
        console.error("Error handling event notifications:", error);
        return null;
    }
});