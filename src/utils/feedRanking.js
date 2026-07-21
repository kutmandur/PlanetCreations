// Pool-/Slot-Ranking für den "Recommended"-Feed der Startseite.
// Bewusst ohne Firebase-Imports — vollständig unit-testbar.
//
// Modell: Je Score-Komponente ein Pool (nach dieser Komponente sortiert);
// die Feed-Slots werden gemäß der normierten Slider-Anteile per
// Largest-Remainder-Verfahren auf die Pools verteilt und seeded-zufällig
// aus den Top-WINDOW des jeweiligen Pools gezogen. So liefern die Slider
// wörtlich, was sie versprechen: 30 % "New" ⇒ ~30 % der Karten sind echte
// Recency-Picks. Trockene Pools geben ihren Anteil an die übrigen ab.

import { isLiveStreamActive } from './liveStream';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

// Seeded-Ziehung aus den besten N verbleibenden Einträgen eines Pools —
// so rotiert auch innerhalb eines Pools pro Würfelung die Auswahl.
const POOL_WINDOW = 20;

// Mindest-Komponenten-Score für Pool-Zugehörigkeit: hält signallose Einträge
// draußen (eine 2 Jahre alte Creation hat recency ≈ 0 und gehört nicht in den
// "New"-Pool, auch wenn der Wert technisch > 0 ist). Discovery ist ausgenommen.
const MIN_POOL_SCORE = 0.01;

// Neuer Seed pro Seitenreload: wird einmal bei Modul-Initialisierung gewürfelt.
// SPA-Navigation behält den Modul-State (Feed bleibt in der Sitzung stabil),
// ein harter Reload/neuer Tab initialisiert neu → Pools werden neu gewürfelt.
const LOAD_SEED = Math.floor(Math.random() * 0xffffffff);

// Slider-Werte sind relative Anteile (0–100); vor der Slot-Vergabe auf Summe 1 normiert.
export const DEFAULT_WEIGHTS = {
    live: 10,
    recency: 25,
    popularity: 25,
    activity: 15,
    affinity: 20,
    discovery: 5,
};

export const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS);

// Anzeige-Labels für die Pools (Admin-Debug-Badge)
export const POOL_LABELS = {
    live: 'Live',
    recency: 'New',
    popularity: 'Popular',
    activity: 'Active',
    affinity: 'For you',
    discovery: 'Discovery',
};

// Slider-Objekt (0–100 je Key) → normierte Gewichte mit Summe 1.
// Fehlende/ungültige Keys fallen auf DEFAULT_WEIGHTS zurück; Summe 0 → Defaults.
export function normalizeWeights(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const vals = {};
    let sum = 0;
    for (const key of WEIGHT_KEYS) {
        const v = Number(src[key]);
        vals[key] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHTS[key];
        sum += vals[key];
    }
    if (sum <= 0) return normalizeWeights(DEFAULT_WEIGHTS);
    const out = {};
    for (const key of WEIGHT_KEYS) out[key] = vals[key] / sum;
    return out;
}

// Activity-Score-Decay: −30 % pro Monat, zusätzlich −80 % pro Jahr seit dem
// letzten Inkrement. Reine Lese-Mathematik — der gespeicherte Rohwert ändert
// sich nur beim nächsten Inkrement (Cloud Function nutzt DIESELBE Formel).
export function decayActivityScore(score, activityAtMs, nowMs) {
    if (!score || score <= 0 || !activityAtMs) return 0;
    const elapsed = Math.max(0, nowMs - activityAtMs);
    const months = elapsed / MONTH_MS;
    const years = elapsed / YEAR_MS;
    return score * Math.pow(0.7, months) * Math.pow(0.2, years);
}

// FNV-1a 32-bit — schneller, stabiler String-Hash als PRNG-Seed.
export function hashStringToSeed(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// mulberry32 — deterministischer PRNG.
export function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Tagesschlüssel (UTC) — nicht mehr Teil des Rankings (Seed ist jetzt pro
// Seitenreload), bleibt aber als Utility exportiert.
export function getDayKey(nowMs = Date.now()) {
    return new Date(nowMs).toISOString().slice(0, 10);
}

// Tag-Affinität: Summe der Interessen-Gewichte über die Tags der Creation,
// normiert auf die Summe der Top-3-Interessen (≈1, wenn die Creation die
// stärksten Interessen des Nutzers trifft), geklemmt auf [0,1].
export function computeTagAffinity(tags, interestMap) {
    if (!interestMap || !tags || tags.length === 0) return 0;
    const weights = Object.values(interestMap);
    if (weights.length === 0) return 0;
    const top3 = weights.sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0);
    if (top3 <= 0) return 0;
    let hit = 0;
    for (const tag of tags) {
        hit += interestMap[String(tag).toLowerCase()] || 0;
    }
    return Math.min(1, hit / top3);
}

const toMillis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null);

/**
 * Rankt ein Array von Creations (Index-Einträge oder volle Docs) per
 * Pool-/Slot-Modell. ctx = { now?, uid?, interestMap?, weights?, seed?, debug? }
 * — weights sind rohe Slider-Werte (werden hier normiert); seed nur für Tests
 * (Default: LOAD_SEED, neu pro Seitenreload).
 */
