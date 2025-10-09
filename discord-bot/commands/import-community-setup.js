const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// Wir müssen die syncCommunitySetup-Funktion importieren.
// Dafür lagern wir sie am besten auch in eine eigene Datei aus.
// Zuerst müssen wir sie in bot.js definieren und exportieren.
// Fürs Erste definieren wir sie hier, später lagern wir sie aus.
const { ChannelType } = require('discord.js');

async function syncCommunitySetup(guild, db) {
    if (!guild) return;
    console.log(`[Sync Setup] Starting sync for server: ${guild.name} (${guild.id})`);
    try {
        const communityQuery = await db.collection('communitys').where('discordServerId', '==', guild.id).limit(1).get();
        if (communityQuery.empty) return;
        const communityRef = communityQuery.docs[0].ref;
        await guild.roles.fetch();
        const roles = guild.roles.cache.filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name, color: r.hexColor }));
        await guild.channels.fetch();
        const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name }));
        await communityRef.update({ discordRoles: roles, discordChannels: channels });
        console.log(`[Sync Setup] ✅ Synced ${roles.length} roles and ${channels.length} channels for ${guild.name}.`);
        return true;
    } catch (error) {
        console.error(`[Sync Setup] ❌ Failed to sync setup for guild ${guild.id}:`, error);
        return false;
    }
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('import-community-setup')
        .setDescription('Imports all roles and text channels into your community settings.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });
        const success = await syncCommunitySetup(interaction.guild, db);
        if (success) {
            await interaction.editReply({ content: '✅ Manual sync complete!' });
        } else {
            await interaction.editReply({ content: '❌ Manual sync failed. Check console for details.' });
        }
    },
};