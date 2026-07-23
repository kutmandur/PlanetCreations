const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getEffectiveCommunityPermissionKeys,
    hashCommunityPassword,
    verifyCommunityPassword,
} = require('./communityMembership');

test('unions effective permissions across custom ranks', () => {
    const community = {
        ranks: [
            {
                name: 'Builder',
                canAddCreations: true,
                canCreateEvents: false,
                canManageCreations: true,
            },
            { name: 'Host', canAddCreations: false, canCreateEvents: true },
        ],
    };
    const permissions = getEffectiveCommunityPermissionKeys(
        community, { roles: ['builder', 'host'] });
    assert.deepEqual(permissions, [
        'addCreations',
        'applyShowcase',
        'participateEvents',
        'createEvents',
        'manageCreations',
    ]);
});

test('owner receives every community permission', () => {
    const noPermissions = {
        ranks: [{
            name: 'Member',
            canAddCreations: false,
            canApplyShowcase: false,
            canParticipateEvents: false,
            canCreateEvents: false,
        }],
    };
    assert.equal(
        getEffectiveCommunityPermissionKeys(noPermissions, { roles: ['owner'] }).length,
        10);
});

test('moderator permissions default on but can be disabled', () => {
    const community = {
        ranks: [{
            name: 'Moderator',
            canManageMembers: false,
        }],
    };
    const permissions = getEffectiveCommunityPermissionKeys(
        community,
        { roles: ['moderator'] }
    );
    assert.equal(permissions.includes('manageMembers'), false);
    assert.equal(permissions.includes('manageEvents'), true);
    assert.equal(permissions.includes('createEvents'), true);
});

test('defaults event creation off when a custom rank has no explicit flag', () => {
    const permissions = getEffectiveCommunityPermissionKeys(
        { ranks: [{ name: 'Member' }] },
        { roles: ['member'] });
    assert.deepEqual(permissions, [
        'addCreations',
        'applyShowcase',
        'participateEvents',
    ]);
});

test('custom ranks default every management permission off', () => {
    const permissions = getEffectiveCommunityPermissionKeys(
        { ranks: [{ name: 'Member' }] },
        { roles: ['member'] }
    );
    assert.equal(permissions.some(permission =>
        permission.startsWith('manage')), false);
});

test('password hash verifies only the matching password and stores no plaintext', () => {
    const stored = hashCommunityPassword('correct horse battery staple', 'fixed-test-salt');
    assert.equal(stored.salt, 'fixed-test-salt');
    assert.notEqual(stored.hash, 'correct horse battery staple');
    assert.equal(verifyCommunityPassword('correct horse battery staple', stored), true);
    assert.equal(verifyCommunityPassword('wrong password', stored), false);
    assert.equal(verifyCommunityPassword('anything', { salt: 'bad', hash: 'not-hex' }), false);
});
