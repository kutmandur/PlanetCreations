const { Events } = require('discord.js');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(messageReaction, user, db) {
        // We only care about the thumbs up emoji
        if (messageReaction.emoji.name !== '👍') return;

        const message = messageReaction.message;
        console.log(`[Reaction] 👍 added to message ${message.id}`);

        try {
            // Find the creation link document that corresponds to this message
            const linksQuery = await db.collectionGroup('creations').where('discordMessageId', '==', message.id).limit(1).get();
            if (linksQuery.empty) return;

            const linkDocRef = linksQuery.docs[0].ref;
            const newCount = messageReaction.count;

            // Update the reactionCount field in Firestore
            await linkDocRef.update({ reactionCount: newCount });
            console.log(`[Reaction] Updated count for message ${message.id} to ${newCount}`);
        } catch (error) {
            console.error(`[Reaction] Failed to update reaction count on add:`, error);
        }
    },
};
