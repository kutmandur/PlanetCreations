import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_PERSONAL_THEME, getActivePersonalTheme, hydratePersonalTheme, normalizeBackgroundUrl,
    normalizePersonalTheme, personalThemeVariables, readCachedPersonalTheme, setPersonalThemeUser,
    resolvePersonalThemeBackground, resolvePersonalThemeColors, validatePersonalTheme, watchPersonalThemeCache,
} from './personalTheme';
import { applyTheme } from './theme';

beforeEach(() => { document.documentElement.classList.remove('dark'); localStorage.clear(); setPersonalThemeUser(null); });
afterEach(() => { vi.restoreAllMocks(); setPersonalThemeUser(null); document.documentElement.classList.remove('dark'); });

const relativeLuminance = hex => {
    const rgb = hex.match(/[a-f0-9]{2}/gi).map(part => parseInt(part, 16) / 255)
        .map(n => n <= 0.04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => {
    const values = [relativeLuminance(a), relativeLuminance(b)];
    return (Math.max(...values) + .05) / (Math.min(...values) + .05);
};

it('accepts direct Postimages images and normalizes colors', () => {
    expect(normalizeBackgroundUrl(' https://i.postimg.cc/abc/photo.JPG#preview ')).toBe('https://i.postimg.cc/abc/photo.JPG');
    expect(normalizePersonalTheme({ cardColor: '#AB34EF', accentColor: '#012345', extra: 'ignored' })).toEqual({ ...DEFAULT_PERSONAL_THEME, cardColor: '#ab34ef', accentColor: '#012345' });
});
it.each([
    'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://postimg.cc/abc', 'https://postimages.org/gallery/abc',
    'http://i.postimg.cc/abc/photo.jpg', 'https://i.postimg.cc.evil.test/abc/photo.jpg',
    'https://i.postimg.cc@evil.test/abc/photo.jpg', 'https://user@i.postimg.cc/abc/photo.jpg',
    'https://i.postimg.cc:8080/abc/photo.jpg', 'https://i.postimg.cc/abc/photo.svg',
    'https://i.postimg.cc/abc/photo.html', '//i.postimg.cc/abc/photo.jpg', 'x'.repeat(2049),
])('rejects unsafe or non-image links: %s', url => {
    expect(normalizeBackgroundUrl(url)).toBe('');
    expect(validatePersonalTheme({ backgroundUrl: url })).not.toBe('');
    expect(validatePersonalTheme({ portraitBackgroundUrl: url })).toContain('Portrait background:');
});
it('keeps existing themes compatible and selects the portrait image only for portrait windows', () => {
    const backgroundUrl = 'https://i.postimg.cc/abc/landscape.jpg';
    const portraitBackgroundUrl = 'https://i.postimg.cc/abc/portrait.jpg';
    const legacy = normalizePersonalTheme({ version: 1, backgroundUrl });
    expect(legacy.portraitBackgroundUrl).toBe('');
    expect(resolvePersonalThemeBackground(legacy, true)).toBe(backgroundUrl);
    const theme = { backgroundUrl, portraitBackgroundUrl };
    expect(resolvePersonalThemeBackground(theme)).toBe(backgroundUrl);
    expect(resolvePersonalThemeBackground(theme, true)).toBe(portraitBackgroundUrl);
    expect(resolvePersonalThemeBackground(theme, true, [portraitBackgroundUrl])).toBe(backgroundUrl);
    expect(resolvePersonalThemeBackground(theme, true, [portraitBackgroundUrl, backgroundUrl])).toBe('');
    expect(resolvePersonalThemeBackground({ portraitBackgroundUrl }, false)).toBe('');
    expect(resolvePersonalThemeBackground({ portraitBackgroundUrl }, true)).toBe(portraitBackgroundUrl);
});

it('caches portrait-only themes for the signed-in account and clears them at logout', () => {
    const portraitBackgroundUrl = 'https://i.postimg.cc/abc/portrait.webp';
    hydratePersonalTheme('alice', { portraitBackgroundUrl });
    setPersonalThemeUser('alice');
    expect(getActivePersonalTheme().portraitBackgroundUrl).toBe(portraitBackgroundUrl);
    expect(readCachedPersonalTheme('alice').portraitBackgroundUrl).toBe(portraitBackgroundUrl);
    expect(document.documentElement.hasAttribute('data-pc-background-theme')).toBe(true);
    setPersonalThemeUser('bob');
    expect(getActivePersonalTheme().portraitBackgroundUrl).toBe('');
    setPersonalThemeUser(null);
    expect(document.documentElement.hasAttribute('data-pc-background-theme')).toBe(false);
});
it('tolerates malformed remote and cached values without executing CSS', () => {
    const invalid = { backgroundUrl: {}, cardColor: 'red; background:url(https://evil.test)', accentColor: ['#ffffff'] };
    expect(normalizePersonalTheme(invalid)).toEqual(DEFAULT_PERSONAL_THEME);
    expect(validatePersonalTheme(invalid)).not.toBe('');
    expect(validatePersonalTheme(null)).not.toBe('');
    localStorage.setItem('pcPersonalTheme.v1:alice', '{bad json');
    expect(readCachedPersonalTheme('alice')).toEqual(DEFAULT_PERSONAL_THEME);
});

describe('account isolation', () => {
    it('uses the local cache only for the authenticated account and clears styling at sign-out', () => {
        hydratePersonalTheme('alice', { cardColor: '#123456', backgroundUrl: 'https://i.postimg.cc/abc/photo.jpg' });
        expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
        setPersonalThemeUser('alice');
        expect(document.documentElement.style.getPropertyValue('--pc-card-bg')).toBe('#123456');
        setPersonalThemeUser('bob');
        expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
        hydratePersonalTheme('alice', { cardColor: '#abcdef' }); // late network response
        expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
        setPersonalThemeUser('alice');
        expect(getActivePersonalTheme().cardColor).toBe('#abcdef');
        setPersonalThemeUser(null);
        expect(document.documentElement.hasAttribute('data-pc-card-theme')).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--pc-card-bg')).toBe('');
        expect(getActivePersonalTheme().backgroundUrl).toBe('');
    });
    it('syncs same-origin windows without a cloud read or listener', () => {
        setPersonalThemeUser('alice');
        const stop = watchPersonalThemeCache();
        localStorage.setItem('pcPersonalTheme.v1:alice', JSON.stringify({ accentColor: '#aabbcc' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'pcPersonalTheme.v1:bob' }));
        expect(getActivePersonalTheme().accentColor).toBe('');
        window.dispatchEvent(new StorageEvent('storage', { key: 'pcPersonalTheme.v1:alice' }));
        expect(getActivePersonalTheme().accentColor).toBe('#aabbcc');
        stop();
    });
    it('still applies themes when local storage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
        setPersonalThemeUser('alice');
        expect(() => hydratePersonalTheme('alice', { cardColor: '#123456' })).not.toThrow();
        expect(getActivePersonalTheme().cardColor).toBe('#123456');
    });
});

it('keeps text contrast at least 4.5:1 for cards, fields, hover surfaces and accents', () => {
    const luminance = hex => {
        const rgb = hex.match(/[a-f0-9]{2}/gi).map(part => parseInt(part, 16) / 255)
            .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    for (const color of ['#000000', '#ffffff', '#757575', '#777777', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#a78bfa']) {
        const vars = personalThemeVariables({ cardColor: color, accentColor: color });
        for (const surface of ['--pc-card-bg', '--pc-card-raised', '--pc-card-hover', '--pc-card-accent']) {
            const a = luminance(vars[surface]);
            const b = luminance(vars['--pc-card-fg']);
            expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
        }
    }
});

it('keeps legacy/exact colors until adaptation is explicitly enabled', () => {
    const oldTheme = { cardColor: '#123456', accentColor: '#abcdef' };
    expect(normalizePersonalTheme(oldTheme).adaptToColorScheme).toBe(false);
    expect(resolvePersonalThemeColors(oldTheme, 'dark')).toEqual(resolvePersonalThemeColors(oldTheme, 'light'));
    expect(normalizePersonalTheme({ adaptToColorScheme: 'true' }).adaptToColorScheme).toBe(false);
    expect(validatePersonalTheme({ adaptToColorScheme: 'true' })).not.toBe('');
});

it('derives light/dark variants with readable surfaces and distinct accents without mutating source colors', () => {
    const colors = ['#000000', '#ffffff', '#757575', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#123456', '#e3a176'];
    for (const cardColor of colors) for (const accentColor of colors) {
        const source = Object.freeze({ cardColor, accentColor, adaptToColorScheme: true });
        for (const mode of ['light', 'dark']) {
            const vars = personalThemeVariables(source, mode);
            if (mode === 'light') expect(relativeLuminance(vars['--pc-card-bg'])).toBeGreaterThanOrEqual(.78);
            else expect(relativeLuminance(vars['--pc-card-bg'])).toBeLessThanOrEqual(.055);
            for (const surface of ['--pc-card-bg', '--pc-card-raised', '--pc-card-hover']) {
                expect(contrast(vars[surface], vars['--pc-card-fg'])).toBeGreaterThanOrEqual(4.5);
            }
            expect(contrast(vars['--pc-card-accent'], vars['--pc-card-accent-fg'])).toBeGreaterThanOrEqual(4.5);
            expect(contrast(vars['--pc-card-bg'], vars['--pc-card-accent'])).toBeGreaterThanOrEqual(3);
        }
        expect(source).toEqual({ cardColor, accentColor, adaptToColorScheme: true });
    }
});

it('keeps unset colors at their defaults when adaptation is enabled', () => {
    expect(personalThemeVariables({ adaptToColorScheme: true }, 'dark')).toEqual({});
    for (const mode of ['light', 'dark']) {
        const vars = personalThemeVariables({ accentColor: mode === 'dark' ? '#000000' : '#ffffff', adaptToColorScheme: true }, mode);
        expect(vars['--pc-card-bg']).toBeUndefined();
        expect(contrast(vars['--pc-card-accent'], mode === 'dark' ? '#1f2937' : '#ffffff')).toBeGreaterThanOrEqual(3);
    }
});

it('updates applied colors on mode changes without writing or replacing saved originals', () => {
    const original = normalizePersonalTheme({ cardColor: '#123456', accentColor: '#abcdef', adaptToColorScheme: true });
    setPersonalThemeUser('alice');
    hydratePersonalTheme('alice', original);
    const stop = watchPersonalThemeCache();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    try {
        const lightCard = document.documentElement.style.getPropertyValue('--pc-card-bg');
        applyTheme('dark');
        expect(document.documentElement.style.getPropertyValue('--pc-card-bg')).not.toBe(lightCard);
        expect(document.documentElement.style.getPropertyValue('--pc-card-accent')).toBe(resolvePersonalThemeColors(original, 'dark').accentColor);
        expect(getActivePersonalTheme()).toEqual(original);
        expect(readCachedPersonalTheme('alice')).toEqual(original);
        expect(write).not.toHaveBeenCalled();
        applyTheme('light');
        expect(document.documentElement.style.getPropertyValue('--pc-card-bg')).toBe(lightCard);
        hydratePersonalTheme('alice', { ...original, adaptToColorScheme: false });
        expect(document.documentElement.style.getPropertyValue('--pc-card-bg')).toBe(original.cardColor);
        applyTheme('dark');
        expect(document.documentElement.style.getPropertyValue('--pc-card-bg')).toBe(original.cardColor);
        setPersonalThemeUser(null);
        applyTheme('light');
        expect(document.documentElement.style.getPropertyValue('--pc-card-bg')).toBe('');
    } finally { stop(); }
});
