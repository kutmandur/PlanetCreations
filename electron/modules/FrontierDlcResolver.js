const PLANET_COASTER_2_DLC_BITS = Object.freeze([
    { bit: 1, name: 'Bonus Ride Collection', steamAppId: 3091180, contentId: 'PDLC_1' },
    { bit: 2, name: 'Vintage Funfair Ride Pack', steamAppId: 3091190, contentId: 'PDLC_2' },
    { bit: 3, name: 'Thrill-Seekers Ride Pack', steamAppId: 3337040, contentId: 'ContentPDLC1', tag: 'Filter_PDLC_ThrillSeekersRidePack' },
    { bit: 4, name: 'Sorcery Pack', steamAppId: 3902620, contentId: 'ContentPDLC2', tag: 'Filter_PDLC_Sorcery' },
    { bit: 5, name: 'Toybox Pack', steamAppId: 4129920, contentId: 'ContentPDLC3', tag: 'Filter_PDLC_Toybox' },
    { bit: 6, name: 'Parades Pack', steamAppId: 4492160, contentId: 'ContentPDLC4', tag: 'Filter_PDLC_ParadesArcades' },
    { bit: 7, name: 'Silver Screen Pack', steamAppId: 4961870, contentId: 'ContentPDLC5' },
]);

// Planet Zoo stores Deluxe as bit 0 and ContentN as bit N. The relationship
// is confirmed by both tDLCNames and nRequiredDLC in real save metadata.
const PLANET_ZOO_DLC_BITS = Object.freeze([
    { bit: 0, name: 'Deluxe Upgrade Pack', steamAppId: 1098120, contentId: 'Deluxe' },
    { bit: 1, name: 'Arctic Pack', steamAppId: 1196770, contentId: 'Content1' },
    { bit: 2, name: 'South America Pack', steamAppId: 1238440, contentId: 'Content2' },
    { bit: 3, name: 'Australia Pack', steamAppId: 1349400, contentId: 'Content3' },
    { bit: 4, name: 'Aquatic Pack', steamAppId: 1471590, contentId: 'Content4' },
    { bit: 5, name: 'Southeast Asia Animal Pack', steamAppId: 1567110, contentId: 'Content5' },
    { bit: 6, name: 'Africa Pack', steamAppId: 1647620, contentId: 'Content6' },
    { bit: 7, name: 'North America Animal Pack', steamAppId: 1747960, contentId: 'Content7' },
    { bit: 8, name: 'Europe Pack', steamAppId: 1726150, contentId: 'Content8' },
    { bit: 9, name: 'Wetlands Animal Pack', steamAppId: 1934140, contentId: 'Content9' },
    { bit: 10, name: 'Conservation Pack', steamAppId: 2013290, contentId: 'Content10' },
    { bit: 11, name: 'Twilight Pack', steamAppId: 2150050, contentId: 'Content11' },
    { bit: 12, name: 'Grasslands Animal Pack', steamAppId: 2199210, contentId: 'Content12' },
    { bit: 13, name: 'Tropical Pack', steamAppId: 2346830, contentId: 'Content13' },
    { bit: 14, name: 'Arid Animal Pack', steamAppId: 2436600, contentId: 'Content14' },
    { bit: 15, name: 'Oceania Pack', steamAppId: 2502240, contentId: 'Content15' },
    { bit: 16, name: 'Eurasia Animal Pack', steamAppId: 2675740, contentId: 'Content16' },
    { bit: 17, name: 'Barnyard Animal Pack', steamAppId: 2837730, contentId: 'Content17' },
    { bit: 18, name: 'Zookeepers Animal Pack', steamAppId: 3146420, contentId: 'Content18' },
    { bit: 19, name: 'Americas Animal Pack', steamAppId: 3473820, contentId: 'Content19' },
    { bit: 20, name: 'Asia Animal Pack', steamAppId: 3586990, contentId: 'Content20' },
]);

const DLC_BITS_BY_GAME = new Map([
    ['planet-coaster-2', PLANET_COASTER_2_DLC_BITS],
    ['planet-zoo', PLANET_ZOO_DLC_BITS],
]);

function fallbackCatalogEntries(gameId) {
    return (DLC_BITS_BY_GAME.get(gameId) || []).map(entry => ({
        ...entry,
        identifiers: [entry.contentId, entry.tag].filter(Boolean),
    }));
}

