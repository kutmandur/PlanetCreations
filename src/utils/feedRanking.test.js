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
        const w = normalizeWeights({ live: 0, recency: 50, popularity: 50, activity: 0, affinity: 0, discovery: 0 });
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
        const zeros = normalizeWeights({ live: 0, recency: 0, popularity: 0, activity: 0, affinity: 0, discovery: 0 });
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

describe('seed helpers', () => {
    it('hash+PRNG are deterministic per seed string', () => {
        const a = mulberry32(hashStringToSeed('123|abc|u1'))();
        const b = mulberry32(hashStringToSeed('123|abc|u1'))();
        const c = mulberry32(hashStringToSeed('456|abc|u1'))();
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

describe('rankCreations (pool/slot model)', () => {
    const ctx = { now: NOW, uid: 'u1', seed: 42, weights: DEFAULT_WEIGHTS };

    it('puts a brand-new creation first (recency pool), old signalless one later', () => {
        const fresh = makeCreation('fresh', { createdAt: ts(NOW - DAY) });
        const stale = makeCreation('stale', { createdAt: ts(NOW - 2 * YEAR) });
        // recency hat das höchste Default-Gewicht → erster Slot ist ein
        // Recency-Pick; stale liegt unter der Pool-Schwelle und kann nur über
        // Discovery/Rest kommen.
        const ranked = rankCreations([stale, fresh], ctx);
        expect(ranked[0].id).toBe('fresh');
        expect(ranked).toHaveLength(2);
    });

    it('popularity pool lifts an old hit over an old dud', () => {
        const hit = makeCreation('hit', { createdAt: ts(NOW - YEAR), likes: 500, views: 5000 });
        const dud = makeCreation('dud', { createdAt: ts(NOW - YEAR) });
        // Beide zu alt für den Recency-Pool → erster gefüllter Pool ist popularity
        const ranked = rankCreations([dud, hit], ctx);
        expect(ranked[0].id).toBe('hit');
    });

    it('activity pool picks the maintained creation first', () => {
        const active = makeCreation('active', { createdAt: ts(NOW - YEAR), activityScore: 20, activityAt: ts(NOW - DAY) });
        const idle = makeCreation('idle', { createdAt: ts(NOW - YEAR) });
        const ranked = rankCreations([idle, active], {
            ...ctx,
            weights: { live: 0, recency: 0, popularity: 0, activity: 100, affinity: 0, discovery: 0 },
        });
        expect(ranked[0].id).toBe('active');
        expect(ranked).toHaveLength(2); // idle kommt über den Rest-Fallback
    });

    it('affinity pool personalizes when an interest map is present', () => {
        const match = makeCreation('match', { tags: ['coaster'] });
        const other = makeCreation('other', { tags: ['zoo'] });
        const ranked = rankCreations([other, match], {
            ...ctx,
            interestMap: { coaster: 10 },
            weights: { live: 0, recency: 0, popularity: 0, activity: 0, affinity: 100, discovery: 0 },
        });
        expect(ranked[0].id).toBe('match');
    });

    it('honors slider quotas: 50/50 recency+popularity yields half from each pool', () => {
        const recent = Array.from({ length: 10 }, (_, i) =>
            makeCreation(`new${i}`, { createdAt: ts(NOW - (i + 1) * DAY) }));
        const popular = Array.from({ length: 10 }, (_, i) =>
            makeCreation(`hit${i}`, { createdAt: ts(NOW - 2 * YEAR), likes: 100 + i }));
        const ranked = rankCreations([...recent, ...popular], {
            ...ctx,
            debug: true,
            weights: { live: 0, recency: 50, popularity: 50, activity: 0, affinity: 0, discovery: 0 },
        });
        expect(ranked).toHaveLength(20);
        const fromRecency = ranked.filter((c) => c.__feedDebug.pool === 'recency').length;
        const fromPopularity = ranked.filter((c) => c.__feedDebug.pool === 'popularity').length;
        expect(fromRecency).toBe(10);
        expect(fromPopularity).toBe(10);
        // Anteile verteilen sich über die Liste: schon in den ersten 4 beide Pools
        const firstPools = new Set(ranked.slice(0, 4).map((c) => c.__feedDebug.pool));
        expect(firstPools.size).toBe(2);
    });

    it('never emits duplicates even when an entry qualifies for several pools', () => {
        const both = makeCreation('both', { createdAt: ts(NOW - DAY), likes: 999 });
        const others = Array.from({ length: 5 }, (_, i) => makeCreation(`o${i}`));
        const ranked = rankCreations([both, ...others], { ...ctx, debug: true });
        expect(ranked).toHaveLength(6);
        expect(new Set(ranked.map((c) => c.id)).size).toBe(6);
    });

    it('redistributes a dry pool: affinity-only weights with empty interest map still fill the feed', () => {
        const set = Array.from({ length: 8 }, (_, i) =>
            makeCreation(`c${i}`, { createdAt: ts(NOW - (i + 1) * DAY) }));
        const ranked = rankCreations(set, {
            ...ctx,
            interestMap: {},
            weights: { live: 0, recency: 0, popularity: 0, activity: 0, affinity: 100, discovery: 0 },
        });
        expect(ranked).toHaveLength(8); // Rest-Fallback nach createdAt
        expect(ranked[0].id).toBe('c0'); // neueste zuerst
    });

    it('is deterministic per seed and reshuffles with a new seed', () => {
        const set = Array.from({ length: 20 }, (_, i) =>
            makeCreation(`c${i}`, { createdAt: ts(NOW - (i + 1) * DAY) }));
        const a1 = rankCreations(set, { ...ctx, seed: 1 }).map((c) => c.id);
        const a2 = rankCreations(set, { ...ctx, seed: 1 }).map((c) => c.id);
        const b = rankCreations(set, { ...ctx, seed: 2 }).map((c) => c.id);
        expect(a1).toEqual(a2);
        expect(b).not.toEqual(a1);
    });

    it('window draw: recency-only weights pick everything from the recency pool, order varies per seed', () => {
        const set = Array.from({ length: 20 }, (_, i) =>
            makeCreation(`c${i}`, { createdAt: ts(NOW - (i + 1) * DAY) }));
        const weights = { live: 0, recency: 100, popularity: 0, activity: 0, affinity: 0, discovery: 0 };
        const a = rankCreations(set, { ...ctx, seed: 1, weights, debug: true });
        expect(a.every((c) => c.__feedDebug.pool === 'recency')).toBe(true);
        const b = rankCreations(set, { ...ctx, seed: 9, weights });
        expect(b.map((c) => c.id)).not.toEqual(a.map((c) => c.id));
    });

    it('attaches __feedDebug (true origin pool + parts) only in debug mode', () => {
        const hit = makeCreation('hit', { likes: 500 });
        const debugRanked = rankCreations([hit], { ...ctx, debug: true });
        expect(debugRanked[0].__feedDebug).toBeDefined();
        expect(Object.keys(DEFAULT_WEIGHTS)).toContain(debugRanked[0].__feedDebug.pool);
        expect(Object.keys(debugRanked[0].__feedDebug.parts)).toEqual(
            ['live', 'recency', 'popularity', 'activity', 'affinity', 'discovery']);
        const plainRanked = rankCreations([hit], { ...ctx });
        expect(plainRanked[0].__feedDebug).toBeUndefined();
    });

    it('uses active streams as a dedicated, adjustable live pool', () => {
        const weights = { live: 100, recency: 0, popularity: 0, activity: 0, affinity: 0, discovery: 0 };
        const active = { platform: 'twitch', expiresAt: ts(NOW + 60 * 60 * 1000) };
        const expired = { platform: 'twitch', expiresAt: ts(NOW - 1000) };
        const ranked = rankCreations([
            makeCreation('normal'),
            makeCreation('live-a', { liveStream: active }),
            makeCreation('expired', { liveStream: expired }),
            makeCreation('live-b', { liveStream: active }),
        ], { ...ctx, weights, debug: true });
        expect(new Set(ranked.slice(0, 2).map((c) => c.id))).toEqual(new Set(['live-a', 'live-b']));
        expect(ranked.slice(0, 2).every((c) => c.__feedDebug.pool === 'live')).toBe(true);
        expect(ranked.find((c) => c.id === 'expired').__feedDebug.pool).not.toBe('live');
    });

    it('does not boost live creations inside other pools when live is set to zero', () => {
        const weights = { live: 0, recency: 0, popularity: 100, activity: 0, affinity: 0, discovery: 0 };
        const base = [makeCreation('popular', { likes: 100 }), makeCreation('weak', { likes: 1 })];
        const withLive = base.map((c) => c.id === 'weak'
            ? { ...c, liveStream: { platform: 'twitch', expiresAt: ts(NOW + 60 * 60 * 1000) } }
            : c);
        for (let seed = 1; seed <= 5; seed++) {
            expect(rankCreations(withLive, { ...ctx, seed, weights }).map((c) => c.id))
                .toEqual(rankCreations(base, { ...ctx, seed, weights }).map((c) => c.id));
        }
    });

    it('handles empty input and zero-signal sets without errors', () => {
        expect(rankCreations([], ctx)).toEqual([]);
        const a = makeCreation('a');
        const b = makeCreation('b');
        expect(rankCreations([a, b], ctx)).toHaveLength(2);
    });
});
