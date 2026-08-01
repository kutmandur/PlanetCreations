const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageReactionRemove,
    async execute(messageReaction, user, db) {
        // This logic is identical to messageReactionAdd
        if (messageReaction.emoji.name !== '👍') return;

        const message = messageReaction.message;
        console.log(`[Reaction] 👍 removed from message ${message.id}`);

        try {
            const linksQuery = await db.collectionGroup('creations').where('discordMessageId', '==', message.id).limit(1).get();
            if (linksQuery.empty) return;

            const linkDocRef = linksQuery.docs[0].ref;
            const newCount = messageReaction.count;

            await linkDocRef.update({ reactionCount: newCount });
            console.log(`[Reaction] Updated count for message ${message.id} to ${newCount}`);
        } catch (error) {
            console.error(`[Reaction] Failed to update reaction count on remove:`, error);
        }
    },
};
