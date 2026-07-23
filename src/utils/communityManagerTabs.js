export const getCommunityManagerTabs = (
  community,
  hasPendingJoinRequests,
  permissions,
  canManageSettings = false
) => [
  ...(permissions?.manageCreations ? ['Creations'] : []),
  ...(
    permissions?.manageMembers || permissions?.manageInvitations
      ? ['Members']
      : []
  ),
  ...(
    permissions?.manageJoinRequests &&
    (community?.joinMode === 'application' || hasPendingJoinRequests)
      ? ['Requests']
      : []
  ),
  ...(permissions?.manageEvents ? ['Events'] : []),
  ...(permissions?.manageShowcases ? ['Showcases'] : []),
  ...(canManageSettings ? ['Settings'] : []),
];
