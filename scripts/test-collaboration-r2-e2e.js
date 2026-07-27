const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const AdmZip = require('adm-zip');
const admin = require('../functions/node_modules/firebase-admin');

const sourceFixture = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(sourceFixture)) {
    throw new Error('Pass an existing copied Planet Coaster save fixture.');
}
if (path.extname(sourceFixture).toLowerCase() !== '.park2') {
    throw new Error('The signed collaboration E2E currently expects a .park2 fixture.');
}

const projectId = process.env.GCLOUD_PROJECT || 'planetcreationsdotnet';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const functionsOrigin =
    process.env.FUNCTIONS_EMULATOR_ORIGIN ||
    `http://127.0.0.1:5001/${projectId}/us-central1`;
const apiOrigin = `${functionsOrigin}/api`;
if (admin.apps.length === 0) admin.initializeApp({ projectId });
const firestore = admin.firestore();
const runDirectory = path.join(
    path.dirname(sourceFixture),
    'r2-e2e',
    crypto.randomUUID(),
);
const appPaths = {
    documents: path.join(runDirectory, 'documents'),
    userData: path.join(runDirectory, 'user-data'),
    temp: path.join(runDirectory, 'temp'),
    downloads: path.join(runDirectory, 'downloads'),
    home: path.join(runDirectory, 'home'),
};
Object.values(appPaths).forEach((directoryPath) =>
    fs.mkdirSync(directoryPath, { recursive: true }));

const fakeApp = {
    getPath(name) {
        if (!appPaths[name]) throw new Error(`Unexpected Electron app path: ${name}`);
        return appPaths[name];
    },
};

const originalModuleLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') return { app: fakeApp };
    return originalModuleLoad.call(this, request, parent, isMain);
};
const { createBackup } = require('../electron/modules/BackupManager');
Module._load = originalModuleLoad;

const {
    validateCreationArchive,
} = require('../functions/backupFormat');

async function signIn(email, password) {
    const response = await fetch(
        `http://${authHost}/identitytoolkit.googleapis.com/v1/` +
        'accounts:signInWithPassword?key=local-e2e',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true,
            }),
        },
    );
    const result = await response.json();
    if (!response.ok || !result.idToken) {
        throw new Error(`Emulator sign-in failed (${response.status}).`);
    }
    return result.idToken;
}