export function rankCreations(creations, ctx = {}) {
    const now = ctx.now || Date.now();
    const uid = ctx.uid || null;
    const interestMap = ctx.interestMap || {};
    const weights = normalizeWeights(ctx.weights || DEFAULT_WEIGHTS);
    const seed = ctx.seed !== undefined ? ctx.seed : LOAD_SEED;

    // Normierungsgrößen übers Kandidaten-Set
    let maxPop = 0;
    let maxActivity = 0;
    for (const c of creations) {
        const popRaw = Math.log10(1 + Math.max(0, (c.likes || 0) - (c.dislikes || 0)) + (c.views || 0) / 50);
        if (popRaw > maxPop) maxPop = popRaw;
        const decayed = decayActivityScore(c.activityScore, toMillis(c.activityAt), now);
        if (decayed > maxActivity) maxActivity = decayed;
    }

    // Komponenten-Scores (roh, ungewichtet, je 0..1) pro Eintrag
    const scored = creations.map((c) => {
        const ageDays = Math.max(0, (now - (toMillis(c.createdAt) || 0)) / DAY_MS);
        const popRaw = Math.log10(1 + Math.max(0, (c.likes || 0) - (c.dislikes || 0)) + (c.views || 0) / 50);
        const decayedAs = decayActivityScore(c.activityScore, toMillis(c.activityAt), now);
        const parts = {
            live: isLiveStreamActive(c.liveStream, now) ? 1 : 0,
            recency: Math.pow(2, -ageDays / 7),
            popularity: maxPop > 0 ? popRaw / maxPop : 0,
            activity: maxActivity > 0 ? Math.log1p(decayedAs) / Math.log1p(maxActivity) : 0,
            affinity: computeTagAffinity(c.tags, interestMap),
            discovery: mulberry32(hashStringToSeed(`${seed}|${c.id}|${uid || 'anon'}`))(),
        };
        return { c, parts };
    });

    // Pools: absteigend nach Komponenten-Score (+ kleiner "finished"-Nudge),
    // Zugehörigkeit erst ab MIN_POOL_SCORE echtem
    // Signal. Discovery enthält alles — der Fallback-Pool der Long-Tail-Picks.
    const nudge = (s) => (s.c.status === 'finished' ? 0.05 : 0);
    const pools = {};
    for (const key of WEIGHT_KEYS) {
        pools[key] = scored
            .filter((s) => key === 'discovery' || s.parts[key] >= MIN_POOL_SCORE)
            .sort((a, b) => (b.parts[key] + nudge(b)) - (a.parts[key] + nudge(a))
                || (toMillis(b.c.createdAt) || 0) - (toMillis(a.c.createdAt) || 0));
    }

    // Slot-Vergabe: Largest-Remainder über die Slider-Anteile; trockene Pools
    // werden übersprungen (ihr Anteil fließt den übrigen zu). Ziehung jeweils
    // seeded-zufällig aus den Top-POOL_WINDOW verbleibenden des Pools.
    const rng = mulberry32(hashStringToSeed(`${seed}|slots|${uid || 'anon'}`));
    const picked = new Set();
    const result = [];
    const acc = {};
    WEIGHT_KEYS.forEach((key) => { acc[key] = 0; });

    const topRemaining = (pool) => {
        const out = [];
        for (const s of pool) {
            if (picked.has(s.c.id)) continue;
            out.push(s);
            if (out.length >= POOL_WINDOW) break;
        }
        return out;
    };

    const emit = (entry, poolKey) => {
        picked.add(entry.c.id);
        result.push(ctx.debug
            ? { ...entry.c, __feedDebug: { pool: poolKey, score: entry.parts[poolKey], parts: entry.parts } }
            : entry.c);
    };

    while (result.length < scored.length) {
        WEIGHT_KEYS.forEach((key) => { acc[key] += weights[key]; });
        let chosen = null;
        let chosenKey = null;
        const order = WEIGHT_KEYS.slice().sort((a, b) => acc[b] - acc[a]);
        for (const key of order) {
            if (weights[key] <= 0) continue; // Slider auf 0 = "davon nichts"
            const candidates = topRemaining(pools[key]);
            if (candidates.length === 0) continue; // Pool trocken → nächster
            chosenKey = key;
            chosen = candidates[Math.floor(rng() * candidates.length)];
            break;
        }
        if (!chosen) break; // alle gewichteten Pools trocken
        acc[chosenKey] -= 1;
        emit(chosen, chosenKey);
    }

    // Rest (signallose Einträge / alle gewichteten Pools trocken): neueste zuerst,
    // damit der Feed immer vollständig ist.
    if (result.length < scored.length) {
        const rest = scored
            .filter((s) => !picked.has(s.c.id))
            .sort((a, b) => (toMillis(b.c.createdAt) || 0) - (toMillis(a.c.createdAt) || 0));
        for (const s of rest) emit(s, 'discovery');
    }

    return result;
}
