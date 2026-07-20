const crypto = require('crypto');
const path = require('path');
const AdmZip = require('adm-zip');
const { validatePortableManifest } = require('./MediaManager');

const FORMAT_NAME = 'PlanetCreationsBackup';
const FORMAT_VERSION = 2;
const MAX_BACKUP_SIZE_BYTES = 300 * 1024 * 1024;
const MAX_METADATA_SIZE_BYTES = 64 * 1024;
const MAX_MANIFEST_SIZE_BYTES = 1024 * 1024;
const MAX_MEDIA_TOTAL_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function canonicalStringify(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Only finite numbers can be signed.');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
    }
    throw new TypeError(`Unsupported value in signed data: ${typeof value}`);
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isSafeBaseName(fileName) {
    return typeof fileName === 'string' && fileName.length > 0 && fileName.length <= 255 &&
        fileName === path.basename(fileName) && !fileName.includes('/') && !fileName.includes('\\') &&
        fileName !== '.' && fileName !== '..';
}

function parseJsonEntry(entry, label, maxSize) {
    if (!entry || entry.isDirectory) throw new Error(`${label} is missing.`);
    if (entry.header.size > maxSize) throw new Error(`${label} is too large.`);
    const buffer = entry.getData();
    try {
        return { value: JSON.parse(buffer.toString('utf8')), buffer };
    } catch (error) {
        throw new Error(`${label} is not valid JSON.`);
    }
}

function validateCommonMetadata(metadata, allowedExtensions, packageType) {
    if (!metadata || metadata.format !== FORMAT_NAME || metadata.formatVersion !== FORMAT_VERSION ||
        metadata.packageType !== packageType) {
        throw new Error(`This is not a PlanetCreations ${packageType} package version 2.`);
    }
    if (!UUID_PATTERN.test(metadata.packageId || '') || !UUID_PATTERN.test(metadata.mediaSetId || '')) {
        throw new Error('Invalid package or media-set identifier.');
    }
    if (!isSafeBaseName(metadata.originalFileName) ||
        !allowedExtensions.includes(path.extname(metadata.originalFileName).toLowerCase())) {
        throw new Error('The linked game-file name is invalid.');
    }
    if (!SHA256_PATTERN.test(metadata.mediaManifestSha256 || '')) {
        throw new Error('The media-manifest checksum is invalid.');
    }
}

function verifyMetadataSignature(metadata, publicKey) {
    if (metadata.isSigned !== true || metadata.signature?.algorithm !== 'RSA-SHA256' ||
        typeof metadata.signature?.keyId !== 'string' || metadata.signature.keyId.length > 100 ||
        typeof metadata.signature?.value !== 'string' || !/^[a-f0-9]+$/.test(metadata.signature.value) ||
        typeof metadata.signerUid !== 'string' || metadata.signerUid.length < 1 ||
        typeof metadata.signerUsername !== 'string' || metadata.signerUsername.length > 200) return false;
    const signableMetadata = { ...metadata };
    delete signableMetadata.signature;
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalStringify(signableMetadata));
    verifier.end();
    return verifier.verify(publicKey, metadata.signature.value, 'hex');
}

function readZip(source) {
    try {
        return new AdmZip(source);
    } catch (error) {
        throw new Error('The package is not a valid ZIP archive.');
    }
}

function validateEntryPaths(entries) {
    if (entries.some(entry => entry.isDirectory || entry.entryName.startsWith('/') ||
        entry.entryName.includes('\\') || entry.entryName.split('/').includes('..'))) {
        throw new Error('The package contains an unsafe ZIP path.');
    }
}

