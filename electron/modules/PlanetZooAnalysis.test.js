const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const { ZooReader, decodeLayout, readBoundedZooFile } = require('./PlanetZooReader');
const {resolveZooSavePath} = require('./LocalLibraryPath');
const { analysePlanetZoo, displayName } = require('./PlanetZooAnalysis');
const { loadPlanetZooAnalysis } = require('./PlanetZooAnalysisService');
const { currentAnimals, exhibitCore } = require('./PlanetZooRecords');
const b = (...items) => Buffer.concat(items.map(i => Buffer.isBuffer(i) ? i : typeof i === 'string' ? Buffer.from(i, 'latin1') : Buffer.from([i])));
const s = text => b(243, Buffer.from(text), 0);
const u = n => n < 64 ? b(n) : (() => { const data = Buffer.alloc(5); data[0] = 241; data.writeUInt32BE(n, 1); return data; })();
function emptySave() {
    const blocks = { LocalAnimalDatastore: b(38, 0, s(''), 0), AnimalSerialisation: b(u(84), 0, 0), HabitatSerialisation: b(32, 0, 0), ExhibitAnimalCoreDataStore: b(12, 0), ExhibitAnimalSerialisation: b(14, 0, 0), ScenarioManager: b(1, 'LuaTab>>', 4, Buffer.alloc(4), '<<LuaTab'), ResearchManager: b(22, 0, 0, 0) };
    const bodies = Object.entries(blocks).map(([name, data]) => ({ name, data, versionBytes: data[0] === 241 ? 5 : 1 }));
    return b('CobraSav', 4, 4, s('[test]'), 1, 'Header>IDs>', 0, 'Strings>', 0, 'WString>', 0, 'Hierarchy>', 0, 'ClientSizes>', bodies.length, ...bodies.map(a => u(a.data.length - a.versionBytes)), '<Header', ...bodies.map(a => b('Client>>', s(a.name), a.data, '<<Client')), 255);
}
function writeFixture(t, malformedDirectory = false) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planet-zoo-test-')), file = path.join(dir, malformedDirectory ? 'test.zoo_auto' : 'test.zoo');
    t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
    const payload = emptySave(), wrapper = Buffer.alloc(16); wrapper.writeUInt32BE(0xff00fe01); wrapper.writeUInt32BE(payload.length, 12);
    const zip = new AdmZip(); zip.addFile('parkdata', Buffer.concat([wrapper, payload])); const raw = zip.toBuffer();
    if (malformedDirectory) raw.writeUInt32LE(0, raw.lastIndexOf(Buffer.from('504b0506', 'hex')) + 12);
    fs.writeFileSync(file, raw); return { file, raw };
}
test('native integers distinguish signed, unsigned and wide tags without precision loss', () => {
    assert.equal(new ZooReader(Buffer.from('7f', 'hex')).i32(), -1);
    assert.equal(new ZooReader(Buffer.from('c800', 'hex')).i32(), -2048);
    assert.equal(new ZooReader(Buffer.from('dfffff', 'hex')).i32(), -1);
    assert.equal(new ZooReader(Buffer.from('f1ffffffff', 'hex')).u(), 4294967295);
    assert.equal(new ZooReader(Buffer.from('f97fffffffffffffff', 'hex')).wide(true), 9223372036854775807n);
    assert.throws(() => new ZooReader(Buffer.from('7f', 'hex')).u(), /Negative/);
    assert.throws(() => new ZooReader(Buffer.from('f1ffffffff', 'hex')).i32(), /Invalid/);
});
test('numbers, booleans and strings fail closed on truncation or unsupported values', () => {
    assert.throws(() => new ZooReader(b(240, 0)).i32(), /Incomplete/);
    assert.throws(() => new ZooReader(b(2)).b(), /boolean/);
    assert.throws(() => new ZooReader(b(3)).s(), /string reference/);
    assert.throws(() => new ZooReader(b(243, 'unfinished')).s(), /Incomplete/);
    assert.throws(() => new ZooReader(b(63)).count(), /list length/);
    const nan = Buffer.from('f27fc00000', 'hex');
    assert.throws(() => new ZooReader(nan).f(), /Non-finite/);
    assert.equal(new ZooReader(nan).f(true), null);
});
test('Cobra layout consumes the entire frame and refuses unknown state schemas', () => {
    const payload = emptySave(); assert.equal(Object.keys(decodeLayout(payload).blocks).length, 7);
    assert.throws(() => decodeLayout(b(payload, 0)), /fully read/);
    assert.throws(() => decodeLayout(payload.subarray(0, payload.length - 1)), /Incomplete/);
    assert.throws(() => currentAnimals(b(42, 0), []), /not supported yet/);
});
test('empty local save decodes through the worker service and is cached', async t => {
    const { file } = writeFixture(t); const result = await loadPlanetZooAnalysis(file);
    assert.equal(result.schemaVersion, 1); assert.deepEqual(result.animals, []); assert.deepEqual(result.warnings, []);
    assert.equal(await loadPlanetZooAnalysis(file), result);
});
test('autosave ZIP repair only changes the in-memory directory', t => {
    const { file, raw } = writeFixture(t, true); assert.deepEqual(analysePlanetZoo(file).warnings, []);
    assert.deepEqual(fs.readFileSync(file), raw);
});
test('unnamed animals use species and ID, while custom names take precedence', () => {
    assert.deepEqual(displayName({ id: 'A#1', species: 'SaltwaterCrocodile', cachedName: 'Cached name', nameRecord: { parts: ['Mara', 'AnimalNames_Test_1'] } }), { name: 'Mara', nameSource: 'custom' });
    assert.deepEqual(displayName({ id: 'A#1', species: 'SaltwaterCrocodile', nameRecord: { parts: ['', 'AnimalNames_Test_1'] } }), { name: 'Saltwater Crocodile A#1', nameSource: 'fallback' });
});
test('exhibit parent ID zero is valid and interleaved genes are normalized to strands', () => {
    const genome = b(...Array.from({ length: 12 }, (_, i) => i % 2 ? 3 : 0));
    const data = b(12, 1, 2, s('TestSpecies'), 1, 0, 0, genome, genome,
        u(0), u(0xffffffff), ...Array(4).fill(u(0xffffffff)),
        0, 1, 0, s(''), s(''), s(''), 0, Buffer.alloc(12), genome,
        127, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    const [animal] = exhibitCore(data, []);
    assert.equal(animal.id, 'exhibit:2'); assert.equal(animal.mother, 'exhibit:0'); assert.equal(animal.father, null);
    assert.deepEqual(animal.fertilityGenes, [...Array(6).fill(0), ...Array(6).fill(3)]);
    assert.equal(animal.grades[3], 6); assert.equal(animal.grades[1], 6);
});

test('library boundaries resolve junctions and accept a deliberately linked library root', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-zoo-library-'));
    const inside = path.join(directory, 'inside'), outside = path.join(directory, 'outside');
    fs.mkdirSync(inside); fs.mkdirSync(outside);
    const save = path.join(outside, 'private.zoo'), escape = path.join(inside, 'escape'), chosen = path.join(directory, 'chosen');
    fs.writeFileSync(save, 'fixture');
    fs.symlinkSync(outside, escape, 'junction'); fs.symlinkSync(outside, chosen, 'junction');
    t.after(() => { fs.unlinkSync(escape); fs.unlinkSync(chosen); fs.unlinkSync(save); fs.rmdirSync(inside); fs.rmdirSync(outside); fs.rmdirSync(directory); });
    assert.throws(() => resolveZooSavePath(path.join(escape, 'private.zoo'), inside), /resolves outside/);
    assert.throws(() => resolveZooSavePath(save, inside), /outside/);
    assert.equal(resolveZooSavePath(path.join(chosen, 'private.zoo'), chosen), fs.realpathSync(save));
    assert.throws(() => resolveZooSavePath(path.join(chosen, 'private.txt'), chosen), /unsupported/);
});

