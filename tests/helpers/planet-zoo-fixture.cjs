const AdmZip = require('adm-zip');
const b = (...items) => Buffer.concat(items.map(i => Buffer.isBuffer(i) ? i : typeof i === 'string' ? Buffer.from(i, 'latin1') : Buffer.from([i])));
const s = text => b(243, Buffer.from(text), 0);
const u = n => n < 64 ? b(n) : (() => { const data = Buffer.alloc(5); data[0] = 241; data.writeUInt32BE(n, 1); return data; })();
function emptySave(overrides = {}) {
    const blocks = {LocalAnimalDatastore: b(38, 0, s(''), 0), AnimalSerialisation: b(u(84), 0, 0), HabitatSerialisation: b(32, 0, 0), ExhibitAnimalCoreDataStore: b(12, 0), ExhibitAnimalSerialisation: b(14, 0, 0), ScenarioManager: b(1, 'LuaTab>>', 4, Buffer.alloc(4), '<<LuaTab'), ResearchManager: b(22, 0, 0, 0), ...overrides};
    const bodies = Object.entries(blocks).map(([name, data]) => ({name, data, versionBytes: data[0] === 241 ? 5 : 1}));
    return b('CobraSav', 4, 4, s('[test]'), 1, 'Header>IDs>', 0, 'Strings>', 0, 'WString>', 0, 'Hierarchy>', 0, 'ClientSizes>', bodies.length, ...bodies.map(a => u(a.data.length - a.versionBytes)), '<Header', ...bodies.map(a => b('Client>>', s(a.name), a.data, '<<Client')), 255);
}
function zooArchive(payload = emptySave()) {
    const wrapper = Buffer.alloc(16); wrapper.writeUInt32BE(0xff00fe01); wrapper.writeUInt32BE(payload.length, 12);
    const zip = new AdmZip(); zip.addFile('parkdata', Buffer.concat([wrapper, payload])); return zip.toBuffer();
}
module.exports = {b, s, u, emptySave, zooArchive};
