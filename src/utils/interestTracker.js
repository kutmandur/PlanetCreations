import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

// Lokale Interessen-Erfassung für den personalisierten Feed.
//
// Datenschutz-Design (Opt-in!): Personalisierung ist standardmäßig AUS.
// Solange der Nutzer nicht per Popover/Settings zugestimmt hat, sind ALLE
// record*/hydrate/flush-Aufrufe No-ops — es wird nichts erhoben, auch nicht
// lokal. Gespeichert wird ausschließlich die aggregierte Tag-Gewichts-Map
// (keine Rohdaten/Historie): lokal in localStorage, gebündelt mit einem
// einzigen Write nach users/{uid}/meta/interests (owner-only per Rules).

const STORAGE_KEY = 'pcn_interests_v1';
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // Tag-Gewichte: Halbwertszeit 14 Tage
const MIN_WEIGHT = 0.1;   // darunter wird gepruned
const MAX_WEIGHT = 100;   // Kappung pro Tag
const MAX_TAGS = 50;      // meistgewichtete behalten
const FLUSH_MIN_EVENTS = 10;
const FLUSH_MIN_INTERVAL_MS = 10 * 60 * 1000;
const VIEW_TAG_LIMIT = 5;

const EVENT_WEIGHTS = { tagClick: 3, search: 2, view: 1, like: 4 };

function emptyState() {
    return { tags: {}, eventsSinceFlush: 0, lastFlush: 0, hydratedFor: null, enabled: null, dirty: false };
}

function loadState() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyState();
        return { ...emptyState(), ...JSON.parse(raw) };
    } catch (e) {
        return emptyState();
    }
}

function saveState(state) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* Quota/Privacy-Mode — Personalisierung ist verzichtbar */ }
}

function decayedWeight(entry, now) {
    if (!entry || !entry.w) return 0;
    return entry.w * Math.pow(0.5, (now - (entry.t || now)) / HALF_LIFE_MS);
}

// Prunen + Kappen: schwache Tags raus, nur die MAX_TAGS stärksten behalten.
function pruneTags(tags, now) {
    const entries = Object.entries(tags)
        .map(([tag, e]) => [tag, { w: Math.min(MAX_WEIGHT, decayedWeight(e, now)), t: now }])
        .filter(([, e]) => e.w >= MIN_WEIGHT)
        .sort((a, b) => b[1].w - a[1].w)
        .slice(0, MAX_TAGS);
    return Object.fromEntries(entries);
}

// --- Consent -----------------------------------------------------------

export function getPersonalizationConsent() {
    return loadState().enabled; // true | false | null (= nie gefragt)
}

function setLocalConsent(enabled) {
    const state = loadState();
    state.enabled = enabled;
    saveState(state);
}

/**
 * Opt-in/Opt-out setzen: 1 Write (merge) aufs interests-Doc + lokaler Spiegel.
 * Bei Opt-out bleiben vorhandene Daten liegen (Reset ist separat), aber es
 * wird ab sofort nichts mehr erhoben oder genutzt.
 */
export async function setPersonalizationEnabled(uid, enabled) {
    setLocalConsent(enabled);
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'meta', 'interests'),
        { enabled, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * "Feed zurücksetzen": lokale Map löschen + remote-Tags leeren (1 Write).
 * Unabhängig vom Opt-in/Opt-out-Toggle nutzbar.
 */
export async function resetInterests(uid) {
    const state = loadState();
    saveState({ ...emptyState(), enabled: state.enabled, hydratedFor: state.hydratedFor });
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'meta', 'interests'),
        { tags: {}, updatedAt: serverTimestamp() }, { merge: true });
}

// --- Lesen -------------------------------------------------------------

/** Decayed Tag-Gewichte ({ tagLower: weight }); {} wenn nicht opted-in. */
export function getInterestMap() {
    const state = loadState();
    if (state.enabled !== true) return {};
    const now = Date.now();
    const map = {};
    for (const [tag, entry] of Object.entries(state.tags)) {
        const w = decayedWeight(entry, now);
        if (w >= MIN_WEIGHT) map[tag] = w;
    }
    return map;
}

/** Lokal gespiegelte User-Slider-Gewichte (oder null). */
export function getLocalFeedWeights() {
    const state = loadState();
    return state.weights || null;
}

// --- Events ------------------------------------------------------------

function bump(tags, weight) {
    const state = loadState();
    if (state.enabled !== true) return; // Opt-out/nie gefragt → nichts erheben
    const now = Date.now();
    for (const rawTag of tags) {
        const tag = String(rawTag || '').toLowerCase().trim();
        if (!tag) continue;
        const current = decayedWeight(state.tags[tag], now);
        state.tags[tag] = { w: Math.min(MAX_WEIGHT, current + weight), t: now };
    }
    state.tags = pruneTags(state.tags, now);
    state.eventsSinceFlush = (state.eventsSinceFlush || 0) + 1;
    state.dirty = true;
    saveState(state);
}

