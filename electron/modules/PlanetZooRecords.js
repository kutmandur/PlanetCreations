const { ZooReader } = require('./PlanetZooReader');
const version = (r, allowed) => { const v = r.u(); if (!allowed.includes(v)) throw Error(`Zoo block version ${v} is not supported yet.`); return v; };
const unique = (records, key = 'id') => { if (new Set(records.map(a => a[key])).size !== records.length) throw Error(`Duplicate zoo identifier: ${key}.`); return records; };
const nameRecord = r => ({ parts: r.repeat(3, () => r.s()), number: r.wide().toString() });
const validGenes = genes => genes.every(g => Number.isInteger(g) && g >= 0 && g <= 3);
function grades(genes) {
    if (genes.length !== 60 || !validGenes(genes)) return null;
    return Array.from({ length: 5 }, (_, g) => {
        const a = genes.slice(g * 12, g * 12 + 12);
        return g < 3 ? a.filter(v => v < 2).length : a.slice(0, 6).filter((v, i) => v !== a[i + 6]).length;
    });
}
function datastore(data, strings) {
    const r = new ZooReader(data, strings), v = version(r, [28, 31, 32, 38]);
    r.wide(); r.s(); const count = Number(r.wide());
    if (count < 0 || count > 100000) throw Error('Too many animal records.');
    const relation = () => ({ id: r.s() || null, name: r.s(), sex: Number(r.b()), morph: v >= 38 ? r.u() : r.b() ? 0 : 99, species: r.s() });
    const records = r.repeat(count, () => {
        const a = { id: r.s(), mother: r.s() || null, father: r.s() || null, origin: r.s() || null, species: r.s(), kind: 'habitat' };
        r.floats(2); a.genes = r.uints(60); a.colourGenes = r.uints(12); a.sex = Number(r.b());
        r.s(); r.s(); a.ageYears = r.f() / 1080; a.lifespanYears = r.f() / 1080; a.size = r.f(); a.pregnant = r.f() > 0;
        r.b(); a.causeOfDeath = r.s(); r.u(); r.s();
        if (v >= 35) { r.f(); r.uints(2); } if (v >= 36) r.f(); r.wide();
        if (v >= 33) { r.uints(2); r.b(); } if (v >= 34) { r.b(); r.u(); }
        a.nameRecord = nameRecord(r); a.released = r.b(); a.rehomed = r.b(); a.traded = r.b();
        a.pregnancies = r.u(); a.offspring = r.u(); r.f(); a.diseaseId = r.u(); a.diseaseStage = r.s();
        a.injuries = r.repeat(3, () => ({ type: r.s(), value: r.f() })); a.stars = r.f();
        [a.infections, a.injuryCount, a.fights, a.escapes] = r.uints(4);
        if (v >= 29) {
            r.s(); a.cachedName = r.s(); r.b(); v >= 38 ? r.u() : r.b(); r.s(); if (v >= 31) r.uints(60);
            a.family = { mother: relation(), father: relation(), siblings: r.list(relation, false, 5), partners: r.list(() => ({ partner: relation(), children: r.list(relation, false, 5) }), false, 6) };
        }
        if (v >= 32) a.personality = r.s(); r.list(() => { r.u(); r.f(); }, false, 2); if (v >= 37) r.b();
        a.grades = grades(a.genes); return a;
    });
    r.finish(); return unique(records);
}
function currentAnimals(data, strings) {
    const r = new ZooReader(data, strings), v = version(r, [67, 69, 73, 75, 84]);
    const records = r.list(() => {
        const a = { id: r.s(), species: r.s() }; r.floats(7); const refs = r.uints(3); a.placement = refs[1]; a.boundMateEntity = refs[2]; a.mourningSeconds = r.f();
        const f = r.fields([['u', '2d0 2d8 2e0 2e8'], ['b', '3c1'], ['u', '39c 39d 39e'], ['f', '31c 344 318 314'], ['b', '3c0'], ['f', '30c 310'], ['u', '3a1 3a6 3a2']]);
        if (r.f() !== f['310']) throw Error('Inconsistent repeated state value.');
        Object.assign(f, r.fields([['b', '3bd 3bc'], ['f', '300 304']]));
        a.genes = r.uints(60); a.grades = r.uints(5);
        if (JSON.stringify(a.grades) !== JSON.stringify(grades(a.genes))) throw Error('Genome and genetic scores are inconsistent.');
        r.floats(2); if (r.u() !== 4) throw Error('Unknown animal statistics.');
        const stats = r.list(() => r.f()); const welfareVersion = r.u(); const wb = r.list(() => r.u()), wf = r.list(() => r.b());
        if (stats.length !== 15 || welfareVersion < 1 || welfareVersion > 23 || wb.length !== wf.length || wb.length < 1 || wb.length > 32) throw Error('Unknown welfare structure.');
        r.floats(11);
        Object.assign(f, r.fields([['u', '2c0'], ['f', '340'], ['u', '39f'], ['f', '360 364 368 36c 370 380'], ['b', '3c8 3cb 3cd'], ['f', '350 354']]));
        if (v >= 76) r.f();
        Object.assign(f, r.fields([['u', '2b8'], ['b', '3df 3c3 3d3'], ['u', '3e1'], ['b', '3cc'], ['f', '388 38c']]));
        for (const added of [69, 72, 74, 74, 74, 74, 78]) if (v >= added) r.b();
        r.floats(2); r.list(() => r.u()); a.cachedMates = r.list(() => r.u());
        r.fields([['u', '4a8 4a9'], ['f', '4ac'], ['u', '538'], ['b', '539 53a 53b'], ['f', '53c'], ['u', '540']]);
        const outer = r.fields([['u', '4b0 4b8 4ba'], ['f', '4bc'], ['u', '4c0'], ['b', '4c8'], ['f', '4cc 4d0'], ['b', '4d4'], ['f', '54c 550']]);
        r.list(() => { r.s(); r.f(); if (v < 77) { r.f(); r.u(); } }, true, 2);
        if (r.u() !== outer['4b0']) throw Error('Inconsistent animal entity.'); r.u();
        if (r.count(true, 6) !== 3) throw Error('Unknown injury structure.');
        r.repeat(3, () => { r.u(); r.floats(3); r.f(true); r.f(true); });
        r.u(); a.injurySeverity = r.f(); r.repeat(3, () => r.b()); r.list(() => r.s()); r.f(); r.b(); r.floats(6);
        if (r.count(true, 4) !== 9) throw Error('Unknown vector structure.'); r.floats(38);
        r.s(); r.uints(2); if (v >= 73) r.floats(8); if (v >= 68) r.wide(true); if (v >= 71) r.u();
        if (v >= 75) r.fields([['b', '630'], ['u', '634'], ['f', '638'], ['b', '63c']]);
        if (v >= 79) r.list(() => { r.uints(2); r.f(); }, true, 3);
        if (v >= 82) { r.uints(2); r.f(); }
        Object.assign(a, { entity: outer['4b0'], assignedHabitatEntity: f['2d8'], ageYears: f['31c'] / 1080, ageStatus: f['39d'], sex: f['39c'], location: f['3a6'], welfare: f['360'], infertile: !f['3bd'], contraception: f['3c3'], failedConception: f['3bc'], interbirth: f['304'], infection: outer['4b0'] !== 0 && outer['4b8'] > 0, injuryWarning: [0.5, 0.75, 1].includes(a.injurySeverity) && f['3c1'], habitats: [] });
        return a;
    }, true, 100);
    if (v >= 68) r.wide(true); r.finish(); return unique(records);
}
function habitats(data, strings) {
    const r = new ZooReader(data, strings), v = version(r, [25, 26, 27, 30, 32]);
    const records = r.list(() => {
        r.floats(7); const a = { placement: r.u(), entity: r.u(), id: r.u() };
        const metrics = r.floats(6); [a.cleanliness, , a.perimeterArea, a.landArea, a.waterArea, a.climbArea] = metrics;
        if (v >= 26) a.waterDepth = r.f(); r.floats(4); r.u(); a.members = r.list(() => r.u()); r.list(() => r.uints(2), false, 2); r.b(); r.floats(6);
        r.list(() => r.floats(3), false, 3); r.list(() => r.list(() => r.floats(3), false, 3)); a.boundaryComplete = r.b();
        if (v >= 27) r.b(); if (v >= 31) a.guestGate = r.b(); r.floats(24);
        r.list(() => { r.uints(3); r.floats(7); r.u(); r.f(); }, true, 12);
        r.list(() => { r.s(); r.u(); }, true, 2); r.list(() => r.u(), true);
        r.list(() => { r.u(); r.f(); }, true, 2); r.list(() => { r.s(); r.floats(6); }, true, 7);
        r.list(() => { r.b(); r.uints(2); r.f(); r.i32(); r.u(); }, true, 6);
        r.list(() => { r.s(); r.floats(7); r.b(); r.uints(2); }, true, 11);
        a.alphas = [0, 1].flatMap(sex => r.list(() => ({ species: r.s(), entity: r.u(), sex }), true, 2));
        r.list(() => { r.s(); r.floats(4); }, true, 5); r.repeat(v >= 28 ? 6 : 4, () => r.wide()); if (v >= 32) r.u(); return a;
    }, true, 80);
    r.list(() => { r.u(); r.list(() => r.u()); }); r.finish(); return unique(records);
}
function exhibitCore(data, strings) {
    const r = new ZooReader(data, strings), v = version(r, [8, 11, 12]);
    const records = r.list(() => {
        const a = { id: `exhibit:${r.u()}`, species: r.s(), sex: Number(r.b()), kind: 'exhibit' };
        a.ageYears = Math.fround(r.f() / Math.fround(1080)); r.f();
        const unweave = g => [...g.filter((_, i) => i % 2 === 0), ...g.filter((_, i) => i % 2 === 1)];
        a.fertilityGenes = unweave(r.repeat(12, () => r.i32())); a.longevityGenes = unweave(r.repeat(12, () => r.i32()));
        a.ancestry = r.uints(6).map(id => id === 0xffffffff ? null : `exhibit:${id}`); [a.mother, a.father] = a.ancestry;
        r.f(); r.b(); a.contraception = r.b(); a.nameRecord = nameRecord(r); a.colourGenes = r.uints(12); a.unknownGenes = unweave(r.repeat(12, () => r.i32()));
        a.adoptionAgeYears = r.f(); a.birthEvents = r.list(() => r.f()); r.b(); r.u();
        if (v >= 11) r.u(); if (v >= 9) { r.f(); r.uints(2); } if (v >= 10) r.b(); if (v >= 12) r.floats(2);
        a.grades = validGenes(a.fertilityGenes) && validGenes(a.longevityGenes) ? [null, a.longevityGenes.filter(g => g < 2).length, null, a.fertilityGenes.slice(0, 6).filter((g, i) => g !== a.fertilityGenes[i + 6]).length, null] : null;
        return a;
    }, true, 70);
    r.finish(); return unique(records);
}
function currentExhibits(data, strings) {
    const r = new ZooReader(data, strings); version(r, [14]); r.u();
    const records = r.list(() => {
        const a = { id: `exhibit:${r.u()}`, placement: r.u() }; r.floats(3); r.i32(); a.matingNeed = r.f(); a.entity = r.u(); r.list(() => r.u()); a.food = r.f(); a.offspring = r.u(); a.pregnancies = r.u(); a.pregnant = r.b();
        if (a.pregnant) { a.pregnancyFather = `exhibit:${r.u()}`; a.litterSize = r.u(); a.pregnancyElapsed = r.f(); } return a;
    }); r.finish(); return unique(records);
}
function scenario(data, strings) {
    const r = new ZooReader(data, strings); r.u(); r.expect('LuaTab>>'); const table = new ZooReader(r.take(r.u()), strings); const settings = table.table(); table.finish(); r.expect('<<LuaTab'); r.finish();
    for (const key of ['bDisableAging', 'bEnableMating', 'bEnableSocialGroups', 'bEnableSandboxResearch', 'bAnimalTogglesEnabled', 'bDifficultyTogglesEnabled']) if (key in settings && typeof settings[key] !== 'boolean') throw Error('Unknown scenario setting.');
    return { gameMode: settings.sGameMode, matingDisabled: settings.sGameMode === 'Sandbox' && settings.bAnimalTogglesEnabled === true ? settings.bDisableAging ?? null : null, researchEnabled: settings.bEnableSandboxResearch ?? null, socialGroupsEnabled: settings.bEnableSocialGroups ?? null };
}
function research(data) {
    const r = new ZooReader(data), v = version(r, [19, 20, 21, 22]), count = r.i32();
    if (count < 0 || count * 11 > data.length - r.pos) throw Error('Unknown research list.');
    const collected = new Set();
    r.repeat(count, () => { const id = r.i32(); r.floats(2); r.i32(); r.floats(2); r.b(); r.b(); r.f(); r.b(); if (r.u() === 4) collected.add(id); if (v >= 20) r.b(); });
    const ids = r.list(() => r.i32()); if (ids.length !== collected.size || ids.some(id => !collected.has(id))) throw Error('Inconsistent research unlocks.');
    r.list(() => { r.uints(2); r.i32(); r.f(); }); r.finish(); return ids;
}
module.exports = { datastore, currentAnimals, habitats, exhibitCore, currentExhibits, scenario, research, grades };
