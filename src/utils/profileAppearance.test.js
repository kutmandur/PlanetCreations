import {
    DEFAULT_PROFILE_COLOR,
    getProfileAppearance,
    isValidProfileColor,
    normalizeProfileColor,
} from './profileAppearance';

describe('profile appearance helpers', () => {
    test('accepts six-digit hex colors', () => {
        expect(isValidProfileColor('#12AbEF')).toBe(true);
        expect(normalizeProfileColor('#12AbEF')).toBe('#12AbEF');
    });

    test('falls back to neutral gray for invalid or missing colors', () => {
        expect(isValidProfileColor('#fff')).toBe(false);
        expect(normalizeProfileColor('#fff')).toBe(DEFAULT_PROFILE_COLOR);
        expect(normalizeProfileColor()).toBe(DEFAULT_PROFILE_COLOR);
    });

    test('provides the shared profile color variables', () => {
        expect(getProfileAppearance('#336699')).toMatchObject({
            hex: '#336699',
            style: {
                '--game-color': '#336699',
                '--profile-color': '#336699',
            },
        });
    });
});
