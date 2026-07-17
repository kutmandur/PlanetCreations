// Pures Ranking-Modul für den "Recommended"-Feed der Startseite.
// Bewusst ohne Firebase-Imports — vollständig unit-testbar.
//
// Score-Komponenten (Gewichte per Slider konfigurierbar, siehe DEFAULT_WEIGHTS):
//  - recency:    exponentiell abklingendes Alter (neue Creations)
//  - popularity: log-gedämpfte Likes/Views, normiert übers geladene Set
//  - activity:   akkumulierender Update-Score (siehe decayActivityScore)
//  - affinity:   Tag-Überlappung mit der Interessen-Map des Nutzers
//  - discovery:  deterministischer Tages-Jitter + "Lotterie" für die Long-Tail-Rotation

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

// Slider-Werte sind relative Anteile (0–100); vor dem Scoren auf Summe 1 normiert.
export const DEFAULT_WEIGHTS = {
    recency: 30,
    popularity: 25,
    activity: 15,
    affinity: 20,
    discovery: 10,
};

export const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS);

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

// mulberry32 — deterministischer PRNG, eine Ziehung reicht für den Jitter.
export function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Tagesschlüssel (UTC) — hält den Feed innerhalb eines Tages stabil.
export function getDayKey(nowMs = Date.now()) {
    return new Date(nowMs).toISOString().slice(0, 10);
}

function jitterFor(dayKey, creationId, uid) {
    return mulberry32(hashStringToSeed(`${dayKey}|${creationId}|${uid || 'anon'}`))();
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

// Anzeige-Labels für die Score-Komponenten (Admin-Debug-Badge)
export const POOL_LABELS = {
    recency: 'New',
    popularity: 'Popular',
    activity: 'Active',
    affinity: 'For you',
    discovery: 'Discovery',
    lottery: 'Lottery',
};

export function scoreCreation(creation, ctx) {
    const { now, dayKey, uid, interestMap, maxPop, maxActivity, weights } = ctx;

    const createdMs = toMillis(creation.createdAt) || 0;
    const ageDays = Math.max(0, (now - createdMs) / DAY_MS);
    const recency = Math.pow(2, -ageDays / 7);

    const likes = creation.likes || 0;
    const dislikes = creation.dislikes || 0;
    const views = creation.views || 0;
    const popRaw = Math.log10(1 + Math.max(0, likes - dislikes) + views / 50);
    const popularity = maxPop > 0 ? popRaw / maxPop : 0;

    const decayedAs = decayActivityScore(creation.activityScore, toMillis(creation.activityAt), now);
    const activity = maxActivity > 0 ? Math.log1p(decayedAs) / Math.log1p(maxActivity) : 0;

    const affinity = computeTagAffinity(creation.tags, interestMap);
    const j = jitterFor(dayKey, creation.id, uid);

    const parts = {
        recency: weights.recency * recency,
        popularity: weights.popularity * popularity,
        activity: weights.activity * activity,
        affinity: weights.affinity * affinity,
        discovery: weights.discovery * j,
    };
    // Tägliche "Lotterie": ~3 % des Katalogs bekommen einen kräftigen Boost,
    // jeden Tag eine andere Teilmenge — so tauchen alte Perlen rotierend auf.
    const lottery = j > 0.97;
    let score = parts.recency + parts.popularity + parts.activity + parts.affinity + parts.discovery;
    if (lottery) score += 3 * weights.discovery;
    if (creation.status === 'finished') score += 0.05;

    if (ctx.debug) {
        // "Pool" = dominante Score-Komponente (Lotterie schlägt alles)
        const dominant = Object.entries(parts).sort((a, b) => b[1] - a[1])[0][0];
        return { score, debug: { pool: lottery ? 'lottery' : dominant, score, parts, lottery } };
    }
    return { score };
}

// Rankt ein Array von Creations (Index-Einträge oder volle Docs) absteigend.
// ctx = { now?, dayKey?, uid?, interestMap?, weights? } — weights sind rohe
// Slider-Werte (werden hier normiert).
export function rankCreations(creations, ctx = {}) {
    const now = ctx.now || Date.now();
    const dayKey = ctx.dayKey || getDayKey(now);
    const uid = ctx.uid || null;
    const interestMap = ctx.interestMap || {};
    const weights = normalizeWeights(ctx.weights || DEFAULT_WEIGHTS);

    // Normierungsgrößen übers Kandidaten-Set
    let maxPop = 0;
    let maxActivity = 0;
    for (const c of creations) {
        const popRaw = Math.log10(1 + Math.max(0, (c.likes || 0) - (c.dislikes || 0)) + (c.views || 0) / 50);
        if (popRaw > maxPop) maxPop = popRaw;
        const decayed = decayActivityScore(c.activityScore, toMillis(c.activityAt), now);
        if (decayed > maxActivity) maxActivity = decayed;
    }

    const fullCtx = { now, dayKey, uid, interestMap, maxPop, maxActivity, weights, debug: !!ctx.debug };
    return creations
        .map((c) => ({ c, ...scoreCreation(c, fullCtx) }))
        .sort((a, b) => b.score - a.score
            || (toMillis(b.c.createdAt) || 0) - (toMillis(a.c.createdAt) || 0))
        // Debug (Admin-Badge): Kopie mit __feedDebug, damit die gecachten
        // Index-Objekte nicht mutiert werden
        .map((entry) => (entry.debug ? { ...entry.c, __feedDebug: entry.debug } : entry.c));
}
