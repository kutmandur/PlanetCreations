const crypto = require("crypto");
const path = require("path");
const AdmZip = require("adm-zip");

const FORMAT_NAME = "PlanetCreationsBackup";
const MEDIA_MANIFEST_FORMAT = "PlanetCreationsMediaManifest";
const FORMAT_VERSION = 2;
const MAX_BACKUP_SIZE_BYTES = 300 * 1024 * 1024;
const MAX_METADATA_SIZE_BYTES = 64 * 1024;
const MAX_MANIFEST_SIZE_BYTES = 1024 * 1024;
const MAX_MEDIA_TOTAL_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg"]);
const USER_MEDIA_EXTENSIONS = new Set([
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov",
]);

function canonicalStringify(value) {
    if (value === null || typeof value === "boolean" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("Only finite numbers can be signed.");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalStringify).join(",")}]`;
    }
    if (typeof value === "object") {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
    }
    throw new TypeError(`Unsupported value in signed data: ${typeof value}`);
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isSafeBaseName(fileName) {
    return typeof fileName === "string" &&
        fileName.length > 0 &&
        fileName.length <= 255 &&
        fileName === path.basename(fileName) &&
        !fileName.includes("/") &&
        !fileName.includes("\\") &&
        fileName !== "." &&
        fileName !== "..";
}

function rejectUnexpectedKeys(object, allowedKeys) {
    const unexpected = Object.keys(object).filter((key) => !allowedKeys.has(key));
    if (unexpected.length > 0) throw new Error(`Unexpected signed metadata field: ${unexpected[0]}`);
}

function validateUnsignedMetadata(metadata, allowedExtensions, expectedPackageType = "creation") {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("metadata.json must contain an object.");
    }
    rejectUnexpectedKeys(metadata, new Set([
        "format", "formatVersion", "packageType", "packageId", "mediaSetId", "gameId",
        "fileKind", "originalFileName", "payloadPath", "payloadSize", "payloadSha256",
        "mediaManifestSha256", "note", "createdAt", "isSigned", "signerUid",
        "signerUsername", "signature",
    ]));
    if (metadata.format !== FORMAT_NAME || metadata.formatVersion !== FORMAT_VERSION) {
        throw new Error("Only PlanetCreations package format version 2 is accepted.");
    }
    if (metadata.packageType !== expectedPackageType) {
        throw new Error(`Expected a ${expectedPackageType} package.`);
    }
    if (!UUID_PATTERN.test(metadata.packageId || "") || !UUID_PATTERN.test(metadata.mediaSetId || "")) {
        throw new Error("Package and media-set identifiers are invalid.");
    }
    if (!isSafeBaseName(metadata.originalFileName)) {
        throw new Error("The original game-file name is invalid.");
    }
    const extension = path.extname(metadata.originalFileName).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
        throw new Error(`The payload is not an allowed game file (${allowedExtensions.join(", ")}).`);
    }
    if (metadata.payloadPath !== `payload/${metadata.originalFileName}`) {
        throw new Error("The signed payload path does not match the game-file name.");
    }
    if (!Number.isSafeInteger(metadata.payloadSize) || metadata.payloadSize <= 0 ||
        metadata.payloadSize > MAX_BACKUP_SIZE_BYTES) {
        throw new Error("The signed payload size is invalid.");
    }
    if (!SHA256_PATTERN.test(metadata.payloadSha256 || "") ||
        !SHA256_PATTERN.test(metadata.mediaManifestSha256 || "")) {
        throw new Error("A signed SHA-256 checksum is missing or invalid.");
    }
    if (typeof metadata.gameId !== "string" || metadata.gameId.length < 1 || metadata.gameId.length > 80) {
        throw new Error("The game identifier is invalid.");
    }
    if (typeof metadata.fileKind !== "string" || !["park", "blueprint", "autosave"].includes(metadata.fileKind)) {
        throw new Error("The game-file kind is invalid.");
    }
    if (typeof metadata.createdAt !== "string" || !Number.isFinite(Date.parse(metadata.createdAt))) {
        throw new Error("The package creation date is invalid.");
    }
    if (typeof metadata.note !== "string" || metadata.note.length > 1000) {
        throw new Error("The package note is invalid.");
    }
}

function validateUnsignedMediaMetadata(metadata, allowedExtensions) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("metadata.json must contain an object.");
    }
    rejectUnexpectedKeys(metadata, new Set([
        "format", "formatVersion", "packageType", "packageId", "mediaSetId", "gameId",
        "originalFileName", "mediaManifestSha256", "assetCount", "assetsTotalSize", "note",
        "createdAt", "isSigned", "signerUid", "signerUsername", "signature",
    ]));
    if (metadata.format !== FORMAT_NAME || metadata.formatVersion !== FORMAT_VERSION ||
        metadata.packageType !== "media") {
        throw new Error("Only PlanetCreations media package format version 2 is accepted.");
    }
    if (!UUID_PATTERN.test(metadata.packageId || "") || !UUID_PATTERN.test(metadata.mediaSetId || "")) {
        throw new Error("Package and media-set identifiers are invalid.");
    }
    if (!isSafeBaseName(metadata.originalFileName) ||
        !allowedExtensions.includes(path.extname(metadata.originalFileName).toLowerCase())) {
        throw new Error("The linked game-file name is invalid.");
    }
    if (!SHA256_PATTERN.test(metadata.mediaManifestSha256 || "") ||
        !Number.isSafeInteger(metadata.assetCount) || metadata.assetCount < 1 || metadata.assetCount > 5000 ||
        !Number.isSafeInteger(metadata.assetsTotalSize) || metadata.assetsTotalSize < 1 ||
        metadata.assetsTotalSize > MAX_MEDIA_TOTAL_SIZE_BYTES) {
        throw new Error("The media package integrity metadata is invalid.");
    }
    if (typeof metadata.gameId !== "string" || metadata.gameId.length < 1 || metadata.gameId.length > 80 ||
        typeof metadata.createdAt !== "string" || !Number.isFinite(Date.parse(metadata.createdAt))) {
        throw new Error("The media package identity is invalid.");
    }
    if (typeof metadata.note !== "string" || metadata.note.length > 1000) {
        throw new Error("The media package note is invalid.");
    }
}

function buildSignedMetadata(unsignedMetadata, signerUid, signerUsername, signingKey, keyId) {
    const metadata = {
        ...unsignedMetadata,
        isSigned: true,
        signerUid,
        signerUsername,
        signature: {
            algorithm: "RSA-SHA256",
            keyId,
            value: "",
        },
    };
    const signableMetadata = { ...metadata };
    delete signableMetadata.signature;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(canonicalStringify(signableMetadata));
    signer.end();
    metadata.signature.value = signer.sign(signingKey, "hex");
    return metadata;
}

function verifyMetadataSignature(metadata, publicKey) {
    if (metadata.isSigned !== true || !metadata.signature ||
        metadata.signature.algorithm !== "RSA-SHA256" ||
        typeof metadata.signature.keyId !== "string" || metadata.signature.keyId.length > 100 ||
        typeof metadata.signature.value !== "string" || !/^[a-f0-9]+$/.test(metadata.signature.value) ||
        typeof metadata.signerUid !== "string" || metadata.signerUid.length < 1 ||
        typeof metadata.signerUsername !== "string" || metadata.signerUsername.length > 200) {
        return false;
    }
    const signableMetadata = { ...metadata };
    delete signableMetadata.signature;
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(canonicalStringify(signableMetadata));
    verifier.end();
    return verifier.verify(publicKey, metadata.signature.value, "hex");
}

function parseSmallJsonEntry(entry, label, maximumSize) {
    if (!entry || entry.isDirectory) throw new Error(`${label} is missing.`);
    if (entry.header.size > maximumSize) throw new Error(`${label} is too large.`);
    try {
        return { value: JSON.parse(entry.getData().toString("utf8")), buffer: entry.getData() };
    } catch (error) {
        throw new Error(`${label} is not valid JSON.`);
    }
}

function validateMediaManifest(manifest, metadata) {
    if (!manifest || manifest.format !== MEDIA_MANIFEST_FORMAT || manifest.formatVersion !== FORMAT_VERSION) {
        throw new Error("media_manifest.json has an unsupported format.");
    }
    if (manifest.mediaSetId !== metadata.mediaSetId || !Array.isArray(manifest.assets)) {
        throw new Error("The media manifest is not bound to this package.");
    }
    if (manifest.assets.length > 5000) throw new Error("The media manifest contains too many assets.");
    const names = new Set();
    for (const asset of manifest.assets) {
        if (!asset || !isSafeBaseName(asset.logicalName) || names.has(asset.logicalName.toLowerCase())) {
            throw new Error("The media manifest contains an invalid or duplicate target name.");
        }
        if (!SHA256_PATTERN.test(asset.sha256 || "") || !Number.isSafeInteger(asset.size) || asset.size < 0) {
            throw new Error("The media manifest contains invalid asset integrity data.");
        }
        const extension = path.extname(asset.logicalName).toLowerCase();
        const expectedTarget = AUDIO_EXTENSIONS.has(extension) ? "UserAudio" :
            (USER_MEDIA_EXTENSIONS.has(extension) ? "UserMedia" : null);
        if (!expectedTarget || asset.target !== expectedTarget) {
            throw new Error("The media manifest contains an invalid target folder.");
        }
        names.add(asset.logicalName.toLowerCase());
    }
}

function validateCreationArchive(fileBuffer, publicKey, allowedExtensions) {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length <= 0 || fileBuffer.length > MAX_BACKUP_SIZE_BYTES) {
        throw new Error("The backup file has an invalid size.");
    }
    let zip;
    try {
        zip = new AdmZip(fileBuffer);
    } catch (error) {
        throw new Error("The backup is not a valid ZIP archive.");
    }

    const entries = zip.getEntries();
    if (entries.some((entry) => entry.isDirectory) || entries.length !== 3) {
        throw new Error("A creation package must contain exactly three files.");
    }
    const entryNames = entries.map((entry) => entry.entryName);
    if (entryNames.some((name) => name.includes("\\") || name.startsWith("/") || name.split("/").includes(".."))) {
        throw new Error("The package contains an unsafe ZIP path.");
    }

    const { value: metadata } = parseSmallJsonEntry(
        zip.getEntry("metadata.json"), "metadata.json", MAX_METADATA_SIZE_BYTES,
    );
    validateUnsignedMetadata(metadata, allowedExtensions, "creation");
    const payloadEntry = zip.getEntry(metadata.payloadPath);
    const manifestResult = parseSmallJsonEntry(
        zip.getEntry("media_manifest.json"), "media_manifest.json", MAX_MANIFEST_SIZE_BYTES,
    );
    const allowedNames = new Set(["metadata.json", "media_manifest.json", metadata.payloadPath]);
    if (!payloadEntry || entryNames.some((name) => !allowedNames.has(name))) {
        throw new Error("The package contains an unexpected file.");
    }
    if (payloadEntry.header.size !== metadata.payloadSize) {
        throw new Error("The game-file size does not match its signed metadata.");
    }
    const payloadBuffer = payloadEntry.getData();
    if (payloadBuffer.length !== metadata.payloadSize || sha256(payloadBuffer) !== metadata.payloadSha256) {
        throw new Error("The game file failed its SHA-256 integrity check.");
    }
    if (sha256(manifestResult.buffer) !== metadata.mediaManifestSha256) {
        throw new Error("The media manifest failed its SHA-256 integrity check.");
    }
    validateMediaManifest(manifestResult.value, metadata);
    if (!publicKey || !verifyMetadataSignature(metadata, publicKey)) {
        throw new Error("The package signature is invalid.");
    }
    return { metadata, mediaManifest: manifestResult.value };
}

module.exports = {
    FORMAT_NAME,
    FORMAT_VERSION,
    MEDIA_MANIFEST_FORMAT,
    MAX_BACKUP_SIZE_BYTES,
    canonicalStringify,
    sha256,
    validateUnsignedMetadata,
    validateUnsignedMediaMetadata,
    buildSignedMetadata,
    verifyMetadataSignature,
    validateMediaManifest,
    validateCreationArchive,
};
