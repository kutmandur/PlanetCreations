const assert = require('node:assert/strict');
const test = require('node:test');
const {isClaimableUpload, settleFailedUpload} = require('./uploadRecovery');
test('processing recovery waits beyond the function timeout and never reclaims completed sessions', () => {
    const now = Date.now(); const timestamp = ms => ({toMillis: () => ms});
    const session = {status: 'processing', processingAt: timestamp(now - 5 * 60000), expiresAt: timestamp(now + 60000)};
    assert.equal(isClaimableUpload(session, now), false);
    assert.equal(isClaimableUpload({...session, processingAt: timestamp(now - 11 * 60000)}, now), true);
    assert.equal(isClaimableUpload({...session, status: 'completed'}, now), false);
});
test('uncertain successful commits and a newer processor never authorize object cleanup', async () => {
    for (const data of [{status: 'completed', destinationKey: 'published'}, {status: 'processing', processingToken: 'new'}]) {
        let writes = 0;
        const db = {runTransaction: callback => callback({get: async () => ({data: () => data}), update: () => {writes++;}})};
        const result = await settleFailedUpload(db, {}, 'old', new Error('Connection lost'));
        assert.notEqual(result.cleanup, true); assert.equal(writes, 0);
    }
});
