const test = require('node:test');
const assert = require('node:assert/strict');
const {processDelivery} = require('./discordDeliveries');
function fixture({present = true, binding = null, author = 'bot', sendingSince = null} = {}) {
    const records = new Map([
        ['discordDeliveries/job', {communityId: 'community', creationId: 'park', kind: 'general', pending: true, present, binding, revision: 1, sendingSince}],
        ['communitys/community', {ownerId: 'owner', discordServerId: 'guild', discordGeneralChannelId: 'channel'}],
        ['creations/park', {title: 'Park', username: 'Owner', createdAt: {toDate: () => new Date(0)}}],
        ['communitys/community/creations/park', {}],
        ['users/owner', {discordId: 'linked-owner'}],
    ]);
    const db = {doc: path => ({path, id: path.split('/').at(-1), get: async () => ({exists: records.has(path), data: () => records.get(path)}), update: async data => {records.set(path, {...records.get(path), ...data});}})};
    db.runTransaction = callback => callback({get: ref => ref.get(), update: (ref, data) => ref.update(data)});
    const calls = {send: 0, edit: 0, delete: 0};
    const message = {id: 'message', author: {id: author}, embeds: [{url: 'https://planetcreations.net/creation/park'}],
        delete: async () => {calls.delete++;}, edit: async () => {calls.edit++;}};
    const channel = {id: 'channel', guildId: 'guild', isTextBased: () => true,
        guild: {members: {fetch: async () => ({permissions: {has: () => true}})}},
        messages: {fetch: async input => typeof input === 'object' ? [] : message},
        send: async () => {calls.send++; return message;}};
    const client = {user: {id: 'bot'}, channels: {fetch: async () => channel}};
    return {db, client, calls, records, channel, message, ref: db.doc('discordDeliveries/job')};
}
test('new post is acknowledged and retry does not post twice', async () => {
    const f = fixture(); await processDelivery(f.client, f.db, f.ref); await processDelivery(f.client, f.db, f.ref);
    assert.equal(f.calls.send, 1); assert.equal(f.records.get(f.ref.path).pending, false);
    assert.equal(f.records.get(f.ref.path).binding.messageId, 'message');
});
test('a protected own mapping survives unlinking and can be deleted; foreign authors cannot', async () => {
    for (const author of ['bot', 'victim']) {
        const f = fixture({present: false, author, binding: {messageId: 'message', channelId: 'channel', guildId: 'guild'}});
        f.records.delete('communitys/community/creations/park');
        await processDelivery(f.client, f.db, f.ref);
        assert.equal(f.calls.delete, author === 'bot' ? 1 : 0);
        if (author !== 'bot') assert.equal(f.records.get(f.ref.path).status, 'needs-review');
    }
});
test('uncertain send is reconciled by the owned footer; a new revision remains pending', async () => {
    const f = fixture({sendingSince: new Date()});
    f.message.embeds[0].footer = {text: 'PlanetCreations:job'};
    f.channel.messages.fetch = async () => [f.message];
    f.message.edit = async () => { f.calls.edit++; await f.ref.update({revision: 2}); };
    await processDelivery(f.client, f.db, f.ref);
    assert.equal(f.calls.send, 0); assert.equal(f.calls.edit, 1);
    assert.equal(f.records.get(f.ref.path).pending, true);
    assert.equal(f.records.get(f.ref.path).binding.messageId, 'message');
});
test('failed deletion remains pending for retry', async () => {
    const f = fixture({present: false, binding: {messageId: 'message', channelId: 'channel', guildId: 'guild'}});
    f.message.delete = async () => {throw new Error('Discord unavailable');};
    await processDelivery(f.client, f.db, f.ref);
    assert.equal(f.records.get(f.ref.path).pending, true);
    assert.equal(f.records.get(f.ref.path).status, 'retry');
});
