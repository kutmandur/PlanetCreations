import {
    DEFAULT_WEIGHTS,
    normalizeWeights,
    decayActivityScore,
    getDayKey,
    computeTagAffinity,
    rankCreations,
    hashStringToSeed,
    mulberry32,
} from './feedRanking';

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
const NOW = new Date('2026-07-17T12:00:00Z').getTime();

const ts = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000) });

const makeCreation = (id, overrides = {}) => ({
    id,
    title: id,
    tags: [],
    likes: 0,
    dislikes: 0,
    views: 0,
    status: 'finished',
    createdAt: ts(NOW - 30 * DAY),
    activityScore: 0,
    activityAt: null,
    ...overrides,
});

describe('normalizeWeights', () => {
    it('normalizes to sum 1', () => {
        const w = normalizeWeights({ recency: 50, popularity: 50, activity: 0, affinity: 0, discovery: 0 });
        expect(w.recency).toBeCloseTo(0.5);
        expect(w.popularity).toBeCloseTo(0.5);
        expect(w.activity).toBe(0);
        const sum = Object.values(w).reduce((s, v) => s + v, 0);
        expect(sum).toBeCloseTo(1);
    });

    it('falls back to defaults for invalid input and zero sums', () => {
        const def = normalizeWeights(DEFAULT_WEIGHTS);
        expect(normalizeWeights(null)).toEqual(def);
        expect(normalizeWeights({ recency: -5 })).toEqual(def);
        const zeros = normalizeWeights({ recency: 0, popularity: 0, activity: 0, affinity: 0, discovery: 0 });
        expect(zeros).toEqual(def);
    });
});

describe('decayActivityScore', () => {
    it('applies -30% per month', () => {
        expect(decayActivityScore(10, NOW - MONTH, NOW)).toBeCloseTo(10 * 0.7 * Math.pow(0.2, MONTH / YEAR), 5);
    });

    it('applies the extra -80% per year on top of monthly decay', () => {
        const oneYear = decayActivityScore(10, NOW - YEAR, NOW);
        expect(oneYear).toBeCloseTo(10 * Math.pow(0.7, YEAR / MONTH) * 0.2, 5);
        expect(oneYear).toBeLessThan(0.05); // praktisch null nach einem Jahr Stille
    });

    it('returns 0 for missing score or timestamp and never goes negative', () => {
        expect(decayActivityScore(0, NOW - MONTH, NOW)).toBe(0);
        expect(decayActivityScore(5, null, NOW)).toBe(0);
        expect(decayActivityScore(5, NOW + DAY, NOW)).toBe(5); // Zukunfts-Timestamp → kein Decay
    });
});

describe('jitter determinism', () => {
    it('same day/id/uid gives identical values, different day differs', () => {
        const a = mulberry32(hashStringToSeed('2026-07-17|abc|u1'))();
        const b = mulberry32(hashStringToSeed('2026-07-17|abc|u1'))();
        const c = mulberry32(hashStringToSeed('2026-07-18|abc|u1'))();
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(1);
    });

    it('getDayKey is stable within a day', () => {
        expect(getDayKey(NOW)).toBe('2026-07-17');
        expect(getDayKey(NOW + 60 * 1000)).toBe('2026-07-17');
    });
});

describe('computeTagAffinity', () => {
    const interestMap = { coaster: 10, wooden: 5, zoo: 2 };

    it('is 0 for empty map or tags', () => {
        expect(computeTagAffinity(['coaster'], {})).toBe(0);
        expect(computeTagAffinity([], interestMap)).toBe(0);
        expect(computeTagAffinity(null, interestMap)).toBe(0);
    });

    it('reaches ~1 when creation matches the top interests, clamped to 1', () => {
        expect(computeTagAffinity(['coaster', 'wooden', 'zoo'], interestMap)).toBe(1);
        expect(computeTagAffinity(['coaster', 'wooden', 'zoo', 'extra'], { ...interestMap, extra: 50 })).toBe(1);
    });

    it('is case-insensitive on creation tags and proportional', () => {
        const partial = computeTagAffinity(['Coaster'], interestMap);
        expect(partial).toBeCloseTo(10 / 17);
    });
});

