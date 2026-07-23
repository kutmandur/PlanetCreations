const crypto = require('crypto');

const COMMUNITY_PERMISSION_DEFINITIONS = [
    ['addCreations', 'canAddCreations', true, true],
    ['applyShowcase', 'canApplyShowcase', true, true],
    ['participateEvents', 'canParticipateEvents', true, true],
    ['createEvents', 'canCreateEvents', false, true],
    ['manageMembers', 'canManageMembers', false, true],
    ['manageInvitations', 'canManageInvitations', false, true],
    ['manageJoinRequests', 'canManageJoinRequests', false, true],
    ['manageCreations', 'canManageCreations', false, true],
    ['manageShowcases', 'canManageShowcases', false, true],
    ['manageEvents', 'canManageEvents', false, true],
];

const ALL_COMMUNITY_PERMISSION_KEYS =
    COMMUNITY_PERMISSION_DEFINITIONS.map(([key]) => key);
const DEFAULT_COMMUNITY_PERMISSION_KEYS =
    COMMUNITY_PERMISSION_DEFINITIONS
        .filter(([, , defaultEnabled]) => defaultEnabled)
        .map(([key]) => key);

const getEffectiveCommunityPermissionKeys = (communityData, memberData) => {
    const roles = (memberData?.roles || []).map(role => String(role).toLowerCase());
    if (roles.includes('owner')) {
        return [...ALL_COMMUNITY_PERMISSION_KEYS];
    }

    const ranks = Array.isArray(communityData?.ranks) ? communityData.ranks : [];
    if (ranks.length === 0 && roles.length > 0) {
        if (roles.includes('moderator')) return [...ALL_COMMUNITY_PERMISSION_KEYS];
        return [...DEFAULT_COMMUNITY_PERMISSION_KEYS];
    }

    const memberRanks = ranks.filter(rank =>
        roles.includes(String(rank.name || '').toLowerCase()));
    if (roles.includes('moderator') && !memberRanks.some(rank =>
        String(rank.name || '').toLowerCase() === 'moderator')) {
        return [...ALL_COMMUNITY_PERMISSION_KEYS];
    }
    return COMMUNITY_PERMISSION_DEFINITIONS
        .filter(([, rankField, defaultEnabled, moderatorDefaultEnabled]) =>
            memberRanks.some(rank => {
                const fallback = String(rank.name || '').toLowerCase() === 'moderator'
                    ? moderatorDefaultEnabled
                    : defaultEnabled;
                return (
                    typeof rank[rankField] === 'boolean'
                        ? rank[rankField]
                        : fallback
                );
            }))
        .map(([key]) => key);
};

const hashCommunityPassword = (
    password,
    salt = crypto.randomBytes(16).toString('hex')
) => ({
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex'),
});

const verifyCommunityPassword = (password, stored) => {
    if (!stored || typeof stored.salt !== 'string' || typeof stored.hash !== 'string') {
        return false;
    }
    try {
        const candidate = crypto.scryptSync(password, stored.salt, 64);
        const expected = Buffer.from(stored.hash, 'hex');
        return candidate.length === expected.length &&
            crypto.timingSafeEqual(candidate, expected);
    } catch {
        return false;
    }
};

module.exports = {
    ALL_COMMUNITY_PERMISSION_KEYS,
    COMMUNITY_PERMISSION_DEFINITIONS,
    getEffectiveCommunityPermissionKeys,
    hashCommunityPassword,
    verifyCommunityPassword,
};