test('bounded save reads reject oversized/empty files and cache detects a same-size rewrite with restored modification time', async t => {
    const {file, raw} = writeFixture(t);
    assert.throws(() => readBoundedZooFile(file, raw.length - 1), /size limit/);
    const first = await loadPlanetZooAnalysis(file);
    const stat = fs.statSync(file);
    await new Promise(resolve => setTimeout(resolve, 15));
    fs.writeFileSync(file, raw); fs.utimesSync(file, stat.atime, stat.mtime);
    const second = await loadPlanetZooAnalysis(file);
    assert.notEqual(first, second, 'a rewritten file must not reuse stale cached analysis');
    assert.deepEqual(second.animals, first.animals);
    fs.writeFileSync(file, '');
    assert.throws(() => readBoundedZooFile(file), /nonempty/);
});

test('failed jobs release the queue and changed queued saves never return stale results', async t => {
    const {file, raw} = writeFixture(t);
    fs.writeFileSync(file, 'broken');
    await assert.rejects(loadPlanetZooAnalysis(file), /ZIP directory/);
    fs.writeFileSync(file, raw);
    const queued = loadPlanetZooAnalysis(file);
    fs.writeFileSync(file, Buffer.concat([raw, Buffer.from('changed')]));
    await assert.rejects(queued, /changed while waiting/);
    fs.writeFileSync(file, raw);
    assert.equal((await loadPlanetZooAnalysis(file)).schemaVersion, 1);
});

test('burst requests share one in-flight result per file and bound the waiting queue', async t => {
    const files = Array.from({length: 9}, () => writeFixture(t).file);
    const first = loadPlanetZooAnalysis(files[0]);
    assert.equal(loadPlanetZooAnalysis(files[0]), first);
    const results = await Promise.allSettled([first, ...files.slice(1).map(file => loadPlanetZooAnalysis(file))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 8);
    assert.match(results[8].reason.message, /analysis is busy/);
    assert.equal((await loadPlanetZooAnalysis(files[8])).schemaVersion, 1);
});

test('a forged ZIP expanded size cannot bypass the decompression bound', t => {
    const {file, raw} = writeFixture(t);
    const forged = Buffer.from(raw);
    const directory = forged.indexOf(Buffer.from('504b0102', 'hex'));
    assert.ok(directory >= 0);
    forged.writeUInt32LE(8, directory + 24);
    fs.writeFileSync(file, forged);
    assert.throws(() => analysePlanetZoo(file));
    assert.deepEqual(fs.readFileSync(file), forged);
});