async function callFunction(name, idToken, data) {
    const response = await fetch(`${functionsOrigin}/${name}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${idToken}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ data }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
        const error = new Error(
            payload.error?.message ||
            `Callable ${name} failed (${response.status}).`,
        );
        error.code = payload.error?.status || `HTTP_${response.status}`;
        throw error;
    }
    return payload.result;
}

async function createSignedPackage(ownerToken) {
    const unsignedPackagePath = await createBackup(
        fakeApp,
        sourceFixture,
        'Signed Collaboration R2 E2E',
        false,
        null,
        path.join(runDirectory, 'packages'),
    );
    const archive = new AdmZip(unsignedPackagePath);
    const metadataEntry = archive.getEntry('metadata.json');
    assert.ok(metadataEntry);
    const unsignedMetadata = JSON.parse(
        metadataEntry.getData().toString('utf8'),
    );

    const signResponse = await fetch(`${apiOrigin}/signBackup`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${ownerToken}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ metadata: unsignedMetadata }),
    });
    const signResult = await signResponse.json().catch(() => ({}));
    if (!signResponse.ok || !signResult.metadata) {
        throw new Error(
            signResult.error ||
            `Package signing failed (${signResponse.status}).`,
        );
    }
    assert.equal(signResult.metadata.isSigned, true);
    assert.equal(signResult.metadata.signerUid, 'e2e-owner');

    archive.deleteFile('metadata.json');
    archive.addFile(
        'metadata.json',
        Buffer.from(JSON.stringify(signResult.metadata, null, 2)),
    );
    const signedPackagePath = path.join(
        runDirectory,
        'Signed-Collaboration-E2E.PlanetCreations',
    );
    archive.writeZip(signedPackagePath);

    const publicKeyResponse = await fetch(`${apiOrigin}/getPublicKey`);
    if (!publicKeyResponse.ok) {
        throw new Error(`Public signing key request failed (${publicKeyResponse.status}).`);
    }
    const publicKey = await publicKeyResponse.text();
    const packageBuffer = fs.readFileSync(signedPackagePath);
    const validation = validateCreationArchive(
        packageBuffer,
        publicKey,
        ['.park2', '.blpr2', '.prkauto2'],
    );
    assert.equal(validation.metadata.signerUid, 'e2e-owner');
    assert.equal(validation.metadata.gameId, 'planet-coaster-2');

    return {
        signedPackagePath,
        packageBuffer,
        metadata: validation.metadata,
        publicKey,
    };
}

async function firestoreDocumentExists(documentPath) {
    return (await firestore.doc(documentPath).get()).exists;
}

async function waitForSignedUrlToDisappear(downloadUrl) {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await fetch(downloadUrl, {
            headers: { range: 'bytes=0-0' },
        });
        lastStatus = response.status;
        if (!response.ok) return lastStatus;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
        `Deleted R2 object remained downloadable (last status ${lastStatus}).`,
    );
}

async function run() {
    const ownerToken = await signIn(
        'owner@example.test',
        'Owner-E2E-2026!',
    );
    const visitorToken = await signIn(
        'visitor@example.test',
        'Visitor-E2E-2026!',
    );
    const signed = await createSignedPackage(ownerToken);
    let uploadId = null;
    let collaborationId = null;
    let collaborationDeleted = false;
    let downloadUrl = null;

    try {
        const upload = await callFunction('getUploadUrl', ownerToken, {
            fileName: path.basename(signed.signedPackagePath),
            fileSize: signed.packageBuffer.length,
            ownershipConfirmed: true,
            hostingAccepted: true,
        });
        uploadId = upload.uploadId;
        const uploadResponse = await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': upload.contentType },
            body: signed.packageBuffer,
        });
        if (!uploadResponse.ok) {
            throw new Error(`R2 upload failed (${uploadResponse.status}).`);
        }

        const created = await callFunction(
            'createCollaboration',
            ownerToken,
            {
                title: `R2 Cleanup E2E ${Date.now()}`,
                description: 'Temporary signed upload/download cleanup test.',
                game: 'planet-coaster-2',
                visibility: 'unlisted',
                joinMode: 'invite',
                initialUploadId: uploadId,
                initialNote: 'Signed R2 round-trip fixture',
                bannerImageUrl: '',
                galleryImageUrls: [],
            },
        );
        collaborationId = created.collaborationId;
        assert.ok(collaborationId);
        assert.ok(created.versionId);

        const download = await callFunction(
            'getCollaborationVersionDownloadUrl',
            ownerToken,
            {
                collaborationId,
                versionId: created.versionId,
            },
        );
        downloadUrl = download.downloadUrl;
        const downloadedResponse = await fetch(downloadUrl);
        if (!downloadedResponse.ok) {
            throw new Error(`Signed R2 download failed (${downloadedResponse.status}).`);
        }
        const downloadedPackage = Buffer.from(
            await downloadedResponse.arrayBuffer(),
        );
        const downloadedValidation = validateCreationArchive(
            downloadedPackage,
            signed.publicKey,
            ['.park2', '.blpr2', '.prkauto2'],
        );
        assert.equal(downloadedValidation.metadata.isSigned, true);
        assert.equal(
            downloadedValidation.metadata.packageId,
            signed.metadata.packageId,
        );

        const downloadedArchive = new AdmZip(downloadedPackage);
        const payload = downloadedArchive
            .getEntry(downloadedValidation.metadata.payloadPath)
            .getData();
        const sourcePayload = fs.readFileSync(sourceFixture);
        assert.equal(
            crypto.createHash('sha256').update(payload).digest('hex'),
            crypto.createHash('sha256').update(sourcePayload).digest('hex'),
        );

        let visitorDenied = false;
        try {
            await callFunction(
                'getCollaborationVersionDownloadUrl',
                visitorToken,
                {
                    collaborationId,
                    versionId: created.versionId,
                },
            );
        } catch (error) {
            visitorDenied = error.code === 'PERMISSION_DENIED';
        }
        assert.equal(visitorDenied, true);

        const cleanup = await callFunction(
            'deleteCollaboration',
            ownerToken,
            { collaborationId },
        );
        collaborationDeleted = true;
        assert.equal(cleanup.success, true);
        assert.equal(cleanup.deletedR2ObjectCount >= 1, true);
        assert.equal(
            await firestoreDocumentExists(
                `collaborations/${collaborationId}`,
            ),
            false,
        );
        assert.equal(
            await firestoreDocumentExists(
                `backupUploadSessions/${uploadId}`,
            ),
            false,
        );
        const deletedDownloadStatus =
            await waitForSignedUrlToDisappear(downloadUrl);

        process.stdout.write(`${JSON.stringify({
            success: true,
            sourceFile: path.basename(sourceFixture),
            sourceBytes: sourcePayload.length,
            signedPackageBytes: signed.packageBuffer.length,
            signerUid: signed.metadata.signerUid,
            collaborationId,
            versionId: created.versionId,
            versionNumber: created.versionNumber,
            memberDownloadSucceeded: true,
            nonMemberDownloadDenied: true,
            payloadSha256Matches: true,
            deletedR2ObjectCount: cleanup.deletedR2ObjectCount,
            deletedUploadSessionCount: cleanup.deletedUploadSessionCount,
            deletedDownloadStatus,
            firestoreCollaborationDeleted: true,
            uploadSessionDeleted: true,
            localArtifacts: runDirectory,
        }, null, 2)}\n`);
    } finally {
        if (collaborationId && !collaborationDeleted) {
            await callFunction(
                'deleteCollaboration',
                ownerToken,
                { collaborationId },
            );
        } else if (uploadId && !collaborationId) {
            await callFunction(
                'abortBackupUpload',
                ownerToken,
                { uploadId },
            ).catch(() => null);
        }
    }
}

run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
