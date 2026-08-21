const assert = require("node:assert/strict");
const crypto = require("crypto");
const test = require("node:test");
const AdmZip = require("adm-zip");
const {
  FORMAT_NAME,
  FORMAT_VERSION,
  MEDIA_MANIFEST_FORMAT,
  buildSignedMetadata,
  sha256,
  validateCreationArchive,
} = require("./backupFormat");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function makePackage({ tamperPayload = false, addUnexpectedEntry = false } = {}) {
  const packageId = crypto.randomUUID();
  const mediaSetId = crypto.randomUUID();
  const payload = Buffer.from("planet-coaster-save-data");
  const manifest = Buffer.from(JSON.stringify({
    format: MEDIA_MANIFEST_FORMAT,
    formatVersion: FORMAT_VERSION,
    mediaSetId,
    assets: [],
  }, null, 2));
  const unsignedMetadata = {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    packageType: "creation",
    packageId,
    mediaSetId,
    gameId: "planet-coaster-2",
    fileKind: "park",
    originalFileName: "test.park2",
    payloadPath: "payload/test.park2",
    payloadSize: payload.length,
    payloadSha256: sha256(payload),
    mediaManifestSha256: sha256(manifest),
    note: "test",
    createdAt: new Date().toISOString(),
    isSigned: false,
  };
  const metadata = buildSignedMetadata(
    unsignedMetadata,
    "user-1",
    "Test User",
    privateKey,
    "test-key",
  );
  const zip = new AdmZip();
  zip.addFile("payload/test.park2", tamperPayload ? Buffer.from("tampered-save-data-xxxxx") : payload);
  zip.addFile("media_manifest.json", manifest);
  zip.addFile("metadata.json", Buffer.from(JSON.stringify(metadata, null, 2)));
  if (addUnexpectedEntry) zip.addFile("unexpected.exe", Buffer.from("no"));
  return zip.toBuffer();
}

test("accepts a signed creation package with a fixed empty media manifest", () => {
  const result = validateCreationArchive(makePackage(), publicKey, [".park2"]);
  assert.equal(result.metadata.packageType, "creation");
  assert.deepEqual(result.mediaManifest.assets, []);
  assert.equal(result.payloadBuffer.toString("utf8"), "planet-coaster-save-data");
});

test("rejects a payload whose bytes do not match the signed SHA-256", () => {
  assert.throws(
    () => validateCreationArchive(makePackage({ tamperPayload: true }), publicKey, [".park2"]),
    /integrity check/,
  );
});

test("rejects unexpected archive entries", () => {
  assert.throws(
    () => validateCreationArchive(makePackage({ addUnexpectedEntry: true }), publicKey, [".park2"]),
    /exactly three files/,
  );
});
