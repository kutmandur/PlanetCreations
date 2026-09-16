const { EmbedBuilder } = require('discord.js');


async function buildCreationEmbed(creationId, communityId, includeVoteCounter, loaded = {}) {
    const db = loaded.communityData && loaded.creationData ? null : require('./firebase').db;
    const communityData = loaded.communityData || (await db.collection('communitys').doc(communityId).get()).data();
    const creationData = loaded.creationData || (await db.collection('creations').doc(creationId).get()).data();
    if (!communityData || !creationData) {
        throw new Error(`Community (${communityId}) or Creation (${creationId}) not found for embed.`);
    }

    const embed = new EmbedBuilder()
        .setColor(communityData.themeColor || '#F97316')
        .setTitle(creationData.title)
        .setURL(`https://planetcreations.net/creation/${creationId}`)
        .setAuthor({ name: creationData.username, iconURL: creationData.userProfilePictureUrl || undefined })
        .setTimestamp(creationData.createdAt.toDate());
    
    if (creationData.description) {
        embed.setDescription(creationData.description.substring(0, 250) + (creationData.description.length > 250 ? '...' : ''));
    }
    if (creationData.imageUrls && creationData.imageUrls.length > 0) {
        embed.setImage(creationData.imageUrls[0]);
    }
    
    if (includeVoteCounter) {
        embed.addFields({
            name: 'Votes',
            value: `👍 ${creationData.likes || 0}   |   👎 ${creationData.dislikes || 0}`,
            inline: true
        });
    }
    
    return embed;
}

module.exports = { buildCreationEmbed };
