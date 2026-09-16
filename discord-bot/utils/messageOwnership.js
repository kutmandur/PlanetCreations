const {PermissionFlagsBits} = require('discord.js');
function referencesCreation(message, creationId) {
    return (message.embeds || []).some(embed => {
        try {
            const url = new URL(embed.url || embed.data?.url);
            return url.protocol === 'https:' && ['planetcreations.net', 'www.planetcreations.net'].includes(url.hostname) &&
                [url.pathname, url.hash.replace(/^#/, '')].some(path => path === `/creation/${creationId}`);
        } catch { return false; }
    });
}
function assertOwnedMessage(client, channel, message, binding, creationId) {
    if (!binding.guildId || channel.guildId !== binding.guildId || channel.id !== binding.channelId ||
        message.author?.id !== client.user.id || !referencesCreation(message, creationId)) {
        throw Object.assign(new Error('Discord mapping needs review: guild, author or Creation link mismatch.'), {needsReview: true});
    }
}
async function assertCommunityGuildAccess(client, db, community, channel) {
    if (!community.discordServerId || channel.guildId !== community.discordServerId || !channel.isTextBased?.()) {
        throw Object.assign(new Error('The configured channel does not belong to the community guild.'), {needsReview: true});
    }
    const owner = await db.doc(`users/${community.ownerId}`).get();
    const discordId = owner.data()?.discordId;
    const member = discordId && await channel.guild.members.fetch(discordId);
    if (!member || !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw Object.assign(new Error('The linked community owner must be allowed to manage this Discord server.'), {needsReview: true});
    }
}
module.exports = {referencesCreation, assertOwnedMessage, assertCommunityGuildAccess};
