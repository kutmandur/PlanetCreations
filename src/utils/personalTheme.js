export const PERSONAL_THEME_EVENT = 'pc-personal-theme-change';
export const DEFAULT_PERSONAL_THEME = Object.freeze({ version: 1, backgroundUrl: '', portraitBackgroundUrl: '', cardColor: '', accentColor: '', adaptToColorScheme: false });
const CACHE_PREFIX = 'pcPersonalTheme.v1:';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
let activeUid = null;
let activeTheme = { ...DEFAULT_PERSONAL_THEME };

export function normalizeBackgroundUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try {
        const url = new URL(value.trim());
        if (url.origin !== 'https://i.postimg.cc' || url.username || url.password ||
            !/^\/[^/]+\/[^/]+\.(?:png|jpe?g|webp|avif|gif)$/i.test(url.pathname)) return '';
        url.hash = '';
        return url.href;
    } catch { return ''; }
}

export function normalizePersonalTheme(value) {
    const data = value && typeof value === 'object' ? value : {};
    return {
        version: 1,
        backgroundUrl: normalizeBackgroundUrl(data.backgroundUrl),
        portraitBackgroundUrl: normalizeBackgroundUrl(data.portraitBackgroundUrl),
        cardColor: typeof data.cardColor === 'string' && HEX_COLOR.test(data.cardColor) ? data.cardColor.toLowerCase() : '',
        accentColor: typeof data.accentColor === 'string' && HEX_COLOR.test(data.accentColor) ? data.accentColor.toLowerCase() : '',
        adaptToColorScheme: data.adaptToColorScheme === true,
    };
}

export function validatePersonalTheme(value) {
    if (!value || typeof value !== 'object') return 'Invalid theme settings.';
    for (const field of ['backgroundUrl', 'portraitBackgroundUrl']) {
        const url = value[field];
        if (url && (typeof url !== 'string' || (url.trim() && !normalizeBackgroundUrl(url)))) {
            return `${field === 'portraitBackgroundUrl' ? 'Portrait background: ' : ''}Use a Postimages Direct Link (https://i.postimg.cc/…/image.jpg), not an image page or gallery link.`;
        }
    }
    if ([value.cardColor, value.accentColor].some(color => color && (typeof color !== 'string' || !HEX_COLOR.test(color)))) {
        return 'Enter colors as six-digit hex values, for example #2563eb.';
    }
    if (value.adaptToColorScheme !== undefined && typeof value.adaptToColorScheme !== 'boolean') {
        return 'Choose whether colors should adapt to light and dark mode.';
    }
    return '';
}

export function resolvePersonalThemeBackground(value, portrait = false, unavailableUrls = []) {
    const theme = normalizePersonalTheme(value);
    const candidates = portrait ? [theme.portraitBackgroundUrl, theme.backgroundUrl] : [theme.backgroundUrl];
    return candidates.find(url => url && !unavailableUrls.includes(url)) || '';
}

