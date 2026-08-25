export const RESERVED_COMMUNITY_SLUGS = new Set([
  'admin',
  'api',
  'assets',
  'client',
  'client-info',
  'collaboration',
  'community',
  'community-guidelines',
  'communitys',
  'create',
  'create-community',
  'creation',
  'event',
  'favicon',
  'firebase-messaging-sw',
  'impressum',
  'index',
  'login',
  'manager',
  'manifest',
  'moderation',
  'privacy',
  'profile',
  'robots',
  'settings',
  'share',
  'showcase',
  'sitemap',
  'terms-of-service',
]);

export const slugifyCommunityName = (value = '') => String(value)
  .toLowerCase()
  .trim()
  .replace(/\s+/g, '-')
  .replace(/[^a-z0-9-]+/g, '')
  .replace(/--+/g, '-')
  .replace(/^-+/, '')
  .replace(/-+$/, '');

export const isReservedCommunitySlug = (slug) =>
  RESERVED_COMMUNITY_SLUGS.has(String(slug || '').toLowerCase());

export const getCommunitySlugError = (slug) => {
  const normalized = String(slug || '').toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    return 'Choose a community name that can be used in a URL.';
  }
  if (isReservedCommunitySlug(normalized)) {
    return 'This community URL is reserved by PlanetCreations.';
  }
  return null;
};

export const buildCommunityPath = (slug) =>
  `/${encodeURIComponent(String(slug || '').toLowerCase())}`;
