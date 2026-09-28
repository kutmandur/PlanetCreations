// Streamed container for Custom Media backups (*.PlanetCreationsMedia).
//
//   bytes 0-7    "PCMEDIA1"
//   bytes 8-15   header length (unsigned 64-bit big endian)
//   header       UTF-8 JSON { metadata, manifest }  (manifest is the exact signed text)
//   data         raw asset bytes, concatenated in manifest order
//
// The signed metadata is unchanged from ZIP media packages: it signs the SHA-256
// of the manifest text, and the manifest pins SHA-256 and size of every asset.
// Media files are already compressed, so the container stores them as-is and is
// read and written as a stream without any size limit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validatePortableManifest } = require('./MediaManifest');

const MEDIA_PACKAGE_EXTENSION = '.planetcreationsmedia';
const MEDIA_PACKAGE_MAGIC = Buffer.from('PCMEDIA1', 'ascii');
const PREFIX_BYTES = 16;
// metadata (64 KiB) + manifest (1 MiB) with JSON escaping headroom.
const MAX_HEADER_BYTES = 4 * 1024 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;

function isMediaPackagePath(filePath) {
    return typeof filePath === 'string' && filePath.toLowerCase().endsWith(MEDIA_PACKAGE_EXTENSION);
}

function hasMediaPackageMagic(filePath) {
    let descriptor = null;
    try {
        descriptor = fs.openSync(filePath, 'r');
        const magic = Buffer.alloc(MEDIA_PACKAGE_MAGIC.length);
        const bytesRead = fs.readSync(descriptor, magic, 0, magic.length, 0);
        return bytesRead === magic.length && magic.equals(MEDIA_PACKAGE_MAGIC);
    } catch {
        return false;
    } finally {
        if (descriptor !== null) fs.closeSync(descriptor);
    }
}

function readMediaPackageHeader(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const fileSize = fs.fstatSync(descriptor).size;
        const prefix = Buffer.alloc(PREFIX_BYTES);
        if (fs.readSync(descriptor, prefix, 0, PREFIX_BYTES, 0) !== PREFIX_BYTES ||
            !prefix.subarray(0, MEDIA_PACKAGE_MAGIC.length).equals(MEDIA_PACKAGE_MAGIC)) {
            throw new Error('This is not a PlanetCreations media package.');
        }
        const headerLength = prefix.readBigUInt64BE(8);
        if (headerLength < 2n || headerLength > BigInt(MAX_HEADER_BYTES) ||
            BigInt(PREFIX_BYTES) + headerLength > BigInt(fileSize)) {
            throw new Error('The media package header is missing or too large.');
        }
        const header = Buffer.alloc(Number(headerLength));
        if (fs.readSync(descriptor, header, 0, header.length, PREFIX_BYTES) !== header.length) {
            throw new Error('The media package header is incomplete.');
        }
        let parsed;
        try { parsed = JSON.parse(header.toString('utf8')); } catch { throw new Error('The media package header is not valid JSON.'); }
        if (!parsed || typeof parsed !== 'object' || !parsed.metadata || typeof parsed.metadata !== 'object' ||
            typeof parsed.manifest !== 'string') {
            throw new Error('The media package header is incomplete.');
        }
        return { metadata: parsed.metadata, manifestText: parsed.manifest, dataOffset: PREFIX_BYTES + header.length, fileSize };
    } finally {
        fs.closeSync(descriptor);
    }
}

