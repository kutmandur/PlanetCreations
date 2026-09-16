const test = require('node:test');
const assert = require('node:assert/strict');
const {referencesCreation, assertOwnedMessage, assertCommunityGuildAccess} = require('./messageOwnership');
const client = {user: {id: 'bot'}};
const channel = {id: 'channel', guildId: 'guild'};
const binding = {channelId: 'channel', guildId: 'guild'};
const message = {author: {id: 'bot'}, embeds: [{url: 'https://planetcreations.net/creation/park'}]};
test('current and released legacy Creation links prove the intended content', () => {
    assert.equal(referencesCreation(message, 'park'), true);
    assert.equal(referencesCreation({...message, embeds: [{url: 'https://www.planetcreations.net/#/creation/park'}]}, 'park'), true);
    assert.doesNotThrow(() => assertOwnedMessage(client, channel, message, binding, 'park'));
});
test('foreign authors, guilds, channels, creation IDs and deceptive URLs cannot authorize deletion', () => {
    for (const [ch, msg, id] of [
        [channel, {...message, author: {id: 'victim'}}, 'park'],
        [{...channel, guildId: 'other'}, message, 'park'],
        [{...channel, id: 'other'}, message, 'park'],
        [channel, message, 'other'],
        [channel, {...message, embeds: [{url: 'https://planetcreations.net.evil.test/creation/park'}]}, 'park'],
    ]) assert.throws(() => assertOwnedMessage(client, ch, msg, binding, id), {needsReview: true});
});
test('knowing a guild ID does not authorize posting to it', async () => {
    const db = {doc: () => ({get: async () => ({data: () => ({discordId: 'owner'})})})};
    const ch = {...channel, isTextBased: () => true, guild: {members: {fetch: async () => ({permissions: {has: () => false}})}}};
    await assert.rejects(assertCommunityGuildAccess(client, db, {ownerId: 'owner', discordServerId: 'guild'}, ch), {needsReview: true});
    ch.guild.members.fetch = async () => ({permissions: {has: () => true}});
    await assertCommunityGuildAccess(client, db, {ownerId: 'owner', discordServerId: 'guild'}, ch);
});
