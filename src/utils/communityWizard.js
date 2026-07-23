const COMMUNITY_SOCIAL_FIELDS = [
  { id: 'youtube', label: 'YouTube Channel' },
  { id: 'discord', label: 'Discord Invite' },
  { id: 'twitch', label: 'Twitch' },
  { id: 'x', label: 'X (Twitter)' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'website', label: 'Website' },
];

const containsBlacklistedWord = (text, blacklist) => {
  if (!text || !Array.isArray(blacklist) || blacklist.length === 0) {
    return false;
  }
  const escaped = blacklist
    .filter(Boolean)
    .map(word => String(word).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  if (escaped.length === 0) return false;
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i').test(String(text));
};

export const COMMUNITY_JOIN_MODES = [
  {
    id: 'open',
    label: 'Open',
    description: 'Signed-in users can join immediately.',
  },
  {
    id: 'application',
    label: 'Application',
    description: 'People apply and authorized community members review each request.',
  },
  {
    id: 'password',
    label: 'Password',
    description: 'People need the private community password before they can join.',
  },
  {
    id: 'invite',
    label: 'Invite only',
    description: 'Only people with a current invitation can join.',
  },
];

export const slugifyCommunityName = (value = '') => String(value)
  .toLowerCase()
  .trim()
  .replace(/\s+/g, '-')
  .replace(/[^\w-]+/g, '')
  .replace(/--+/g, '-')
  .replace(/^-+/, '')
  .replace(/-+$/, '');

export const isOptionalHttpUrl = (value, httpsOnly = false) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return httpsOnly
      ? parsed.protocol === 'https:'
      : ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

export const cleanCommunitySocialLinks = (socialLinks = {}) =>
  Object.fromEntries(COMMUNITY_SOCIAL_FIELDS
    .map(platform => [platform.id, String(socialLinks[platform.id] || '').trim()])
    .filter(([, value]) => value));

const validateRanks = (
  ranks = [],
  defaultRankIndex = 0,
  ownerRankData = {},
  moderatorRankData = {}
) => {
  const namedRanks = ranks.filter(rank => String(rank.name || '').trim());
  if (namedRanks.length === 0) {
    return 'Create at least one custom rank.';
  }
  if (namedRanks.length !== ranks.length) {
    return 'Every custom rank needs a name.';
  }
  if (namedRanks.some(rank => rank.name.trim().length > 50)) {
    return 'Custom rank names can contain up to 50 characters.';
  }
  const normalizedNames = namedRanks.map(rank => rank.name.trim().toLowerCase());
  if (normalizedNames.some(name => ['owner', 'moderator'].includes(name))) {
    return 'Custom ranks cannot be named Owner or Moderator.';
  }
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return 'Every custom rank name must be unique.';
  }
  if (!ranks[defaultRankIndex]?.name?.trim()) {
    return 'Choose a valid default rank.';
  }
  const rankWithInvalidImage = [
    ownerRankData,
    moderatorRankData,
    ...ranks,
  ].find(rank => !isOptionalHttpUrl(rank?.imageUrl));
  if (rankWithInvalidImage) {
    return 'Every rank image must be a valid http(s) URL.';
  }
  return null;
};

export const getCommunityWizardStepError = (
  stepId,
  state,
  blacklist = []
) => {
  switch (stepId) {
    case 'basics': {
      const name = String(state.name || '').trim();
      const description = String(state.description || '').trim();
      if (name.length < 3 || name.length > 100) {
        return 'Community name must be between 3 and 100 characters.';
      }
      if (!slugifyCommunityName(name)) {
        return 'Choose a community name that can be used in a URL.';
      }
      if (!description || description.length > 2000) {
        return 'Description is required and can contain up to 2,000 characters.';
      }
      if (
        containsBlacklistedWord(name, blacklist) ||
        containsBlacklistedWord(description, blacklist)
      ) {
        return 'Community name or description contains a forbidden word.';
      }
      return null;
    }
    case 'appearance':
      if (!isOptionalHttpUrl(state.bannerImageUrl)) {
        return 'Banner Image URL must be a valid http(s) URL.';
      }
      if (!isOptionalHttpUrl(state.profileImageUrl)) {
        return 'Profile Image URL must be a valid http(s) URL.';
      }
      return null;
    case 'games':
      if (!Array.isArray(state.allowedGames) || state.allowedGames.length === 0) {
        return 'Select at least one game.';
      }
      if (!state.allowedGames.includes(state.mainGame)) {
        return 'Choose one of the enabled games as the main game.';
      }
      return null;
    case 'membership':
      if (
        state.joinMode === 'password' &&
        (String(state.joinPassword || '').length < 6 ||
          String(state.joinPassword || '').length > 128)
      ) {
        return 'The join password must be between 6 and 128 characters.';
      }
      return null;
    case 'connections': {
      const invalidPlatform = COMMUNITY_SOCIAL_FIELDS.find(platform =>
        !isOptionalHttpUrl(state.socialLinks?.[platform.id], true));
      if (invalidPlatform) {
        return `${invalidPlatform.label} link must be a valid https:// URL.`;
      }
      const serverId = String(state.discordServerId || '').trim();
      if (serverId && !/^\d{17,20}$/.test(serverId)) {
        return 'Discord Server ID must contain 17 to 20 digits.';
      }
      return null;
    }
    case 'ranks':
      return validateRanks(
        state.ranks,
        state.defaultRankIndex,
        state.ownerRankData,
        state.moderatorRankData
      );
    default:
      return null;
  }
};

export const getFirstCommunityWizardError = (
  stepIds,
  state,
  blacklist = []
) => {
  for (const stepId of stepIds) {
    const error = getCommunityWizardStepError(stepId, state, blacklist);
    if (error) return { stepId, error };
  }
  return null;
};
