const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong! to check if the bot is alive.'),
    async execute(interaction) {
        await interaction.reply('Pong! 🏓');
    },
};