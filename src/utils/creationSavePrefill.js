import { isParkCreationCategory } from './parkRidePresentation';

const GAME_BY_EXTENSION = new Map([
    ['.park2', 'planet-coaster-2'],
    ['.blpr2', 'planet-coaster-2'],
    ['.prkauto2', 'planet-coaster-2'],
    ['.zoo', 'planet-zoo'],
    ['.pzblueprint', 'planet-zoo'],
    ['.zooauto', 'planet-zoo'],
]);

function normalized(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
}

function fileExtension(fileName) {
    const match = String(fileName || '').toLowerCase().match(/(\.[^.\\/]+)$/);
    return match?.[1] || '';
}

export function getSavegameGameId(file, fallbackGameId = null) {
    if (typeof file?.gameId === 'string' && file.gameId) return file.gameId;
    return GAME_BY_EXTENSION.get(fileExtension(file?.name || file?.path)) || fallbackGameId;
}

function findCategory(categories, candidates) {
    const entries = (categories || []).map(category => ({
        category,
        normalized: normalized(category),
    }));
    for (const candidate of candidates.map(normalized).filter(Boolean)) {
        const exact = entries.find(entry => entry.normalized === candidate);
        if (exact) return exact.category;
        const close = entries.find(entry => entry.normalized.includes(candidate) || candidate.includes(entry.normalized));
        if (close) return close.category;
    }
    return null;
}

export function inferCreationCategory(metadata, categories = []) {
    if (!metadata || categories.length === 0) return null;
    if (metadata.kind === 'park' || metadata.kind === 'autosave') {
        return findCategory(categories, ['park', 'parks', 'zoo']);
    }

    const blueprint = metadata.blueprint;
    const rides = blueprint?.rides || [];
    const rideCategoryKeys = new Set(rides.map(ride => ride?.rideCategoryKey).filter(Boolean));
    if (rideCategoryKeys.has('coaster')) {
        return findCategory(categories, ['coaster', 'roller coaster']);
    }
    if ((blueprint?.flatRideCount || 0) > 0 || rides.some(ride => ride?.kind === 'flat')) {
        return findCategory(categories, ['flatride', 'flat ride', 'ride']);
    }
    if ((blueprint?.trackedRideCount || 0) > 0 || rides.some(ride => ride?.kind === 'tracked')) {
        const trackedCategory = findCategory(categories, ['tracked ride', 'ride']);
        if (trackedCategory) return trackedCategory;
    }

    const metadataTags = (metadata.tags || []).map(normalized).filter(Boolean);
    const tagMatch = categories.find(category => {
        const categoryValue = normalized(category);
        return categoryValue.length > 2 && metadataTags.some(tag =>
            tag === categoryValue || tag.includes(categoryValue) || categoryValue.includes(tag));
    });
    if (tagMatch) return tagMatch;

    if ((blueprint?.buildingCount || 0) > 0 || (blueprint?.sceneryCount || 0) > 0 ||
        (blueprint?.placedPartCount || 0) > 0) {
        return findCategory(categories, ['scenery', 'building', 'blueprint']);
    }
    return null;
}

export function cleanSavegameTags(metadata, maximum = 200) {
    const ignored = new Set(['blueprint', 'park', 'savegame', 'autosave']);
    const unique = new Map();
    for (const value of metadata?.tags || []) {
        const cleaned = String(value || '')
            .replace(/^(?:Filter_|Menu_)/i, '')
            .replaceAll('_', ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const key = normalized(cleaned);
        if (!key || ignored.has(key) || unique.has(key)) continue;
        unique.set(key, cleaned.slice(0, 100));
        if (unique.size >= maximum) break;
    }
    return [...unique.values()];
}

export function buildSavegamePrefill(file, categories = [], fallbackGameId = null) {
    const metadata = file?.frontierMetadata || null;
    const gameId = getSavegameGameId(file, fallbackGameId);
    return {
        gameId,
        title: metadata?.name || metadata?.park?.parkName || '',
        description: metadata?.description || '',
        category: inferCreationCategory(metadata, categories),
        requiredDlcs: Array.isArray(metadata?.requiredDlcs) ? metadata.requiredDlcs : null,
        usesMods: typeof metadata?.isModded === 'boolean' ? metadata.isModded : null,
        // These stay separate from the ten editable user tags. The uploaded
        // file is parsed again on the server and its verified copy is stored
        // below verifiedGameMetadata rather than in the user-owned tags field.
        gameTags: cleanSavegameTags(metadata),
        metadata,
    };
}

export function getVerifiedGameTags(creation, maximum = 200) {
    return cleanSavegameTags(creation?.verifiedGameMetadata?.metadata, maximum);
}

export function getCreationWizardSteps({ isDesktopClient, isEdit, category }) {
    return [
        ...((isDesktopClient && !isEdit) ? [{ id: 'source', label: 'Savegame' }] : []),
        { id: 'details', label: 'Details' },
        ...(isParkCreationCategory(category) ? [{ id: 'rides-areas', label: 'Attractions & Areas' }] : []),
        { id: 'savegame', label: 'Sharing' },
        { id: 'media', label: 'Gallery' },
        { id: 'sharing', label: 'Communitys' },
    ];
}
