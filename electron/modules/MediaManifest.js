const path = require('node:path');
const MEDIA_MANIFEST_FORMAT = 'PlanetCreationsMediaManifest';
const MEDIA_MANIFEST_VERSION = 2;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg']);
const USER_MEDIA_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.mp4', '.webm', '.mov',
]);
const ALLOWED_MEDIA_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...USER_MEDIA_EXTENSIONS]);

function safeLogicalName(fileName) {
    return typeof fileName === 'string' && fileName.length > 0 && fileName.length <= 255 &&
        fileName === path.basename(fileName) && !fileName.includes('/') && !fileName.includes('\\') &&
        fileName !== '.' && fileName !== '..';
}

function getTargetForFile(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (AUDIO_EXTENSIONS.has(extension)) return 'UserAudio';
    if (USER_MEDIA_EXTENSIONS.has(extension)) return 'UserMedia';
    throw new Error(`Unsupported custom-media type: ${extension || '(none)'}`);
}

function validatePortableManifest(manifest) {
    if (!manifest || manifest.format !== MEDIA_MANIFEST_FORMAT ||
        manifest.formatVersion !== MEDIA_MANIFEST_VERSION ||
        typeof manifest.mediaSetId !== 'string' || !Array.isArray(manifest.assets)) {
        throw new Error('Unsupported media manifest.');
    }
    const names = new Set();
    for (const asset of manifest.assets) {
        const lowerName = String(asset?.logicalName || '').toLowerCase();
        if (!safeLogicalName(asset?.logicalName) || names.has(lowerName) ||
            !/^[a-f0-9]{64}$/.test(asset?.sha256 || '') ||
            !Number.isSafeInteger(asset?.size) || asset.size < 0 ||
            asset.target !== getTargetForFile(asset.logicalName)) {
            throw new Error('The media manifest contains invalid or duplicate assets.');
        }
        names.add(lowerName);
    }
    return manifest;
}

module.exports = {MEDIA_MANIFEST_FORMAT, MEDIA_MANIFEST_VERSION, AUDIO_EXTENSIONS, USER_MEDIA_EXTENSIONS, ALLOWED_MEDIA_EXTENSIONS, safeLogicalName, getTargetForFile, validatePortableManifest};
