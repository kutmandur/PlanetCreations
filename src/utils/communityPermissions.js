export const COMMUNITY_PERMISSION_DEFINITIONS = [
    {
        key: 'addCreations',
        rankField: 'canAddCreations',
        label: 'Add creations',
        description: 'Add or remove own creations from the community.',
        defaultEnabled: true,
        moderatorDefaultEnabled: true,
        group: 'Member permissions',
    },
    {
        key: 'applyShowcase',
        rankField: 'canApplyShowcase',
        label: 'Apply for showcases',
        description: 'Submit an added creation for showcase consideration.',
        defaultEnabled: true,
        moderatorDefaultEnabled: true,
        group: 'Member permissions',
    },
    {
        key: 'participateEvents',
        rankField: 'canParticipateEvents',
        label: 'Participate in events',
        description: 'Submit creations and vote in community events.',
        defaultEnabled: true,
        moderatorDefaultEnabled: true,
        group: 'Member permissions',
    },
    {
        key: 'createEvents',
        rankField: 'canCreateEvents',
        label: 'Create events',
        description: 'Create events and manage events created by this member.',
        defaultEnabled: false,
        moderatorDefaultEnabled: true,
        group: 'Member permissions',
    },
    {
        key: 'manageMembers',
        rankField: 'canManageMembers',
        label: 'Manage members',
        description: 'Assign custom ranks and remove lower-ranked members.',
        defaultEnabled: false,
        moderatorDefaultEnabled: true,
        group: 'Management permissions',
    },
    {
        key: 'manageInvitations',
        rankField: 'canManageInvitations',
        label: 'Manage invitations',
        description: 'Search for users and send community invitations.',
        defaultEnabled: false,
        moderatorDefaultEnabled: true,
        group: 'Management permissions',
    },
    {
        key: 'manageJoinRequests',
        rankField: 'canManageJoinRequests',
        label: 'Manage join requests',
        description: 'Review, approve and decline membership applications.',
        defaultEnabled: false,
        moderatorDefaultEnabled: true,
        group: 'Management permissions',
    },
    {
        key: 'manageCreations',
        rankField: 'canManageCreations',
        label: 'Manage community creations',
        description: 'Pin, feature or remove creations in the community manager.',
        defaultEnabled: false,
        moderatorDefaultEnabled: true,
        group: 'Management permissions',
    },
    {
        key: 'manageShowcases',
        rankField: 'canManageShowcases',
        label: 'Manage showcases',
        description: 'Review showcase applications and manage showcase groups and videos.',
        defaultEnabled: false,
        moderatorDefaultEnabled: true,
        group: 'Management permissions',
    },
    {
        key: 'manageEvents',
        rankField: 'canManageEvents',
        label: 'Manage events',
        description: 'Edit and manage every event in the community.',
        defaultEnabled: false,
        moderatorDefaultEnabled: true,
        group: 'Management permissions',
    },
];

const buildRankPermissionDefaults = (role = 'custom') => Object.fromEntries(
    COMMUNITY_PERMISSION_DEFINITIONS.map(({
        rankField,
        defaultEnabled,
        moderatorDefaultEnabled,
    }) => [
        rankField,
        role === 'moderator' ? moderatorDefaultEnabled : defaultEnabled,
    ])
);

export const DEFAULT_RANK_PERMISSIONS = Object.freeze(buildRankPermissionDefaults());
export const DEFAULT_MODERATOR_RANK_PERMISSIONS =
    Object.freeze(buildRankPermissionDefaults('moderator'));

export const DEFAULT_COMMUNITY_PERMISSIONS = Object.freeze(
    Object.fromEntries(COMMUNITY_PERMISSION_DEFINITIONS.map(
        ({ key, defaultEnabled }) => [key, defaultEnabled]))
);

export const ALL_COMMUNITY_PERMISSIONS = Object.freeze(
    Object.fromEntries(COMMUNITY_PERMISSION_DEFINITIONS.map(({ key }) => [key, true]))
);

export const NO_COMMUNITY_PERMISSIONS = Object.freeze(
    Object.fromEntries(COMMUNITY_PERMISSION_DEFINITIONS.map(({ key }) => [key, false]))
);

export const MANAGEMENT_PERMISSION_KEYS = Object.freeze(
    COMMUNITY_PERMISSION_DEFINITIONS
        .filter(({ group }) => group === 'Management permissions')
        .map(({ key }) => key)
);

export function getRankPermissionValue(rank, definition, role = 'custom') {
    if (typeof rank?.[definition.rankField] === 'boolean') {
        return rank[definition.rankField];
    }
    return role === 'moderator'
        ? definition.moderatorDefaultEnabled
        : definition.defaultEnabled;
}

export function withDefaultRankPermissions(rank = {}, role = 'custom') {
    return {
        ...(role === 'moderator'
            ? DEFAULT_MODERATOR_RANK_PERMISSIONS
            : DEFAULT_RANK_PERMISSIONS),
        ...rank,
    };
}

export function getRankPermissionFields(rank, role = 'custom') {
    return Object.fromEntries(COMMUNITY_PERMISSION_DEFINITIONS.map(definition => [
        definition.rankField,
        getRankPermissionValue(rank, definition, role),
    ]));
}

export function getEffectiveCommunityPermissions(community, member) {
    if (!member) return { ...NO_COMMUNITY_PERMISSIONS };

    const roles = (member.roles || []).map(role => String(role).toLowerCase());
    if (roles.includes('owner')) return { ...ALL_COMMUNITY_PERMISSIONS };

    const ranks = community?.ranks || [];

    // Very old communities without a rank array behaved as fully open for
    // members. Preserve the legacy defaults, except event creation which is
    // intentionally opt-in for regular ranks.
    if (ranks.length === 0 && roles.length > 0) {
        if (roles.includes('moderator')) return { ...ALL_COMMUNITY_PERMISSIONS };
        return { ...DEFAULT_COMMUNITY_PERMISSIONS };
    }

    const memberRanks = ranks.filter(rank =>
        roles.includes(String(rank.name || '').toLowerCase())
    );
    if (
        roles.includes('moderator') &&
        !memberRanks.some(rank =>
            String(rank.name || '').toLowerCase() === 'moderator')
    ) {
        return { ...ALL_COMMUNITY_PERMISSIONS };
    }

    return Object.fromEntries(COMMUNITY_PERMISSION_DEFINITIONS.map(definition => [
        definition.key,
        memberRanks.some(rank =>
            getRankPermissionValue(
                rank,
                definition,
                String(rank.name || '').toLowerCase() === 'moderator'
                    ? 'moderator'
                    : 'custom'
            )),
    ]));
}

export function hasCommunityPermission(community, member, permission) {
    return getEffectiveCommunityPermissions(community, member)[permission] === true;
}

export function hasAnyCommunityManagementPermission(community, member) {
    const permissions = getEffectiveCommunityPermissions(community, member);
    return MANAGEMENT_PERMISSION_KEYS.some(key => permissions[key] === true);
}