function inspectCreationPackage(source, allowedExtensions, publicKey = null) {
    const zip = readZip(source);
    const entries = zip.getEntries();
    validateEntryPaths(entries);
    if (entries.length !== 3) throw new Error('A creation package must contain exactly three files.');
    const { value: metadata } = parseJsonEntry(zip.getEntry('metadata.json'), 'metadata.json', MAX_METADATA_SIZE_BYTES);
    validateCommonMetadata(metadata, allowedExtensions, 'creation');
    if (metadata.payloadPath !== `payload/${metadata.originalFileName}` ||
        !Number.isSafeInteger(metadata.payloadSize) || metadata.payloadSize <= 0 ||
        metadata.payloadSize > MAX_BACKUP_SIZE_BYTES || !SHA256_PATTERN.test(metadata.payloadSha256 || '')) {
        throw new Error('The signed game-file metadata is invalid.');
    }
    const payloadEntry = zip.getEntry(metadata.payloadPath);
    const manifestResult = parseJsonEntry(zip.getEntry('media_manifest.json'), 'media_manifest.json', MAX_MANIFEST_SIZE_BYTES);
    const expectedNames = new Set(['metadata.json', 'media_manifest.json', metadata.payloadPath]);
    if (!payloadEntry || entries.some(entry => !expectedNames.has(entry.entryName))) {
        throw new Error('The creation package contains an unexpected file.');
    }
    if (payloadEntry.header.size !== metadata.payloadSize) {
        throw new Error('The game-file size does not match its signed metadata.');
    }
    const payloadBuffer = payloadEntry.getData();
    if (payloadBuffer.length !== metadata.payloadSize ||
        sha256(payloadBuffer) !== metadata.payloadSha256) {
        throw new Error('The game file failed its SHA-256 integrity check.');
    }
    if (sha256(manifestResult.buffer) !== metadata.mediaManifestSha256) {
        throw new Error('The media manifest failed its SHA-256 integrity check.');
    }
    validatePortableManifest(manifestResult.value);
    if (manifestResult.value.mediaSetId !== metadata.mediaSetId) {
        throw new Error('The media manifest belongs to a different package.');
    }
    const signatureStatus = !metadata.isSigned ? 'unsigned' :
        (!publicKey ? 'unverified' : (verifyMetadataSignature(metadata, publicKey) ? 'verified' : 'invalid'));
    return { zip, metadata, mediaManifest: manifestResult.value, payloadBuffer, signatureStatus };
}

function inspectMediaPackage(source, allowedExtensions, publicKey = null) {
    const zip = readZip(source);
    const entries = zip.getEntries();
    validateEntryPaths(entries);
    const { value: metadata } = parseJsonEntry(zip.getEntry('metadata.json'), 'metadata.json', MAX_METADATA_SIZE_BYTES);
    validateCommonMetadata(metadata, allowedExtensions, 'media');
    const manifestResult = parseJsonEntry(zip.getEntry('media_manifest.json'), 'media_manifest.json', MAX_MANIFEST_SIZE_BYTES);
    const manifest = validatePortableManifest(manifestResult.value);
    if (manifest.mediaSetId !== metadata.mediaSetId || sha256(manifestResult.buffer) !== metadata.mediaManifestSha256 ||
        metadata.assetCount !== manifest.assets.length || metadata.assetCount < 1 ||
        !Number.isSafeInteger(metadata.assetsTotalSize) || metadata.assetsTotalSize < 1 ||
        metadata.assetsTotalSize > MAX_MEDIA_TOTAL_SIZE_BYTES) {
        throw new Error('The media manifest does not match its signed metadata.');
    }
    const expectedNames = new Set(['metadata.json', 'media_manifest.json']);
    let totalSize = 0;
    const assetBuffers = [];
    for (const asset of manifest.assets) {
        const extension = path.extname(asset.logicalName).toLowerCase();
        const entryName = `assets/${asset.sha256}${extension}`;
        if (expectedNames.has(entryName)) throw new Error('The media package contains duplicate asset entries.');
        expectedNames.add(entryName);
        const entry = zip.getEntry(entryName);
        if (!entry) throw new Error(`Checked media data is missing for ${asset.logicalName}.`);
        if (entry.header.size !== asset.size || totalSize + asset.size > MAX_MEDIA_TOTAL_SIZE_BYTES) {
            throw new Error(`The declared media size is invalid for ${asset.logicalName}.`);
        }
        const buffer = entry.getData();
        if (buffer.length !== asset.size || sha256(buffer) !== asset.sha256) {
            throw new Error(`Media integrity check failed for ${asset.logicalName}.`);
        }
        totalSize += buffer.length;
        assetBuffers.push({ asset, buffer });
    }
    if (entries.length !== expectedNames.size || entries.some(entry => !expectedNames.has(entry.entryName)) ||
        totalSize !== metadata.assetsTotalSize) {
        throw new Error('The media package contains unexpected or mismatched files.');
    }
    const signatureStatus = !metadata.isSigned ? 'unsigned' :
        (!publicKey ? 'unverified' : (verifyMetadataSignature(metadata, publicKey) ? 'verified' : 'invalid'));
    return { zip, metadata, mediaManifest: manifest, assetBuffers, signatureStatus };
}

module.exports = {
    FORMAT_NAME,
    FORMAT_VERSION,
    MAX_BACKUP_SIZE_BYTES,
    canonicalStringify,
    sha256,
    inspectCreationPackage,
    inspectMediaPackage,
};
