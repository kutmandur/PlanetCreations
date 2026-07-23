import { getCommunityManagerTabs } from './communityManagerTabs';

const allManagementPermissions = {
  manageCreations: true,
  manageMembers: true,
  manageInvitations: true,
  manageJoinRequests: true,
  manageEvents: true,
  manageShowcases: true,
};

test('shows Requests while application joining is enabled', () => {
  expect(getCommunityManagerTabs(
    { joinMode: 'application' },
    false,
    allManagementPermissions
  ))
    .toContain('Requests');
});

test('keeps Requests visible while an old pending request still exists', () => {
  expect(getCommunityManagerTabs(
    { joinMode: 'invite' },
    true,
    allManagementPermissions
  ))
    .toContain('Requests');
});

test('hides Requests when applications are disabled and none are pending', () => {
  expect(getCommunityManagerTabs(
    { joinMode: 'open' },
    false,
    allManagementPermissions
  ))
    .not.toContain('Requests');
});

test('hides Settings from community moderators without owner access', () => {
  expect(getCommunityManagerTabs(
    { joinMode: 'application' },
    false,
    allManagementPermissions,
    false
  ))
    .not.toContain('Settings');
});

test('shows only management areas granted to a custom rank', () => {
  expect(getCommunityManagerTabs(
    { joinMode: 'application' },
    false,
    {
      manageJoinRequests: true,
      manageShowcases: true,
    },
    false
  )).toEqual(['Requests', 'Showcases']);
});

test('keeps the Members tab for invitation-only ranks without member management', () => {
  expect(getCommunityManagerTabs(
    { joinMode: 'open' },
    false,
    { manageInvitations: true },
    false
  )).toEqual(['Members']);
});
