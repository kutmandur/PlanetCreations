import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

// Spiele-Registry: die unterstützten Spiele als Laufzeit-Konfiguration
// (Firestore-Doc meta/games, gepflegt über den Admin-Tab "Games") statt
// hartkodierter Listen. Das Modul hält einen synchronen Snapshot, damit
// Komponenten (Tabs, Farben, Conditionals) ohne await rendern können:
//  1. Modul-Init: localStorage-Spiegel (letzter bekannter Stand) oder Fallback
//  2. App-Boot: loadGamesRegistry() holt das Doc (1 Read) und benachrichtigt
//     Subscriber (useGames-Hook) → UI zieht nach.
// Fehlt das Doc oder ist es kaputt, läuft alles auf FALLBACK_GAMES weiter.

const STORAGE_KEY = 'pcn_games_v1';

// Notnagel = der Stand vor Einführung der Registry (heutige Semantik:
// PC1/PZ mit Console + Mods, PC2 PC-only ohne Mods).
export const FALLBACK_GAMES = [
    { id: 'planet-coaster', name: 'Planet Coaster', shortName: 'PC1', color: '#3B82F6', platforms: ['pc', 'console'], modsSupported: true, fileExtensions: [], enabled: true, order: 0 },
    { id: 'planet-coaster-2', name: 'Planet Coaster 2', shortName: 'PC2', color: '#1E40AF', platforms: ['pc'], modsSupported: false, fileExtensions: ['.park2', '.blpr2', '.prkauto2'], enabled: true, order: 1 },
    { id: 'planet-zoo', name: 'Planet Zoo', shortName: 'PZ', color: '#22C55E', platforms: ['pc', 'console'], modsSupported: true, fileExtensions: ['.zoo', '.pzblueprint', '.zooauto'], enabled: true, order: 2 },
];
export const FALLBACK_DEFAULT_GAME_ID = 'planet-coaster-2';

const isValidGame = (g) => g && typeof g.id === 'string' && g.id.length > 0 && typeof g.name === 'string';

function sanitize(data) {
    const games = Array.isArray(data?.games) ? data.games.filter(isValidGame) : [];
    if (games.length === 0) return null;
    return {
        games: games.map((g, i) => ({
            shortName: '', color: '#6B7280', platforms: ['pc'], modsSupported: false,
            fileExtensions: [], enabled: true, order: i,
            ...g,
        })),
        defaultGameId: typeof data.defaultGameId === 'string' ? data.defaultGameId : FALLBACK_DEFAULT_GAME_ID,
    };
}

let registry = { games: FALLBACK_GAMES, defaultGameId: FALLBACK_DEFAULT_GAME_ID };
let loadedFromRemote = false;
const subscribers = new Set();

// Modul-Init: letzter bekannter Stand aus localStorage (sofortiges Paint)
try {
    const cached = sanitize(JSON.parse(window.localStorage.getItem(STORAGE_KEY)));
    if (cached) registry = cached;
} catch (e) { /* kein/kaputter Cache → Fallback */ }

function notify() {
    subscribers.forEach((fn) => { try { fn(); } catch (e) { /* Subscriber-Fehler isolieren */ } });
}

/** Einmal beim App-Boot: meta/games laden (1 Read), Snapshot + Spiegel aktualisieren. */
export async function loadGamesRegistry() {
    if (loadedFromRemote) return registry;
    try {
        const snap = await getDoc(doc(db, 'meta', 'games'));
        loadedFromRemote = true;
        if (snap.exists()) {
            const next = sanitize(snap.data());
            if (next) {
                registry = next;
                try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) { /* egal */ }
                notify();
            }
        }
    } catch (e) {
        console.warn('Games registry load failed, using fallback:', e.message);
    }
    return registry;
}

/** Re-Render-Anbindung für useGames(); liefert unsubscribe. */
export function subscribeGames(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

/** Spiele sortiert nach order; standardmäßig nur enabled. */
export function getGames({ includeDisabled = false } = {}) {
    return registry.games
        .filter((g) => includeDisabled || g.enabled !== false)
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getGame(id) {
    return registry.games.find((g) => g.id === id) || null;
}

export function getEnabledGameIds() {
    return getGames().map((g) => g.id);
}

/** Konfiguriertes Default-Spiel; fällt auf das erste enabled-Spiel zurück. */
export function getDefaultGameId() {
    const configured = getGame(registry.defaultGameId);
    if (configured && configured.enabled !== false) return configured.id;
    const first = getGames()[0];
    return first ? first.id : FALLBACK_DEFAULT_GAME_ID;
}

/** Anzeigename; für unbekannte ids Slug → Titel ("planet-zoo-2" → "planet zoo 2"). */
export function getGameDisplayName(id) {
    return getGame(id)?.name || String(id || '').replace(/-/g, ' ');
}

/**
 * Registry speichern (Admin-Games-Tab): schreibt meta/games inkl. der flachen
 * gameIds-Liste (nur enabled — wird von den Firestore-Rules für die
 * creation.game-Validierung gelesen) und aktualisiert den lokalen Snapshot
 * sofort, damit die UI ohne Reload nachzieht.
 */
export async function saveGamesRegistry({ games, defaultGameId }) {
    const sanitized = sanitize({ games, defaultGameId });
    if (!sanitized) throw new Error('Games list must contain at least one valid game.');
    const gameIds = sanitized.games.filter((g) => g.enabled !== false).map((g) => g.id);
    await setDoc(doc(db, 'meta', 'games'), {
        games: sanitized.games,
        gameIds,
        defaultGameId: sanitized.defaultGameId,
        updatedAt: serverTimestamp(),
    });
    registry = sanitized;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized)); } catch (e) { /* egal */ }
    notify();
}

export const __testing = {
    reset() {
        registry = { games: FALLBACK_GAMES, defaultGameId: FALLBACK_DEFAULT_GAME_ID };
        loadedFromRemote = false;
        subscribers.clear();
    },
    STORAGE_KEY,
};
