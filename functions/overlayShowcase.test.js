const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOverlayShowcaseRequest } = require('./overlayShowcase');

test('normalizes a community overlay showcase and removes duplicate creation IDs', () => {
    assert.deepEqual(normalizeOverlayShowcaseRequest({
        kind: 'community-showcase',
        communityId: 'community-1',
        showcaseId: 'group-1',
        showcaseTitle: ' Park night ',
        creationIds: ['park-1', 'ride-2', 'ride-2'],
        activeCreationId: 'ride-2',
    }), {
        kind: 'community-showcase',
        communityId: 'community-1',
        showcaseId: 'group-1',
        showcaseTitle: 'Park night',
        creationIds: ['park-1', 'ride-2'],
        activeCreationId: 'ride-2',
    });
});

test('rejects an active creation outside the showcase', () => {
    assert.throws(() => normalizeOverlayShowcaseRequest({
        kind: 'community-showcase',
        communityId: 'community-1',
        creationIds: ['park-1'],
        activeCreationId: 'other',
    }), /must be part/);
});
