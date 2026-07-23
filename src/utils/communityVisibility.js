const SITE_STAFF_ROLES = new Set(['admin', 'moderator']);

export const isCommunityInfoRestricted = community =>
  community?.membersOnlyInfoPage === true;

export const canViewCommunityInfo = (community, isMember, userProfile, userId) =>
  !isCommunityInfoRestricted(community) ||
  isMember === true ||
  (!!userId && community?.ownerId === userId) ||
  SITE_STAFF_ROLES.has(userProfile?.role);
