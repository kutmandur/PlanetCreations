import {
  buildCommunityPath,
  getCommunitySlugError,
  isReservedCommunitySlug,
  slugifyCommunityName,
} from './communityRoutes';

test('builds a root-level community vanity path', () => {
  expect(buildCommunityPath('FinesseSingh')).toBe('/finessesingh');
});
test('normalizes community names to safe vanity slugs', () => {
  expect(slugifyCommunityName('  Coaster Builders!  '))
    .toBe('coaster-builders');
  expect(slugifyCommunityName('Coaster_Builders')).toBe('coasterbuilders');
});

test('protects application and infrastructure paths', () => {
  expect(isReservedCommunitySlug('LOGIN')).toBe(true);
  expect(getCommunitySlugError('creation')).toMatch(/reserved/i);
  expect(getCommunitySlugError('finessesingh')).toBeNull();
});