function luminance(hex) {
    const channels = [1, 3, 5].map(offset => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function readableThemeText(background) {
    // Choose the larger WCAG contrast; even mid-tone backgrounds reach 4.5:1.
    return luminance(background) > 0.179 ? '#000000' : '#ffffff';
}

function mixColors(background, foreground, amount) {
    return '#' + [1, 3, 5].map(offset => Math.round(
        parseInt(background.slice(offset, offset + 2), 16) * (1 - amount) +
        parseInt(foreground.slice(offset, offset + 2), 16) * amount
    ).toString(16).padStart(2, '0')).join('');
}

function mixUntil(color, target, accepts) {
    if (accepts(color)) return color;
    let low = 0;
    let high = 1;
    // Find the smallest tint/shade that meets the target, preserving the hue.
    for (let step = 0; step < 16; step++) {
        const middle = (low + high) / 2;
        if (accepts(mixColors(color, target, middle))) high = middle;
        else low = middle;
    }
    return mixColors(color, target, high);
}

export function resolvePersonalThemeColors(value, mode = 'light') {
    const theme = normalizePersonalTheme(value);
    if (!theme.adaptToColorScheme) return theme;
    const dark = mode === 'dark';
    if (theme.cardColor) {
        theme.cardColor = mixUntil(theme.cardColor, dark ? '#000000' : '#ffffff', color => (
            dark ? luminance(color) <= .055 : luminance(color) >= .78
        ));
    }
    if (theme.accentColor) {
        const surfaceLuminance = luminance(theme.cardColor || (dark ? '#1f2937' : '#ffffff'));
        theme.accentColor = mixUntil(theme.accentColor, dark ? '#ffffff' : '#000000', color => {
            const accentLuminance = luminance(color);
            return (Math.max(surfaceLuminance, accentLuminance) + .05) / (Math.min(surfaceLuminance, accentLuminance) + .05) >= 3;
        });
    }
    return theme;
}

export function personalThemeVariables(value, mode = 'light') {
    const theme = resolvePersonalThemeColors(value, mode);
    const variables = {};
    if (theme.cardColor) {
        const foreground = readableThemeText(theme.cardColor);
        const surfaceTint = foreground === '#ffffff' ? '#000000' : '#ffffff';
        variables['--pc-card-bg'] = theme.cardColor;
        variables['--pc-card-fg'] = foreground;
        variables['--pc-card-raised'] = mixColors(theme.cardColor, surfaceTint, 0.07);
        variables['--pc-card-hover'] = mixColors(theme.cardColor, surfaceTint, 0.12);
        variables['--pc-card-border'] = mixColors(theme.cardColor, foreground, 0.3);
    }
    if (theme.accentColor) {
        variables['--pc-card-accent'] = theme.accentColor;
        variables['--pc-card-accent-fg'] = readableThemeText(theme.accentColor);
    }
    return variables;
}

const VARIABLE_NAMES = ['--pc-card-bg', '--pc-card-fg', '--pc-card-raised', '--pc-card-hover', '--pc-card-border', '--pc-card-accent', '--pc-card-accent-fg'];
const cacheKey = uid => CACHE_PREFIX + encodeURIComponent(uid);

export function readCachedPersonalTheme(uid) {
    if (!uid) return { ...DEFAULT_PERSONAL_THEME };
    try { return normalizePersonalTheme(JSON.parse(localStorage.getItem(cacheKey(uid)))); }
    catch { return { ...DEFAULT_PERSONAL_THEME }; }
}

function applyColorVariables(theme) {
    const root = document.documentElement;
    const variables = personalThemeVariables(theme, root.classList.contains('dark') ? 'dark' : 'light');
    VARIABLE_NAMES.forEach(name => {
        if (variables[name]) root.style.setProperty(name, variables[name]);
        else root.style.removeProperty(name);
    });
}

function applyPersonalTheme(theme) {
    activeTheme = normalizePersonalTheme(theme);
    applyColorVariables(activeTheme);
    const root = document.documentElement;
    root.toggleAttribute('data-pc-card-theme', Boolean(activeUid && activeTheme.cardColor));
    root.toggleAttribute('data-pc-accent-theme', Boolean(activeUid && activeTheme.accentColor));
    root.toggleAttribute('data-pc-background-theme', Boolean(activeUid && (activeTheme.backgroundUrl || activeTheme.portraitBackgroundUrl)));
    window.dispatchEvent(new CustomEvent(PERSONAL_THEME_EVENT, { detail: { uid: activeUid, theme: { ...activeTheme } } }));
}

export function getActivePersonalTheme() { return { ...activeTheme }; }
export function getPersonalThemeUser() { return activeUid; }

export function setPersonalThemeUser(uid) {
    activeUid = typeof uid === 'string' && uid ? uid : null;
    applyPersonalTheme(readCachedPersonalTheme(activeUid));
}

// Consume the existing users/{uid} read/snapshot. Never opens another listener.
export function hydratePersonalTheme(uid, value) {
    if (!uid) return;
    const theme = normalizePersonalTheme(value);
    try { localStorage.setItem(cacheKey(uid), JSON.stringify(theme)); } catch { /* session cache still works */ }
    if (uid === activeUid) applyPersonalTheme(theme);
}

export function watchPersonalThemeCache() {
    const onStorage = event => {
        if (activeUid && (event.key === cacheKey(activeUid) || event.key === null)) {
            applyPersonalTheme(readCachedPersonalTheme(activeUid));
        }
    };
    // Theme/OS changes derive colors locally; the saved source colors stay intact.
    const onColorScheme = () => {
        if (activeUid && activeTheme.adaptToColorScheme) applyColorVariables(activeTheme);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pc-theme-change', onColorScheme);
    return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('pc-theme-change', onColorScheme);
    };
}
