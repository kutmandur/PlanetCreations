// Strict, bounded Cobra reader. Schemas/evidence: docs/PLANET_ZOO_RECORDS_AND_GENETICS.md.
const fs = require('node:fs');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');
const LIMIT = 512 * 1024 * 1024;
class ZooReader {
    constructor(data, strings = []) { this.data = data; this.strings = strings; this.pos = 0; }
    take(n) {
        if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.data.length) throw Error(`Incomplete zoo data at byte ${this.pos}.`);
        const b = this.data.subarray(this.pos, this.pos + n); this.pos += n; return b;
    }
    byte() { return this.take(1)[0]; }
    expect(s) { if (!this.take(Buffer.byteLength(s, 'latin1')).equals(Buffer.from(s, 'latin1'))) throw Error(`Unexpected zoo structure: ${s}.`); }
    i32() {
        const t = this.byte();
        if (t < 128) return t & 64 ? t - 128 : t;
        if (t >= 192 && t < 240) {
            const n = (t >> 4) - 11, bits = n * 8 + 4;
            const v = (t & 15) * 2 ** (8 * n) + this.take(n).readUIntBE(0, n);
            return t & 8 ? v - 2 ** bits : v;
        }
        if (t === 240) return this.take(4).readInt32BE();
        throw Error(`Invalid integer at byte ${this.pos - 1}.`);
    }
    u() { const v = this.data[this.pos] === 241 ? (this.pos++, this.take(4).readUInt32BE()) : this.i32(); if (v < 0) throw Error('Negative reference.'); return v; }
    wide(unsigned = false) {
        const t = this.data[this.pos];
        if (t === 249 && unsigned) { this.pos++; return this.take(8).readBigUInt64BE(); }
        if (t >= 245 && t <= 248) {
            this.pos++; const b = this.take(t - 240); let v = 0n;
            for (const x of b) v = v * 256n + BigInt(x);
            if (b[0] & 128) v -= 1n << BigInt(8 * b.length);
            if (unsigned && v < 0n) throw Error('Negative count.');
            return v;
        }
        return BigInt(t === 241 || unsigned ? this.u() : this.i32());
    }
    f(allowNonFinite = false) {
        const t = this.byte(); let v;
        if (t < 128) v = t & 64 ? t - 128 : t;
        else if (t < 192) { const b = Buffer.allocUnsafe(4); b[0] = ((t & 31) + 48) | ((t & 32) << 2); this.take(3).copy(b, 1); v = b.readFloatBE(); }
        else if (t === 242) v = this.take(4).readFloatBE();
        else { this.pos--; v = Math.fround(this.i32()); }
        if (!Number.isFinite(v)) { if (allowNonFinite) return null; throw Error('Non-finite value.'); }
        return v;
    }
    b() { const v = this.u(); if (v > 1) throw Error('Invalid boolean value.'); return v === 1; }
    s() {
        if (this.data[this.pos] === 243) {
            this.pos++; const end = this.data.indexOf(0, this.pos);
            if (end < 0) throw Error('Incomplete text.');
            const value = new TextDecoder('utf-8', { fatal: true }).decode(this.take(end - this.pos)); this.pos++; return value;
        }
        const i = this.u(); if (i >= this.strings.length) throw Error('Invalid string reference.'); return this.strings[i];
    }
    count(wide = false, minimum = 1, max = 1000000) {
        const n = Number(wide ? this.wide(true) : this.u());
        if (!Number.isSafeInteger(n) || n < 0 || n > max || n * minimum > this.data.length - this.pos) throw Error('Invalid list length.'); return n;
    }
    repeat(n, method) { return Array.from({ length: n }, () => method()); }
    list(method, wide = false, minimum = 1) { return this.repeat(this.count(wide, minimum), method); }
    floats(n) { return this.repeat(n, () => this.f()); }
    uints(n) { return this.repeat(n, () => this.u()); }
    fields(spec) { const out = {}; for (const [method, names] of spec) for (const name of names.split(' ')) out[name] = this[method](); return out; }
    finish() { if (this.pos !== this.data.length) throw Error(`Zoo block was not fully read (${this.data.length - this.pos} bytes remaining).`); }
    table(depth = 0) {
        if (depth > 50) throw Error('Lua table nesting is too deep.');
        const count = this.take(4).readUInt32BE(); if (count > 100000 || count * 2 > this.data.length - this.pos) throw Error('Lua table is too large.');
        const out = Object.create(null);
        for (let i = 0; i < count; i++) { const key = this.lua(depth), value = this.lua(depth); if (typeof key === 'string') out[key] = value; }
        return out;
    }
    lua(depth) {
        switch (this.byte()) {
            case 5: return this.take(4).readFloatBE();
            case 6: return this.take(8).readBigInt64BE().toString();
            case 7: return this.table(depth + 1);
            case 8: return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.take(2).readUInt16BE()));
            case 9: { const i = this.take(4).readUInt32BE(); if (i >= this.strings.length) throw Error('Invalid Lua string reference.'); return this.strings[i]; }
            case 10: { const b = this.byte(); if (b > 1) throw Error('Invalid Lua boolean.'); return Boolean(b); }
            case 11: return this.take(2).readUInt16BE();
            case 12: return this.repeat(2, () => this.take(4).readFloatBE());
            case 13: return this.repeat(3, () => this.take(4).readFloatBE());
            default: throw Error('Unknown Lua data type.');
        }
    }
}
function readBoundedZooFile(filePath, limit = LIMIT) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || !stat.size) throw Error('Zoo save must be a nonempty regular file.');
        if (stat.size > limit) throw Error('Zoo save file exceeds its size limit (512 MB maximum).');
        const raw = Buffer.allocUnsafe(stat.size);
        let offset = 0;
        while (offset < raw.length) {
            const read = fs.readSync(fd, raw, offset, raw.length - offset, offset);
            if (!read) throw Error('The save changed during reading. Please reload.');
            offset += read;
        }
        const changed = fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0;
        const after = fs.fstatSync(fd);
        if (changed || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw Error('The save changed during reading. Please reload.');
        return raw;
    } finally { fs.closeSync(fd); }
}
function readZooPayload(filePath) {
    let raw = readBoundedZooFile(filePath);
    if (raw.subarray(0, 4).toString() === 'wspk') {
        if (raw.length < 13 || raw.readUInt32LE(8) !== 1) throw Error('Unknown workshop format.');
        const result = zlib.inflateRawSync(raw.subarray(12), { maxOutputLength: LIMIT, info: true });
        if (result.engine.bytesWritten !== raw.length - 12) throw Error('Unexpected extra workshop data.');
        return result.buffer;
    }
    const end = raw.lastIndexOf(Buffer.from('504b0506', 'hex'));
    if (end < Math.max(0, raw.length - 65557) || end + 22 > raw.length) throw Error('Missing ZIP directory.');
    if (raw.readUInt16LE(end + 4) || raw.readUInt16LE(end + 6) || raw.readUInt16LE(end + 8) !== raw.readUInt16LE(end + 10) || end + 22 + raw.readUInt16LE(end + 20) !== raw.length) throw Error('Unsupported ZIP structure.');
    if (raw.readUInt16LE(end + 10) && raw.readUInt32LE(end + 12) === 0) {
        const offset = raw.readUInt32LE(end + 16);
        if (offset + 4 > end || raw.readUInt32LE(offset) !== 0x02014b50) throw Error('Invalid autosave directory.');
        raw = Buffer.from(raw); raw.writeUInt32LE(end - offset, end + 12); // Repair only in memory.
    }
    const zip = new AdmZip(raw), entries = zip.getEntries();
    if (entries.length !== raw.readUInt16LE(end + 10) || new Set(entries.map(e => e.entryName)).size !== entries.length || entries.reduce((n, e) => n + e.header.size, 0) > LIMIT) throw Error('ZIP limit exceeded or duplicate entries found.');
    const entry = zip.getEntry('parkdata'); if (!entry) throw Error('Not a zoo save: parkdata is missing.');
    const data = entry.getData();
    if (data.length < 16 || data.readUInt32BE() !== 0xff00fe01 || data.readUInt32BE(12) !== data.length - 16) throw Error('Invalid Frontier wrapper.');
    return data.subarray(16);
}
function decodeLayout(data) {
    const r = new ZooReader(data); r.expect('CobraSav');
    if (![3, 4].includes(r.u()) || ![3, 4].includes(r.u())) throw Error('Unknown Cobra version.');
    const game = r.s(), gameVersion = r.u(); r.expect('Header>IDs>');
    const references = Object.create(null);
    for (let i = r.count(false, 1, 128); i > 0; i--) {
        r.expect('<'); const name = r.s(); r.expect('>'); const count = r.count(false, 1, 10000000);
        const seen = new Set(); for (let j = 0; j < count; j++) { const v = r.u(); if (v < 1 || v > count || seen.has(v)) throw Error('Invalid reference table.'); seen.add(v); }
        references[name] = count;
    }
    r.expect('Strings>'); const strings = r.list(() => { if (r.data[r.pos] !== 243) throw Error('Invalid string table.'); return r.s(); }); r.strings = strings;
    r.expect('WString>'); if (r.u() !== 0) throw Error('Wide string table is not supported yet.');
    r.expect('Hierarchy>'); r.list(() => { r.u(); r.u(); r.s(); }, true, 3);
    r.expect('ClientSizes>'); const sizes = r.list(() => r.u()); r.expect('<Header');
    const blocks = Object.create(null);
    for (const size of sizes) { r.expect('Client>>'); const name = r.s(), start = r.pos; r.u(); r.take(size); if (blocks[name]) throw Error('Duplicate zoo block.'); blocks[name] = data.subarray(start, r.pos); r.expect('<<Client'); }
    r.expect('\xff'); r.finish();
    return { strings, blocks, references, game, gameVersion };
}
module.exports = { ZooReader, readZooPayload, decodeLayout, readBoundedZooFile };
