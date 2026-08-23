const STORAGE_KEY = 'planetcreations.frontierDlcCatalogs.v1';

function sanitizeCatalog(rawCatalog) {
    if (!rawCatalog || !Array.isArray(rawCatalog.entries)) return null;
    const entries = rawCatalog.entries
        .slice(0, 200)
        .filter(entry => entry && typeof entry.name === 'string')
        .map(entry => ({
            name: entry.name.trim().slice(0, 150),
            bit: Number.isSafeInteger(entry.bit) && entry.bit >= 0 && entry.bit <= 52 ? entry.bit : null,
            identifiers: Array.isArray(entry.identifiers) ? entry.identifiers
                .filter(value => typeof value === 'string' && value.trim())
                .map(value => value.trim().slice(0, 100))
                .slice(0, 20) : [],
        }))
        .filter(entry => entry.name);
    if (entries.length === 0) return null;
    return {
        version: Number.isSafeInteger(rawCatalog.version) ? rawCatalog.version : 1,
        entries,
    };
}

function readCatalogs() {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function cacheFrontierDlcCatalog(gameId, rawCatalog) {
    if (typeof window === 'undefined' || !gameId) return null;
    const catalog = sanitizeCatalog(rawCatalog);
    if (!catalog) return null;
    try {
        const catalogs = readCatalogs();
        catalogs[gameId] = { ...catalog, cachedAt: Date.now() };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(catalogs));
    } catch {
        // Storage can be unavailable in private or hardened browser contexts.
    }
    return catalog;
}

export function getCachedFrontierDlcCatalogs() {
    if (typeof window === 'undefined') return {};
    const catalogs = readCatalogs();
    return Object.fromEntries(Object.entries(catalogs)
        .map(([gameId, catalog]) => [gameId, sanitizeCatalog(catalog)])
        .filter(([, catalog]) => catalog));
}

export { sanitizeCatalog as sanitizeFrontierDlcCatalog };
