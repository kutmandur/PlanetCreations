import {
  canViewCommunityInfo,
  isCommunityInfoRestricted,
} from './communityVisibility';

test('keeps legacy and public community info pages visible', () => {
  expect(isCommunityInfoRestricted({})).toBe(false);
  expect(canViewCommunityInfo({}, false, null)).toBe(true);
  expect(canViewCommunityInfo({ membersOnlyInfoPage: false }, false, null)).toBe(true);
});

test('restricts a members-only info page for guests and non-members', () => {
  const community = { membersOnlyInfoPage: true };

  expect(canViewCommunityInfo(community, false, null)).toBe(false);
  expect(canViewCommunityInfo(community, false, { role: 'user' })).toBe(false);
});

test('allows members and site staff to view a members-only info page', () => {
  const community = { membersOnlyInfoPage: true };

  expect(canViewCommunityInfo(community, true, { role: 'user' })).toBe(true);
  expect(canViewCommunityInfo(community, false, { role: 'moderator' })).toBe(true);
  expect(canViewCommunityInfo(community, false, { role: 'admin' })).toBe(true);
});

test('allows the community owner even if their membership index is delayed', () => {
  const community = { membersOnlyInfoPage: true, ownerId: 'owner-1' };

  expect(canViewCommunityInfo(community, false, { role: 'influencer' }, 'owner-1'))
    .toBe(true);
});
