import { buildCreationShareUrl } from './overlayQr';

export const OVERLAY_SHOWCASE_KIND = 'community-showcase';
export const OVERLAY_SHOWCASE_CREATION_LIMIT = 100;
export const OVERLAY_SHOWCASE_CHECKLIST_KEY = 'pc.overlayShowcaseChecklist';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const cleanText = (value, maximum = 200) =>
    typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const cleanId = (value) =>
    typeof value === 'string' && SAFE_ID.test(value.trim()) ? value.trim() : '';

export function isOverlayShowcaseEntry(entry) {
    return entry?.kind === OVERLAY_SHOWCASE_KIND &&
        Array.isArray(entry.creationIds) && entry.creationIds.length > 0;
}

export function buildOverlayShowcaseEntry({
    communityId,
    showcaseId = '',
    showcaseTitle = '',
    creations,
    activeCreationId = '',
    source = 'showcase',
    enabledAt = Date.now(),
}) {
    const normalizedCreations = [];
    const seenIds = new Set();
    for (const creation of Array.isArray(creations) ? creations : []) {
        if (normalizedCreations.length >= OVERLAY_SHOWCASE_CREATION_LIMIT) break;
        const id = cleanId(creation?.id || creation?.creationId);
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        normalizedCreations.push({ id, title: cleanText(creation?.title) });
    }
    if (normalizedCreations.length === 0) return null;

    const requestedActiveId = cleanId(activeCreationId);
    const active = normalizedCreations.find(({ id }) => id === requestedActiveId) || normalizedCreations[0];
    return {
        kind: OVERLAY_SHOWCASE_KIND,
        communityId: cleanId(communityId),
        showcaseId: cleanId(showcaseId),
        showcaseTitle: cleanText(showcaseTitle, 100),
        creationIds: normalizedCreations.map(({ id }) => id),
        activeCreationId: active.id,
        creationId: active.id,
        title: active.title,
        url: buildCreationShareUrl(active.id),
        source,
        enabledAt,
    };
}

export function selectOverlayShowcaseCreation(entry, creation) {
    if (!isOverlayShowcaseEntry(entry)) return entry;
    const creationId = cleanId(creation?.id || creation?.creationId);
    if (!creationId || !entry.creationIds.includes(creationId)) return entry;
    return {
        ...entry,
        activeCreationId: creationId,
        creationId,
        title: cleanText(creation?.title),
        url: buildCreationShareUrl(creationId),
    };
}

export function overlayShowcasePayload(entry) {
    if (!isOverlayShowcaseEntry(entry)) return null;
    return {
        kind: OVERLAY_SHOWCASE_KIND,
        communityId: entry.communityId,
        showcaseId: entry.showcaseId || '',
        showcaseTitle: entry.showcaseTitle || '',
        creationIds: entry.creationIds,
        activeCreationId: entry.activeCreationId || entry.creationId,
    };
}

function showcaseChecklistSignature(entry) {
    if (!isOverlayShowcaseEntry(entry)) return '';
    return [entry.communityId || '', entry.showcaseId || '', ...entry.creationIds].join('\u001f');
}

export function readOverlayShowcaseChecklist(entry) {
    try {
        const raw = localStorage.getItem(OVERLAY_SHOWCASE_CHECKLIST_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed?.signature !== showcaseChecklistSignature(entry) ||
            !parsed.checkedByCreation || typeof parsed.checkedByCreation !== 'object') return {};
        const allowedCreationIds = new Set(entry.creationIds);
        return Object.fromEntries(Object.entries(parsed.checkedByCreation)
            .filter(([creationId, rideKeys]) => allowedCreationIds.has(creationId) && Array.isArray(rideKeys))
            .map(([creationId, rideKeys]) => [creationId, [...new Set(rideKeys
                .filter(key => typeof key === 'string' && key.length <= 200))].slice(0, 500)]));
    } catch (error) {
        return {};
    }
}

export function writeOverlayShowcaseChecklist(entry, checkedByCreation) {
    try {
        localStorage.setItem(OVERLAY_SHOWCASE_CHECKLIST_KEY, JSON.stringify({
            signature: showcaseChecklistSignature(entry),
            checkedByCreation,
        }));
    } catch (error) { /* local orientation aid degrades silently */ }
}

export function clearOverlayShowcaseChecklist() {
    try {
        localStorage.removeItem(OVERLAY_SHOWCASE_CHECKLIST_KEY);
    } catch (error) { /* noop */ }
}
