const { EmbedBuilder } = require('discord.js');
const { db } = require('./firebase');

async function buildCreationEmbed(creationId, communityId, includeVoteCounter) {
    const communityDoc = await db.collection('communitys').doc(communityId).get();
    const creationDoc = await db.collection('creations').doc(creationId).get();

    if (!communityDoc.exists || !creationDoc.exists) {
        throw new Error(`Community (${communityId}) or Creation (${creationId}) not found for embed.`);
    }

    const communityData = communityDoc.data();
    const creationData = creationDoc.data();
    const embed = new EmbedBuilder()
        .setColor(communityData.themeColor || '#F97316')
        .setTitle(creationData.title)
        // HashRouter: ohne /#/ landet der Link auf der Startseite
        .setURL(`https://planetcreations.net/#/creation/${creationId}`)
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