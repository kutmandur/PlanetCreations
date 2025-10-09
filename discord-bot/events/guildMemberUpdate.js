const { Events } = require('discord.js');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember, db) {
        // Check if roles have changed
        if (oldMember.roles.cache.size === newMember.roles.cache.size) return;

        console.log(`[Role Sync] Detected role change for ${newMember.user.tag} in server ${newMember.guild.name}.`);
        try {
            const discordId = newMember.id;
            const discordServerId = newMember.guild.id;

            // Find the PlanetCreations user by their Discord ID
            const usersQuery = await db.collection('users').where('discordId', '==', discordId).limit(1).get();
            if (usersQuery.empty) return;
            const appUserId = usersQuery.docs[0].id;

            // Find the community by its Discord Server ID
            const communityQuery = await db.collection('communitys').where('discordServerId', '==', discordServerId).limit(1).get();
            if (communityQuery.empty) return;
            
            const communityDoc = communityQuery.docs[0];
            const communityId = communityDoc.id;
            const communityData = communityDoc.data();

            const memberRoleIds = newMember.roles.cache.map(r => r.id);
            const newRanks = communityData.ranks
                .filter(rank => memberRoleIds.includes(rank.discordRoleId))
                .map(rank => rank.name.toLowerCase());

            if (communityData.ownerId === appUserId && !newRanks.includes('owner')) {
                newRanks.push('owner');
            }

            const defaultRankName = communityData.defaultRankName?.toLowerCase();
            if (newRanks.length === 0 && defaultRankName) {
                newRanks.push(defaultRankName);
            }

            const memberRef = db.collection('communitys').doc(communityId).collection('members').doc(appUserId);
            await memberRef.update({ roles: newRanks });

            console.log(`[Role Sync] Successfully synced roles for ${newMember.user.tag} in community ${communityData.name}. New roles: [${newRanks.join(', ')}]`);
        } catch (error) {
            console.error(`[Role Sync] Failed to sync roles for ${newMember.user.tag}:`, error);
        }
    },
};