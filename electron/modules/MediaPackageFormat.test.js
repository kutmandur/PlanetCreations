const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { canonicalStringify, inspectMediaPackageFile, sha256 } = require('./BackupFormat');
const { writeMediaPackage, readMediaPackageHeader, hasMediaPackageMagic, mediaPackageFileName } = require('./MediaPackageFormat');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-media-package-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('poster')]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.from('theme-audio')]);

function preparePackage(name, { signWith = null } = {}) {
    const files = [['poster.png', PNG], ['theme.ogg', OGG]].map(([logicalName, bytes]) => {
        const filePath = path.join(root, `${name}-${logicalName}`);
        fs.writeFileSync(filePath, bytes);
        return { logicalName, filePath, bytes };
    });
    const mediaSetId = crypto.randomUUID();
    const manifestText = JSON.stringify({
        format: 'PlanetCreationsMediaManifest',
        formatVersion: 2,
        mediaSetId,
        assets: files.map(({ logicalName, bytes }) => ({
            logicalName, sha256: sha256(bytes), size: bytes.length,
            target: logicalName.endsWith('.ogg') ? 'UserAudio' : 'UserMedia',
        })),
    });
    let metadata = {
        format: 'PlanetCreationsBackup', formatVersion: 2, packageType: 'media',
        packageId: crypto.randomUUID(), mediaSetId, gameId: 'planet-coaster-2',
        originalFileName: 'Park.park2', mediaManifestSha256: sha256(Buffer.from(manifestText)),
        assetCount: files.length, assetsTotalSize: files.reduce((sum, file) => sum + file.bytes.length, 0),
        note: '', createdAt: new Date().toISOString(), isSigned: false,
    };
    if (signWith) {
        metadata = { ...metadata, isSigned: true, signerUid: 'uid', signerUsername: 'tester' };
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(canonicalStringify(metadata));
        metadata.signature = { algorithm: 'RSA-SHA256', keyId: 'test', value: signer.sign(signWith, 'hex') };
    }
    const assets = files.map(({ filePath, bytes }) => ({ path: filePath, size: bytes.length, sha256: sha256(bytes) }));
    return { destination: path.join(root, `${name}.PlanetCreationsMedia`), metadata, manifestText, assets };
}

test('writes a streamed media package that inspects with exact asset offsets', async () => {
    const prepared = preparePackage('roundtrip');
    await writeMediaPackage(prepared);

    assert.equal(hasMediaPackageMagic(prepared.destination), true);
    const inspection = inspectMediaPackageFile(prepared.destination, ['.park2']);
    assert.equal(inspection.signatureStatus, 'unsigned');
    assert.equal(inspection.container, 'stream');
    const bytes = fs.readFileSync(prepared.destination);
    const [poster, theme] = inspection.assetEntries;
    assert.deepEqual(bytes.subarray(poster.offset, poster.offset + poster.asset.size), PNG);
    assert.deepEqual(bytes.subarray(theme.offset, theme.offset + theme.asset.size), OGG);
});

test('verifies the unchanged metadata signature and rejects altered metadata', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const prepared = preparePackage('signed', { signWith: privateKey });
    await writeMediaPackage(prepared);
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    assert.equal(inspectMediaPackageFile(prepared.destination, ['.park2'], publicPem).signatureStatus, 'verified');

    const altered = preparePackage('altered', { signWith: privateKey });
    altered.metadata = { ...altered.metadata, note: 'changed after signing' };
    await writeMediaPackage(altered);
    assert.equal(inspectMediaPackageFile(altered.destination, ['.park2'], publicPem).signatureStatus, 'invalid');
});

test('rejects truncated packages and manifests that do not match the signed checksum', async () => {
    const prepared = preparePackage('truncated');
    await writeMediaPackage(prepared);
    fs.truncateSync(prepared.destination, fs.statSync(prepared.destination).size - 1);
    assert.throws(() => inspectMediaPackageFile(prepared.destination, ['.park2']), /incomplete/);

    const tampered = preparePackage('manifest');
    tampered.manifestText = tampered.manifestText.replace('poster.png', 'poster.jpg');
    await writeMediaPackage(tampered);
    assert.throws(() => inspectMediaPackageFile(tampered.destination, ['.park2']), /SHA-256/);
});

test('does not leave a package behind when an asset changes while writing', async () => {
    const prepared = preparePackage('changing');
    fs.appendFileSync(prepared.assets[0].path, 'grew');
    await assert.rejects(writeMediaPackage(prepared), /changed/);
    assert.equal(fs.existsSync(prepared.destination), false);
    assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('changing.') && name.endsWith('.tmp')), []);
    assert.throws(() => readMediaPackageHeader(prepared.assets[1].path), /not a PlanetCreations media package/);
});

test('names media packages after the creation so users can tell them apart', () => {
    const createdAt = new Date(2026, 8, 28, 3, 5);
    assert.equal(
        mediaPackageFileName('C:/Saves/Harbor Park-A1B2C3D4.park2', '1a2b3c4d-0000-4000-8000-000000000000', createdAt),
        'Harbor Park - Media 2026-09-28 0305 (1a2b3c4d).PlanetCreationsMedia',
    );
    assert.equal(
        mediaPackageFileName('C:/Saves/Bad:Name?  Park.zoo', 'ffffffff-0000-4000-8000-000000000000', createdAt),
        'Bad_Name_ Park - Media 2026-09-28 0305 (ffffffff).PlanetCreationsMedia',
    );
});
