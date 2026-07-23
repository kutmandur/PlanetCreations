import {
  cleanCommunitySocialLinks,
  getCommunityWizardStepError,
  slugifyCommunityName,
} from './communityWizard';

const validState = {
  name: 'Coaster Builders',
  description: 'A community for builders.',
  bannerImageUrl: '',
  profileImageUrl: '',
  allowedGames: ['planet-coaster-2'],
  mainGame: 'planet-coaster-2',
  joinMode: 'open',
  joinPassword: '',
  discordServerId: '',
  socialLinks: {},
  ranks: [{ name: 'Member' }],
  defaultRankIndex: 0,
};

test('creates a stable community slug', () => {
  expect(slugifyCommunityName('  Coaster Builders!  '))
    .toBe('coaster-builders');
});

test('requires a secure password only for password joining', () => {
  expect(getCommunityWizardStepError('membership', {
    ...validState,
    joinMode: 'password',
    joinPassword: 'short',
  })).toMatch(/between 6 and 128/);
  expect(getCommunityWizardStepError('membership', {
    ...validState,
    joinMode: 'invite',
    joinPassword: '',
  })).toBeNull();
});

test('rejects duplicate and protected custom rank names', () => {
  expect(getCommunityWizardStepError('ranks', {
    ...validState,
    ranks: [{ name: 'Builder' }, { name: 'builder' }],
  })).toMatch(/unique/);
  expect(getCommunityWizardStepError('ranks', {
    ...validState,
    ranks: [{ name: 'Moderator' }],
  })).toMatch(/cannot be named/);
});

test('validates rank image links even when the ranks step is not visible', () => {
  expect(getCommunityWizardStepError('ranks', {
    ...validState,
    moderatorRankData: { imageUrl: 'not a URL' },
  })).toMatch(/rank image/);
});

test('requires secure social links and cleans empty entries', () => {
  expect(getCommunityWizardStepError('connections', {
    ...validState,
    socialLinks: { youtube: 'http://youtube.com/example' },
  })).toMatch(/https/);
  expect(cleanCommunitySocialLinks({
    youtube: ' https://youtube.com/example ',
    twitch: '',
  })).toEqual({ youtube: 'https://youtube.com/example' });
});