export function recordTagClick(tag) {
    bump([tag], EVENT_WEIGHTS.tagClick);
}

/** Nur werten, wenn der Suchbegriff exakt ein bekannter Tag ist. */
export function recordSearch(term, knownTags) {
    const normalized = String(term || '').toLowerCase().trim();
    if (!normalized) return;
    const isKnown = (knownTags || []).some((t) => String(t).toLowerCase() === normalized);
    if (isKnown) bump([normalized], EVENT_WEIGHTS.search);
}

export function recordView(tags) {
    if (!tags || tags.length === 0) return;
    bump(tags.slice(0, VIEW_TAG_LIMIT), EVENT_WEIGHTS.view);
}

export function recordVote(tags, voteType) {
    if (voteType !== 'like' || !tags || tags.length === 0) return;
    bump(tags.slice(0, VIEW_TAG_LIMIT), EVENT_WEIGHTS.like);
}

// --- Sync (Firestore) ---------------------------------------------------

/**
 * Einmal pro Session: interests-Doc lesen, Consent + Slider lokal spiegeln
 * und (bei Opt-in) die Tag-Map per max(local, remote) mergen.
 * Rückgabe: { enabled, weights } — enabled === null heißt "nie gefragt"
 * (Aufrufer zeigt das Opt-in-Popover).
 */
export async function hydrateFromRemote(uid) {
    const state = loadState();
    if (!uid) return { enabled: state.enabled, weights: state.weights || null };
    if (state.hydratedFor === uid) return { enabled: state.enabled, weights: state.weights || null };

    const snap = await getDoc(doc(db, 'users', uid, 'meta', 'interests'));
    const data = snap.exists() ? snap.data() : {};
    const enabled = typeof data.enabled === 'boolean' ? data.enabled : null;
    const weights = data.weights || null;

    const next = loadState();
    next.hydratedFor = uid;
    next.enabled = enabled;
    if (weights) next.weights = weights;
    else delete next.weights;
    if (enabled === true && data.tags) {
        const now = Date.now();
        for (const [tag, packed] of Object.entries(data.tags)) {
            const remoteW = Array.isArray(packed) ? packed[0] : 0;
            const remoteT = Array.isArray(packed) ? packed[1] : now;
            const localW = decayedWeight(next.tags[tag], now);
            const remoteDecayed = decayedWeight({ w: remoteW, t: remoteT }, now);
            if (remoteDecayed > localW) next.tags[tag] = { w: remoteDecayed, t: now };
        }
        next.tags = pruneTags(next.tags, now);
    }
    saveState(next);
    return { enabled, weights };
}

/** Gedrosselter Flush: nur bei ≥10 Events UND ≥10 min seit letztem Flush. */
export function maybeFlush(uid) {
    const state = loadState();
    if (state.enabled !== true || !uid || !state.dirty) return;
    if ((state.eventsSinceFlush || 0) < FLUSH_MIN_EVENTS) return;
    if (Date.now() - (state.lastFlush || 0) < FLUSH_MIN_INTERVAL_MS) return;
    flushNow(uid);
}

/** Ein einziger Write der kompakten Tag-Map ({ tag: [gerundetesGewicht, ts] }). */
export function flushNow(uid) {
    const state = loadState();
    if (state.enabled !== true || !uid || !state.dirty) return;
    const now = Date.now();
    const compact = {};
    for (const [tag, entry] of Object.entries(pruneTags(state.tags, now))) {
        compact[tag] = [Math.round(entry.w * 100) / 100, entry.t];
    }
    state.eventsSinceFlush = 0;
    state.lastFlush = now;
    state.dirty = false;
    saveState(state);
    // Fire-and-forget — ein fehlgeschlagener Flush kostet nur Aktualität.
    setDoc(doc(db, 'users', uid, 'meta', 'interests'),
        { tags: compact, enabled: true, updatedAt: serverTimestamp() }, { merge: true })
        .catch((e) => console.warn('Interest flush failed:', e.message));
}

/** Lokale User-Slider spiegeln (Persistenz macht saveFeedWeights per Write). */
export function setLocalFeedWeights(weights) {
    const state = loadState();
    if (weights) state.weights = weights;
    else delete state.weights;
    saveState(state);
}

/**
 * User-Slider speichern (oder mit null aufs globale Default zurücksetzen):
 * lokaler Spiegel + 1 Write (merge). Unabhängig vom Personalisierungs-Opt-in —
 * die Slider steuern nur die Gewichtung, nicht die Datenerhebung.
 */
export async function saveFeedWeights(uid, weights) {
    setLocalFeedWeights(weights);
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'meta', 'interests'),
        { weights: weights || null, updatedAt: serverTimestamp() }, { merge: true });
}

export const __testing = { STORAGE_KEY, loadState, emptyState };
