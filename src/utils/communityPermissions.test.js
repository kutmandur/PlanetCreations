import {
  DEFAULT_MODERATOR_RANK_PERMISSIONS,
  DEFAULT_RANK_PERMISSIONS,
  getEffectiveCommunityPermissions,
  hasAnyCommunityManagementPermission,
  hasCommunityPermission,
} from './communityPermissions';

const community = {
  ranks: [
    {
      name: 'Builder',
      canAddCreations: true,
      canApplyShowcase: false,
      canParticipateEvents: false,
      canCreateEvents: false,
      canManageCreations: true,
    },
    {
      name: 'Event Host',
      canAddCreations: false,
      canApplyShowcase: false,
      canParticipateEvents: true,
      canCreateEvents: true,
    },
  ],
};

test('returns no permissions for a non-member', () => {
  expect(Object.values(
    getEffectiveCommunityPermissions(community, null)
  ).every(value => value === false)).toBe(true);
});

test('unions permissions from every assigned custom rank', () => {
  const permissions = getEffectiveCommunityPermissions(community, {
    roles: ['builder', 'event host'],
  });
  expect(permissions).toMatchObject({
    addCreations: true,
    applyShowcase: false,
    participateEvents: true,
    createEvents: true,
  });
  expect(permissions.manageMembers).toBe(false);
  expect(permissions.manageCreations).toBe(true);
  expect(permissions.manageEvents).toBe(false);
});

test('shows management UI only when at least one management right is enabled', () => {
  expect(hasAnyCommunityManagementPermission(
    community,
    { roles: ['event host'] }
  )).toBe(false);
  expect(hasAnyCommunityManagementPermission(
    community,
    { roles: ['builder'] }
  )).toBe(true);
});

test('keeps legacy member activities enabled but defaults event creation off', () => {
  const legacyCommunity = { ranks: [{ name: 'Member' }] };
  expect(getEffectiveCommunityPermissions(legacyCommunity, {
    roles: ['member'],
  })).toMatchObject({
    addCreations: true,
    applyShowcase: true,
    participateEvents: true,
    createEvents: false,
    manageMembers: false,
    manageEvents: false,
  });
});

test('defaults event creation and management off for new custom ranks', () => {
  expect(DEFAULT_RANK_PERMISSIONS).toMatchObject({
    canAddCreations: true,
    canApplyShowcase: true,
    canParticipateEvents: true,
    canCreateEvents: false,
    canManageMembers: false,
    canManageInvitations: false,
    canManageJoinRequests: false,
    canManageCreations: false,
    canManageShowcases: false,
    canManageEvents: false,
  });
});

test('moderator permissions default on', () => {
  expect(Object.values(DEFAULT_MODERATOR_RANK_PERMISSIONS)
    .every(value => value === true)).toBe(true);
});

test('owner always has every permission', () => {
  expect(hasCommunityPermission(community, { roles: ['owner'] }, 'createEvents')).toBe(true);
  expect(hasCommunityPermission(community, { roles: ['owner'] }, 'manageMembers')).toBe(true);
});

test('moderator management permissions can be disabled', () => {
  const configurableModeratorCommunity = {
    ranks: [{
      name: 'Moderator',
      canManageMembers: false,
      canManageEvents: true,
    }],
  };
  expect(hasCommunityPermission(
    configurableModeratorCommunity,
    { roles: ['moderator'] },
    'manageMembers'
  )).toBe(false);
  expect(hasCommunityPermission(
    configurableModeratorCommunity,
    { roles: ['moderator'] },
    'manageEvents'
  )).toBe(true);
});