describe('rankCreations', () => {
    const ctx = { now: NOW, uid: 'u1', weights: DEFAULT_WEIGHTS };

    it('ranks a brand-new creation above an old inactive unpopular one', () => {
        const fresh = makeCreation('fresh', { createdAt: ts(NOW - DAY) });
        const stale = makeCreation('stale', { createdAt: ts(NOW - 2 * YEAR) });
        // Über viele Tage hinweg muss fresh praktisch immer vorne liegen —
        // einzelne Lotterie-Tage ausgenommen, daher mehrere Seeds prüfen.
        let freshWins = 0;
        for (let d = 0; d < 10; d++) {
            const ranked = rankCreations([stale, fresh], { ...ctx, dayKey: `2026-07-${10 + d}` });
            if (ranked[0].id === 'fresh') freshWins++;
        }
        expect(freshWins).toBeGreaterThanOrEqual(8);
    });

    it('popularity lifts an old creation', () => {
        const hit = makeCreation('hit', { createdAt: ts(NOW - YEAR), likes: 500, views: 5000 });
        const dud = makeCreation('dud', { createdAt: ts(NOW - YEAR) });
        const ranked = rankCreations([dud, hit], { ...ctx, dayKey: '2026-07-17' });
        expect(ranked[0].id).toBe('hit');
    });

    it('activity score lifts a maintained creation over an equal unmaintained one', () => {
        const active = makeCreation('active', { activityScore: 20, activityAt: ts(NOW - DAY) });
        const idle = makeCreation('idle');
        const ranked = rankCreations([idle, active], {
            ...ctx,
            dayKey: '2026-07-17',
            weights: { recency: 0, popularity: 0, activity: 100, affinity: 0, discovery: 0 },
        });
        expect(ranked[0].id).toBe('active');
    });

    it('affinity personalizes when an interest map is present', () => {
        const match = makeCreation('match', { tags: ['coaster'] });
        const other = makeCreation('other', { tags: ['zoo'] });
        const ranked = rankCreations([other, match], {
            ...ctx,
            dayKey: '2026-07-17',
            interestMap: { coaster: 10 },
            weights: { recency: 0, popularity: 0, activity: 0, affinity: 100, discovery: 0 },
        });
        expect(ranked[0].id).toBe('match');
    });

    it('handles empty interest map and zero-signal sets without NaN', () => {
        const a = makeCreation('a');
        const b = makeCreation('b');
        const ranked = rankCreations([a, b], { ...ctx, dayKey: '2026-07-17' });
        expect(ranked).toHaveLength(2);
    });

    it('attaches __feedDebug (pool + parts) only in debug mode', () => {
        const hit = makeCreation('hit', { likes: 500 });
        const debugRanked = rankCreations([hit], { ...ctx, dayKey: '2026-07-17', debug: true });
        expect(debugRanked[0].__feedDebug).toBeDefined();
        expect(debugRanked[0].__feedDebug.pool).toBeTruthy();
        expect(Object.keys(debugRanked[0].__feedDebug.parts)).toEqual(
            ['recency', 'popularity', 'activity', 'affinity', 'discovery']);
        const plainRanked = rankCreations([hit], { ...ctx, dayKey: '2026-07-17' });
        expect(plainRanked[0].__feedDebug).toBeUndefined();
    });

    it('is deterministic for the same day and reshuffles on another day', () => {
        const set = Array.from({ length: 20 }, (_, i) =>
            makeCreation(`c${i}`, { createdAt: ts(NOW - (i + 1) * 30 * DAY) }));
        const day1a = rankCreations(set, { ...ctx, dayKey: '2026-07-17' }).map((c) => c.id);
        const day1b = rankCreations(set, { ...ctx, dayKey: '2026-07-17' }).map((c) => c.id);
        const day2 = rankCreations(set, { ...ctx, dayKey: '2026-07-18' }).map((c) => c.id);
        expect(day1a).toEqual(day1b);
        expect(day2).not.toEqual(day1a);
    });
});
