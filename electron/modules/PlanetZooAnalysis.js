const fs = require('node:fs');
const { decodeLayout, readZooPayload } = require('./PlanetZooReader');
const records = require('./PlanetZooRecords');
const catalog = require('./planetZooCatalog.json');

function displayName(a) {
    const custom = a.nameRecord?.parts?.[0];
    if (custom) return { name: custom, nameSource: 'custom' };
    const literal = a.cachedName || a.nameRecord?.parts?.[1];
    if (literal && !/^(AnimalNames_|\$|LOC_|[A-Za-z]+Names_)/.test(literal)) return { name: literal, nameSource: 'saved' };
    const species = (a.species || 'Unknown species').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
    return { name: `${species} ${a.id.startsWith('exhibit:') ? a.id.slice(8) : a.id}`, nameSource: 'fallback' };
}
function analysePlanetZoo(filePath) {
    const before = fs.statSync(filePath), layout = decodeLayout(readZooPayload(filePath));
    const warnings = [];
    const decode = (name, method, fallback) => {
        if (!layout.blocks[name]) { warnings.push(`${name}: Data block is missing.`); return fallback; }
        try { return records[method](layout.blocks[name], layout.strings); }
        catch (error) { warnings.push(`${name}: ${error.message}`); return fallback; }
    };
    const stored = decode('LocalAnimalDatastore', 'datastore', []);
    const current = decode('AnimalSerialisation', 'currentAnimals', []);
    const habitats = decode('HabitatSerialisation', 'habitats', []);
    const exhibits = decode('ExhibitAnimalCoreDataStore', 'exhibitCore', []);
    const liveExhibits = decode('ExhibitAnimalSerialisation', 'currentExhibits', []);
    const scenario = decode('ScenarioManager', 'scenario', {});
    const collected = decode('ResearchManager', 'research', null);
    if (!current.length && !liveExhibits.length && warnings.length) throw Error(warnings.join('\n'));
    const byStored = new Map(stored.map(a => [a.id, a]));
    const byCore = new Map(exhibits.map(a => [a.id, a]));
    const byEntity = new Map(current.map(a => [a.entity, a]));
    const ref = (namespace, value) => { if (!Number.isInteger(value) || value < 0 || value > (layout.references[namespace] || 0)) throw Error(`Unresolved ${namespace} reference.`); };
    for (const habitat of habitats) {
        ref('Game::Habitat::HabitatID', habitat.id);
        ref('Game::PlacementLib::PlacementPartID', habitat.placement);
        ref('Casino::EntityID', habitat.entity);
        for (const id of habitat.members) { const a = byEntity.get(id); if (!a) { warnings.push(`Habitat ${habitat.id}: animal reference ${id} is missing.`); continue; } a.habitats.push(`habitat:${habitat.id}`); }
        for (const alpha of habitat.alphas) for (const id of habitat.members) { const a = byEntity.get(id); if (a?.species === alpha.species && a.sex === alpha.sex) a.isAlpha = a.entity === alpha.entity; }
    }
    const bonuses = Object.fromEntries(Object.keys(catalog.species).map(s => [s, collected === null ? null : 0]));
    for (const id of collected || []) for (const [species, bonus] of catalog.researchEffects[id] || []) bonuses[species] = Math.max(bonuses[species] || 0, bonus);
    const usedSpecies = new Set();
    const animals = current.map(state => {
        ref('Casino::EntityID', state.entity); ref('Casino::EntityID', state.boundMateEntity); ref('Game::PlacementLib::PlacementPartID', state.placement);
        const saved = byStored.get(state.id);
        if (saved && (saved.species !== state.species || JSON.stringify(saved.genes) !== JSON.stringify(state.genes) || saved.sex !== state.sex)) throw Error('Animal data is inconsistent across save blocks.');
        const a = { ...(saved || {}), ...state, current: true, kind: 'habitat', boundMate: byEntity.get(state.boundMateEntity)?.id || null };
        if (!saved) { a.missingStoredRecord = true; warnings.push(`Animal ${a.id}: Historical record is missing.`); }
        a.blockers = Object.entries({ pregnant: a.pregnant, infertile: a.infertile, contraception: a.contraception, failedConception: a.failedConception, interbirth: a.interbirth > 0, lowWelfare: a.welfare < Math.fround(0.66) && a.location !== 5, infection: a.infection, injury: a.injuryWarning }).filter(([, active]) => active).map(([key]) => key);
        usedSpecies.add(a.species); return { ...a, ...displayName(a) };
    });
    for (const state of liveExhibits) {
        ref('Game::PlacementLib::PlacementPartID', state.placement); ref('Casino::EntityID', state.entity);
        const saved = byCore.get(state.id); if (!saved) { warnings.push(`Exhibit animal ${state.id}: core record is missing.`); continue; }
        const a = { ...saved, ...state, current: true, habitats: [`exhibit:${state.placement}`], blockers: [saved.contraception && 'contraception', state.pregnant && 'pregnant'].filter(Boolean) };
        usedSpecies.add(a.species); animals.push({ ...a, ...displayName(a) });
    }
    // Only ancestry reachable from current animals is sent across IPC. Keep every
    // reachable known record, including historical-only parents; never join zoos.
    const all = new Map([...stored, ...exhibits, ...animals].map(a => [a.id, a]));
    const partialParents = new Map();
    for (const a of exhibits) for (const [p, m, f] of [[0, 2, 3], [1, 4, 5]]) {
        const id = a.ancestry[p];
        if (!id || all.has(id) || !(a.ancestry[m] || a.ancestry[f])) continue;
        const previous = partialParents.get(id);
        if (previous && (previous.mother !== a.ancestry[m] || previous.father !== a.ancestry[f])) {
            previous.conflicting = true;
        } else if (!previous) partialParents.set(id, { id, mother: a.ancestry[m], father: a.ancestry[f], species: a.species, sex: p === 0 ? 1 : 0, missingRecord: true });
    }
    for (const [id, a] of partialParents) if (!a.conflicting) all.set(id, a);
    const ancestors = Object.create(null), queue = animals.map(a => a.id); const visited = new Set();
    for (let index = 0; index < queue.length; index++) {
        const id = queue[index]; if (!id || visited.has(id)) continue; visited.add(id);
        const a = all.get(id); if (!a) { ancestors[id] = { id, missing: true }; continue; }
        ancestors[id] = { id: a.id, mother: a.mother || null, father: a.father || null, species: a.species, sex: a.sex, current: a.current === true, missingRecord: a.missingRecord === true, ...displayName(a) };
        queue.push(a.mother, a.father);
    }
    const species = Object.fromEntries([...usedSpecies].map(s => [s, { ...catalog.species[s], researchBonus: bonuses[s] ?? null, catalogKnown: Boolean(catalog.species[s]) }]));
    const after = fs.statSync(filePath); if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw Error('The save changed during analysis. Please reload.');
    // Discard internal/raw containers to keep the UI payload compact.
    for (const a of animals) { delete a.nameRecord; delete a.family; delete a.cachedName; delete a.cachedMates; delete a.unknownGenes; }
    return { schemaVersion: 1, source: { fileName: require('node:path').basename(filePath), modifiedAt: after.mtimeMs, size: after.size, gameBuild: layout.game }, animals, ancestors, habitats: habitats.map(h => ({ ...h, id: `habitat:${h.id}`, name: `Habitat ${h.id}` })), species, scenario, warnings, coverage: { storedHabitatAnimals: stored.length, storedExhibitAnimals: exhibits.length, currentHabitatAnimals: current.length, currentExhibitAnimals: liveExhibits.length, missingAncestors: Object.values(ancestors).filter(a => a.missing || a.missingRecord).length } };
}
module.exports = { analysePlanetZoo, displayName };