// Validates structure and signature. Asset bytes are verified when they are
// copied into the media library, so a multi-gigabyte package is read only once.
function inspectStreamedMediaPackage(filePath, allowedExtensions, publicKey, { validateCommonMetadata, verifyMetadataSignature, sha256 }) {
    const { metadata, manifestText, dataOffset, fileSize } = readMediaPackageHeader(filePath);
    validateCommonMetadata(metadata, allowedExtensions, 'media');
    const manifestBuffer = Buffer.from(manifestText, 'utf8');
    if (sha256(manifestBuffer) !== metadata.mediaManifestSha256) {
        throw new Error('The media manifest failed its SHA-256 integrity check.');
    }
    let manifestValue;
    try { manifestValue = JSON.parse(manifestText); } catch { throw new Error('The media manifest is not valid JSON.'); }
    const manifest = validatePortableManifest(manifestValue);
    const totalSize = manifest.assets.reduce((sum, asset) => sum + asset.size, 0);
    if (manifest.mediaSetId !== metadata.mediaSetId || metadata.assetCount !== manifest.assets.length ||
        metadata.assetCount < 1 || !Number.isSafeInteger(metadata.assetsTotalSize) ||
        metadata.assetsTotalSize !== totalSize || metadata.assetsTotalSize < 1) {
        throw new Error('The media manifest does not match its signed metadata.');
    }
    if (dataOffset + totalSize !== fileSize) {
        throw new Error('The media package is incomplete or contains unexpected data.');
    }
    let offset = dataOffset;
    const assetEntries = manifest.assets.map(asset => {
        const entry = { asset, offset };
        offset += asset.size;
        return entry;
    });
    const signatureStatus = !metadata.isSigned ? 'unsigned' :
        (!publicKey ? 'unverified' : (verifyMetadataSignature(metadata, publicKey) ? 'verified' : 'invalid'));
    return { metadata, mediaManifest: manifest, packagePath: filePath, assetEntries, signatureStatus, container: 'stream' };
}

async function writeMediaPackage({ destination, metadata, manifestText, assets }) {
    const header = Buffer.from(JSON.stringify({ metadata, manifest: manifestText }), 'utf8');
    if (header.length > MAX_HEADER_BYTES) throw new Error('The media manifest is too large.');
    const prefix = Buffer.alloc(PREFIX_BYTES);
    MEDIA_PACKAGE_MAGIC.copy(prefix);
    prefix.writeBigUInt64BE(BigInt(header.length), 8);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporaryPath = `${destination}.${crypto.randomUUID()}.tmp`;
    const output = await fs.promises.open(temporaryPath, 'wx');
    try {
        await output.write(prefix);
        await output.write(header);
        const chunk = Buffer.alloc(COPY_CHUNK_BYTES);
        for (const asset of assets) {
            const input = await fs.promises.open(asset.path, 'r');
            const hash = crypto.createHash('sha256');
            let copied = 0;
            try {
                for (;;) {
                    const { bytesRead } = await input.read(chunk, 0, chunk.length, null);
                    if (bytesRead === 0) break;
                    copied += bytesRead;
                    if (copied > asset.size) break;
                    const part = chunk.subarray(0, bytesRead);
                    hash.update(part);
                    await output.write(part);
                }
            } finally {
                await input.close();
            }
            if (copied !== asset.size || hash.digest('hex') !== asset.sha256) {
                throw new Error('A media asset changed while creating the package.');
            }
        }
        await output.sync();
        await output.close();
        await fs.promises.rename(temporaryPath, destination);
    } catch (error) {
        await output.close().catch(() => {});
        await fs.promises.unlink(temporaryPath).catch(() => {});
        throw error;
    }
    return destination;
}

// "Harbor Park-A1B2C3D4.park2" -> "Harbor Park - Media 2026-09-28 0305 (1a2b3c4d).PlanetCreationsMedia"
function mediaPackageFileName(sourceFilePath, packageId, createdAt = new Date()) {
    const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath))
        .replace(/-[0-9a-f]{8}$/i, '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
        .replace(/[. ]+$/, '') || 'Creation';
    const pad = value => String(value).padStart(2, '0');
    const stamp = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}`;
    return `${baseName} - Media ${stamp} (${packageId.slice(0, 8)}).PlanetCreationsMedia`;
}

module.exports = {
    MEDIA_PACKAGE_EXTENSION,
    mediaPackageFileName,
    MEDIA_PACKAGE_MAGIC,
    isMediaPackagePath,
    hasMediaPackageMagic,
    readMediaPackageHeader,
    inspectStreamedMediaPackage,
    writeMediaPackage,
};