function normalizeFrontierDlcCatalog(gameId, rawCatalog) {
    const fallbackEntries = fallbackCatalogEntries(gameId);
    const fallbackByName = new Map(fallbackEntries.map(entry => [entry.name, entry]));
    const configuredNames = Array.isArray(rawCatalog?.names) ?
        rawCatalog.names.slice(0, 200) : [];
    const names = [
        ...fallbackEntries.map(entry => entry.name),
        ...configuredNames,
    ];
    const saveMappings = rawCatalog?.saveMappings && typeof rawCatalog.saveMappings === 'object' ?
        rawCatalog.saveMappings : {};
    const entries = [];

    for (const rawName of names) {
        const name = typeof rawName === 'string' ? rawName.trim().slice(0, 150) : '';
        if (!name || entries.some(entry => entry.name === name)) continue;
        const configured = saveMappings[name];
        const fallback = fallbackByName.get(name);
        const bit = Number.isSafeInteger(configured?.bit) && configured.bit >= 0 && configured.bit <= 52 ?
            configured.bit : fallback?.bit;
        const configuredIdentifiers = Array.isArray(configured?.identifiers) ? configured.identifiers
            .filter(value => typeof value === 'string' && value.trim())
            .map(value => value.trim().slice(0, 100))
            .slice(0, 20) : null;
        const identifiers = configuredIdentifiers || fallback?.identifiers || [];
        entries.push({ name, bit: Number.isSafeInteger(bit) ? bit : null, identifiers });
    }

    return {
        gameId,
        version: Number.isSafeInteger(rawCatalog?.catalogVersion) ? rawCatalog.catalogVersion : 2,
        entries: entries.length > 0 ? entries : fallbackEntries,
    };
}

function getCatalog(gameId, catalog) {
    if (!catalog || !Array.isArray(catalog.entries)) {
        return { gameId, version: 2, entries: fallbackCatalogEntries(gameId) };
    }
    const configuredEntries = catalog.entries
        .slice(0, 200)
        .filter(entry => entry && typeof entry.name === 'string')
        .map(entry => ({
            name: entry.name.trim().slice(0, 150),
            bit: Number.isSafeInteger(entry.bit) && entry.bit >= 0 && entry.bit <= 52 ? entry.bit : null,
            identifiers: Array.isArray(entry.identifiers) ? entry.identifiers
                .filter(value => typeof value === 'string' && value.trim())
                .map(value => value.trim().slice(0, 100))
                .slice(0, 20) : [],
        }))
        .filter(entry => entry.name);
    const configuredByName = new Map(configuredEntries.map(entry => [entry.name, entry]));
    const entries = fallbackCatalogEntries(gameId).map(fallback => {
        const configured = configuredByName.get(fallback.name);
        if (!configured) return fallback;
        configuredByName.delete(fallback.name);
        return {
            ...configured,
            bit: configured.bit ?? fallback.bit,
            identifiers: configured.identifiers.length > 0 ?
                configured.identifiers : fallback.identifiers,
        };
    });
    entries.push(...configuredByName.values());
    return {
        gameId,
        version: Number.isSafeInteger(catalog.version) ? catalog.version : 2,
        entries: entries.length > 0 ? entries : fallbackCatalogEntries(gameId),
    };
}

function resolveFrontierDlcRequirements(gameId, rawMask, rawIdentifiers = [], catalogOverride = null) {
    const mask = Number.isSafeInteger(rawMask) && rawMask >= 0 ? rawMask : null;
    const requiredDlcBits = [];
    if (mask !== null) {
        for (let bit = 0; bit <= 52 && 2 ** bit <= mask; bit += 1) {
            if (Math.floor(mask / (2 ** bit)) % 2 === 1) requiredDlcBits.push(bit);
        }
    }
    const identifiers = Array.isArray(rawIdentifiers) ? rawIdentifiers
        .filter(value => typeof value === 'string' && value.trim())
        .map(value => value.trim()) : [];
    const catalog = getCatalog(gameId, catalogOverride);
    const byBit = new Map(catalog.entries
        .filter(entry => entry.bit !== null)
        .map(entry => [entry.bit, entry.name]));
    const byIdentifier = new Map(catalog.entries.flatMap(entry =>
        entry.identifiers.map(identifier => [identifier.toLowerCase(), entry.name])));
    const requiredDlcs = [];
    const addName = name => {
        if (name && !requiredDlcs.includes(name)) requiredDlcs.push(name);
    };
    requiredDlcBits.forEach(bit => addName(byBit.get(bit)));
    identifiers.forEach(identifier => addName(byIdentifier.get(identifier.toLowerCase())));
    return {
        mappingVersion: catalog.version,
        requiredDlcs,
        requiredDlcBits,
        unknownDlcBits: requiredDlcBits.filter(bit => !byBit.has(bit)),
        unknownDlcIdentifiers: identifiers.filter(identifier =>
            !byIdentifier.has(identifier.toLowerCase())),
    };
}

function resolveFrontierDlcMask(gameId, rawMask, catalogOverride = null) {
    return resolveFrontierDlcRequirements(gameId, rawMask, [], catalogOverride);
}

module.exports = {
    PLANET_COASTER_2_DLC_BITS,
    PLANET_ZOO_DLC_BITS,
    normalizeFrontierDlcCatalog,
    resolveFrontierDlcRequirements,
    resolveFrontierDlcMask,
};
