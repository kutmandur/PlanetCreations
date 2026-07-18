jest.mock('firebase/firestore', () => ({
    doc: jest.fn((...args) => ({ __path: args.slice(1).join('/') })),
    getDoc: jest.fn(),
    setDoc: jest.fn(() => Promise.resolve()),
    serverTimestamp: jest.fn(() => 'SERVER_TS'),
}));
jest.mock('../firebase/config', () => ({ db: {} }));

import { getDoc, setDoc } from 'firebase/firestore';
import {
    FALLBACK_GAMES,
    FALLBACK_DEFAULT_GAME_ID,
    loadGamesRegistry,
    subscribeGames,
    getGames,
    getGame,
    getEnabledGameIds,
    getDefaultGameId,
    getGameDisplayName,
    saveGamesRegistry,
    __testing,
} from './gamesRegistry';

const REMOTE = {
    games: [
        { id: 'planet-zoo-2', name: 'Planet Zoo 2', shortName: 'PZ2', color: '#16A34A', platforms: ['pc', 'console'], modsSupported: true, fileExtensions: ['.zoo2'], enabled: true, order: 1 },
        { id: 'planet-coaster', name: 'Planet Coaster', shortName: 'PC1', color: '#3B82F6', platforms: ['pc'], modsSupported: true, fileExtensions: [], enabled: false, order: 0 },
    ],
    gameIds: ['planet-zoo-2'],
    defaultGameId: 'planet-zoo-2',
};

beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    // CRA-Jest nutzt resetMocks:true — Implementierungen pro Test neu setzen
    setDoc.mockImplementation(() => Promise.resolve());
    __testing.reset();
});

describe('fallback behavior', () => {
    it('serves the hardcoded fallback games before/without remote load', () => {
        expect(getGames().map((g) => g.id)).toEqual(FALLBACK_GAMES.map((g) => g.id));
        expect(getDefaultGameId()).toBe(FALLBACK_DEFAULT_GAME_ID);
    });

    it('keeps the fallback when the doc is missing', async () => {
        getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
        await loadGamesRegistry();
        expect(getGames().map((g) => g.id)).toEqual(FALLBACK_GAMES.map((g) => g.id));
    });

    it('keeps the fallback when the doc is corrupt (empty games)', async () => {
        getDoc.mockResolvedValue({ exists: () => true, data: () => ({ games: [] }) });
        await loadGamesRegistry();
        expect(getGames()).toHaveLength(3);
    });

    it('survives a failing read', async () => {
        getDoc.mockRejectedValue(new Error('offline'));
        await loadGamesRegistry();
        expect(getGames()).toHaveLength(3);
    });
});

describe('remote load', () => {
    beforeEach(() => {
        getDoc.mockResolvedValue({ exists: () => true, data: () => REMOTE });
    });

    it('replaces the snapshot, mirrors to localStorage and notifies subscribers', async () => {
        const listener = jest.fn();
        subscribeGames(listener);
        await loadGamesRegistry();
        expect(getGames().map((g) => g.id)).toEqual(['planet-zoo-2']); // disabled PC1 gefiltert
        expect(listener).toHaveBeenCalled();
        const mirrored = JSON.parse(window.localStorage.getItem(__testing.STORAGE_KEY));
        expect(mirrored.games).toHaveLength(2);
    });

    it('only fetches once per session', async () => {
        await loadGamesRegistry();
        await loadGamesRegistry();
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('includeDisabled returns disabled games too, sorted by order', async () => {
        await loadGamesRegistry();
        expect(getGames({ includeDisabled: true }).map((g) => g.id)).toEqual(['planet-coaster', 'planet-zoo-2']);
    });
});

describe('accessors', () => {
    beforeEach(async () => {
        getDoc.mockResolvedValue({ exists: () => true, data: () => REMOTE });
        await loadGamesRegistry();
    });

    it('getGame / getEnabledGameIds', () => {
        expect(getGame('planet-zoo-2').shortName).toBe('PZ2');
        expect(getGame('nope')).toBeNull();
        expect(getEnabledGameIds()).toEqual(['planet-zoo-2']);
    });

    it('getDefaultGameId falls back to the first enabled game when the configured one is disabled', async () => {
        __testing.reset();
        getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...REMOTE, defaultGameId: 'planet-coaster' }), // disabled
        });
        await loadGamesRegistry();
        expect(getDefaultGameId()).toBe('planet-zoo-2');
    });

    it('getGameDisplayName uses the registry name and slug-fallback for unknown ids', () => {
        expect(getGameDisplayName('planet-zoo-2')).toBe('Planet Zoo 2');
        expect(getGameDisplayName('jurassic-world-evolution-3')).toBe('jurassic world evolution 3');
    });
});

describe('saveGamesRegistry', () => {
    it('writes games + enabled-only gameIds and updates the local snapshot', async () => {
        const listener = jest.fn();
        subscribeGames(listener);
        await saveGamesRegistry({ games: REMOTE.games, defaultGameId: 'planet-zoo-2' });
        expect(setDoc).toHaveBeenCalledTimes(1);
        const payload = setDoc.mock.calls[0][1];
        expect(payload.gameIds).toEqual(['planet-zoo-2']); // PC1 disabled → nicht in gameIds
        expect(payload.games).toHaveLength(2);
        expect(getGames().map((g) => g.id)).toEqual(['planet-zoo-2']);
        expect(listener).toHaveBeenCalled();
    });

    it('rejects an empty games list', async () => {
        await expect(saveGamesRegistry({ games: [], defaultGameId: 'x' })).rejects.toThrow();
    });
});
