const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const {readFileBoundedSync} = require('./BoundedFile');
const {inspectCreationPackage, inspectMediaPackage, sha256, MAX_BACKUP_SIZE_BYTES} = require('./BackupFormat');
async function run({operation, data}) {
    if (operation === 'hash') {
        const before = fs.statSync(data.path);
        if (!before.size || before.size > (data.maxBytes || MAX_BACKUP_SIZE_BYTES)) throw new Error('The game file must be between 1 byte and 300 MB.');
        const hash = crypto.createHash('sha256');
        let size = 0;
        for await (const chunk of fs.createReadStream(data.path)) { size += chunk.length; if (size > (data.maxBytes || MAX_BACKUP_SIZE_BYTES)) throw new Error('File grew beyond its size limit.'); hash.update(chunk); }
        const after = fs.statSync(data.path);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The file changed during backup. Please retry.');
        return {size, sha256: hash.digest('hex')};
    }
    if (operation === 'inspect') {
        const result = data.media ? inspectMediaPackage(data.path, data.extensions, data.publicKey) : inspectCreationPackage(data.path, data.extensions, data.publicKey);
        delete result.zip;
        return result;
    }
    if (operation === 'legacyPayload') {
        const name = path.basename(data.name || '');
        if (!data.extensions.includes(path.extname(name).toLowerCase())) throw new Error('Legacy payload type is unsupported.');
        const entry = new AdmZip(data.path).getEntry(name);
        if (!entry || !Number.isSafeInteger(entry.header.size) || entry.header.size < 1 || entry.header.size > MAX_BACKUP_SIZE_BYTES) throw new Error('Legacy payload is missing or exceeds 300 MB.');
        return {payloadBuffer: entry.getData()};
    }
    if (operation === 'metadata') {
        const entry = new AdmZip(data.path).getEntry('metadata.json');
        if (!entry || entry.header.size > 65536) throw new Error('metadata.json is missing or too large.');
        return JSON.parse(entry.getData().toString('utf8'));
    }
    if (operation === 'mediaSnapshot') {
        const media = require('./MediaManager');
        const sync = media.syncAutomaticMediaSnapshot(data.sourcePath);
        const snapshot = media.getSnapshot(data.sourcePath);
        const manifest = media.createPortableManifest(data.sourcePath, snapshot?.mediaSetId);
        return {sync, snapshot, manifest};
    }
    if (operation === 'list') return require('./BackupCatalog').listBackups(data.paths);
    if (operation === 'archive') {
        const zip = new AdmZip();
        if (data.sourcePath) {
            const size = fs.statSync(data.sourcePath).size;
            if (!size || size > MAX_BACKUP_SIZE_BYTES) throw new Error('The game file exceeds its size limit.');
            const payload = readFileBoundedSync(data.sourcePath, MAX_BACKUP_SIZE_BYTES);
            if (payload.length !== data.metadata.payloadSize || sha256(payload) !== data.metadata.payloadSha256) throw new Error('The file changed while its metadata was being signed. Please retry.');
            zip.addFile(data.metadata.payloadPath, payload);
        }
        for (const asset of data.assets || []) {
            const bytes = readFileBoundedSync(asset.path, asset.size);
            if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) throw new Error('A media asset changed while creating the package.');
            zip.addFile(asset.name, bytes);
        }
        zip.addFile('media_manifest.json', Buffer.from(data.manifest));
        zip.addFile('metadata.json', Buffer.from(JSON.stringify(data.metadata, null, 2)));
        const temp = `${data.destination}.${crypto.randomUUID()}.tmp`;
        try { zip.writeZip(temp); fs.renameSync(temp, data.destination); }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
        return data.destination;
    }
    throw new Error(`Unknown backup operation: ${operation}`);
}
run(workerData).then(value => {
    const buffers = [value?.payloadBuffer, ...(value?.assetBuffers || []).map(asset => asset.buffer)].filter(Boolean);
    const transfers = [...new Set(buffers.filter(buffer => buffer.byteLength === buffer.buffer.byteLength).map(buffer => buffer.buffer))];
    parentPort.postMessage({value}, transfers);
}, error => parentPort.postMessage({error: error.message}));
