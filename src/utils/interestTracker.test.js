jest.mock('firebase/firestore', () => ({
    doc: jest.fn((...args) => ({ __path: args.slice(1).join('/') })),
    getDoc: jest.fn(),
    setDoc: jest.fn(() => Promise.resolve()),
    serverTimestamp: jest.fn(() => 'SERVER_TS'),
}));
jest.mock('../firebase/config', () => ({ db: {} }));

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import {
    getInterestMap,
    getPersonalizationConsent,
    setPersonalizationEnabled,
    resetInterests,
    recordTagClick,
    recordSearch,
    recordView,
    recordVote,
    hydrateFromRemote,
    maybeFlush,
    flushNow,
    __testing,
} from './interestTracker';

const DAY = 24 * 60 * 60 * 1000;
let nowMs;

const optIn = () => setPersonalizationEnabled(null, true); // lokal only

beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    // CRA-Jest nutzt resetMocks:true — Implementierungen pro Test neu setzen
    doc.mockImplementation((...args) => ({ __path: args.slice(1).join('/') }));
    setDoc.mockImplementation(() => Promise.resolve());
    serverTimestamp.mockImplementation(() => 'SERVER_TS');
    nowMs = new Date('2026-07-17T12:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
    Date.now.mockRestore();
});

describe('consent gating', () => {
    it('records nothing before opt-in (default off)', () => {
        expect(getPersonalizationConsent()).toBeNull();
        recordTagClick('coaster');
        recordView(['zoo', 'habitat']);
        recordVote(['wooden'], 'like');
        expect(getInterestMap()).toEqual({});
        expect(window.localStorage.getItem(__testing.STORAGE_KEY) || '').not.toContain('coaster');
    });

    it('records nothing after explicit opt-out and flush is a no-op', async () => {
        await setPersonalizationEnabled('u1', false);
        recordTagClick('coaster');
        expect(getInterestMap()).toEqual({});
        setDoc.mockClear();
        flushNow('u1');
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('collects after opt-in', async () => {
        await optIn();
        recordTagClick('Coaster');
        const map = getInterestMap();
        expect(map.coaster).toBeCloseTo(3);
    });
});

describe('event weights and decay', () => {
    beforeEach(() => optIn());

    it('applies per-event weights (click 3, search 2, view 1, like 4)', () => {
        recordTagClick('a');
        recordSearch('b', ['b', 'other']);
        recordView(['c']);
        recordVote(['d'], 'like');
        const map = getInterestMap();
        expect(map.a).toBeCloseTo(3);
        expect(map.b).toBeCloseTo(2);
        expect(map.c).toBeCloseTo(1);
        expect(map.d).toBeCloseTo(4);
    });

    it('ignores searches that are not known tags and dislikes', () => {
        recordSearch('unknown-term', ['coaster']);
        recordVote(['x'], 'dislike');
        expect(getInterestMap()).toEqual({});
    });

    it('view only counts the first 5 tags', () => {
        recordView(['t1', 't2', 't3', 't4', 't5', 't6']);
        const map = getInterestMap();
        expect(map.t5).toBeCloseTo(1);
        expect(map.t6).toBeUndefined();
    });

    it('halves weights after 14 days (lazy decay)', () => {
        recordTagClick('coaster'); // w=3
        nowMs += 14 * DAY;
        expect(getInterestMap().coaster).toBeCloseTo(1.5, 1);
    });

    it('prunes weights below 0.1', () => {
        recordView(['weak']); // w=1
        nowMs += 14 * DAY * 5; // 5 Halbwertszeiten → ~0.03
        expect(getInterestMap().weak).toBeUndefined();
    });
});

describe('flush gating', () => {
    beforeEach(() => optIn());

    it('does not flush below 10 events', () => {
        for (let i = 0; i < 9; i++) recordTagClick(`t${i}`);
        setDoc.mockClear();
        maybeFlush('u1');
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('flushes at 10 events when interval elapsed, then resets counter', () => {
        nowMs += 11 * 60 * 1000; // lastFlush=0, aber Abstand sicherstellen
        for (let i = 0; i < 10; i++) recordTagClick(`t${i}`);
        setDoc.mockClear();
        maybeFlush('u1');
        expect(setDoc).toHaveBeenCalledTimes(1);
        const payload = setDoc.mock.calls[0][1];
        expect(payload.enabled).toBe(true);
        expect(Object.keys(payload.tags).length).toBe(10);
        // direkt danach: Zähler zurückgesetzt → kein zweiter Flush
        setDoc.mockClear();
        maybeFlush('u1');
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('respects the 10-minute minimum interval', () => {
        nowMs += 11 * 60 * 1000;
        for (let i = 0; i < 10; i++) recordTagClick(`t${i}`);
        maybeFlush('u1');
        for (let i = 0; i < 10; i++) recordTagClick(`u${i}`);
        setDoc.mockClear();
        nowMs += 5 * 60 * 1000; // nur 5 min später
        maybeFlush('u1');
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('flushNow is a no-op without uid (anonymous)', () => {
        recordTagClick('a');
        setDoc.mockClear();
        flushNow(null);
        expect(setDoc).not.toHaveBeenCalled();
    });
});

describe('hydrateFromRemote', () => {
    it('reads once per uid and merges remote tags via max()', async () => {
        await optIn();
        recordTagClick('coaster'); // lokal 3
        getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ enabled: true, tags: { coaster: [10, nowMs], zoo: [2, nowMs] } }),
        });
        const res = await hydrateFromRemote('u1');
        expect(res.enabled).toBe(true);
        const map = getInterestMap();
        expect(map.coaster).toBeCloseTo(10); // remote gewinnt
        expect(map.zoo).toBeCloseTo(2);
        getDoc.mockClear();
        await hydrateFromRemote('u1'); // zweiter Aufruf gleiche Session
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('reports enabled=null when never asked (popover trigger)', async () => {
        getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
        const res = await hydrateFromRemote('u2');
        expect(res.enabled).toBeNull();
    });
});

describe('resetInterests', () => {
    it('clears local map and writes empty tags, keeping consent', async () => {
        await optIn();
        recordTagClick('coaster');
        setDoc.mockClear();
        await resetInterests('u1');
        expect(getInterestMap()).toEqual({});
        expect(getPersonalizationConsent()).toBe(true);
        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(setDoc.mock.calls[0][1].tags).toEqual({});
    });
});
