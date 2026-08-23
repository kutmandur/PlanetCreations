'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const asar = require('@electron/asar');
const storeConfig = require('../electron-builder.store.cjs');

const projectRoot = path.resolve(__dirname, '..');
const storeDirectory = path.join(projectRoot, 'dist', 'store');
const appxFiles = fs.readdirSync(storeDirectory).filter((name) => name.endsWith('.appx'));
if (appxFiles.length !== 1) {
    throw new Error(`Expected one AppX in dist/store, found ${appxFiles.length}.`);
}

const packagePath = path.join(storeDirectory, appxFiles[0]);
const archive = new AdmZip(packagePath);
const manifestEntry = archive.getEntry('AppxManifest.xml');
if (!manifestEntry) throw new Error('AppxManifest.xml is missing from the Store package.');
const manifest = manifestEntry.getData().toString('utf8');

const requiredManifestValues = [
    `Name="${storeConfig.appx.identityName}"`,
    `Publisher='${storeConfig.appx.publisher}'`,
    `<PublisherDisplayName>${storeConfig.appx.publisherDisplayName}</PublisherDisplayName>`,
    '<uap:Protocol Name="planetcreations">',
    '<uap:FileTypeAssociation Name="planetcreations">',
    '<desktop:StartupTask TaskId="PlanetCreationsStartup" Enabled="false"',
    '<rescap:Capability Name="runFullTrust"/>',
];
for (const value of requiredManifestValues) {
    if (!manifest.includes(value)) throw new Error(`Store manifest is missing: ${value}`);
}

const requiredPackageEntries = [
    'assets/StoreLogo.png',
    'assets/Square44x44Logo.png',
    'assets/Square150x150Logo.png',
    'assets/Wide310x150Logo.png',
    'app/resources/app.asar',
];
for (const entry of requiredPackageEntries) {
    if (!archive.getEntry(entry)) throw new Error(`Store package is missing: ${entry}`);
}

const asarEntry = archive.getEntry('app/resources/app.asar');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'planetcreations-store-verify-'));
const asarPath = path.join(temporaryDirectory, 'app.asar');
try {
    fs.writeFileSync(asarPath, asarEntry.getData());
    const packedFiles = new Set(asar.listPackage(asarPath).map((entry) => entry.replaceAll('\\', '/')));
    for (const entry of [
        '/electron/main.js',
        '/electron/preload.js',
        '/build/privacy.html',
        '/build/community-guidelines.html',
    ]) {
        if (!packedFiles.has(entry)) throw new Error(`app.asar is missing: ${entry}`);
    }

    const mainSource = asar.extractFile(asarPath, 'electron/main.js').toString('utf8');
    const preloadSource = asar.extractFile(asarPath, 'electron/preload.js').toString('utf8');
    const privacyPage = asar.extractFile(asarPath, 'build/privacy.html').toString('utf8');
    if (!/function loadOfflineManager[\s\S]*?return loadHostedAppWithFallback/.test(mainSource) ||
        !mainSource.includes('const fallbackUrl = `${getBundledAppUrl()}#${hashRoute}`;')) {
        throw new Error('The packed client is missing the hosted Offline Manager with bundled fallback.');
    }
    if (!preloadSource.includes('isTrustedHostedView ? hostedApi')) {
        throw new Error('The packed preload does not separate hosted and bundled capabilities.');
    }
    if (/require\(['"]\.\.?[\\/]/.test(preloadSource)) {
        throw new Error('The packed sandboxed preload contains an unsupported local require.');
    }
    if (!preloadSource.includes('hostedOfflineManagerVersion: HOSTED_OFFLINE_MANAGER_VERSION') ||
        !preloadSource.includes('...offlineManagerApi')) {
        throw new Error('The packed preload is missing the versioned hosted Offline Manager bridge.');
    }
    if (!mainSource.includes('requireOfflineManagerCapability: true')) {
        throw new Error('The packed Store client does not enforce hosted Offline Manager compatibility checks.');
    }
    if (!preloadSource.includes('uploadPreparedBackup') || preloadSource.includes('uploadBackupFile:')) {
        throw new Error('The packed hosted bridge does not enforce opaque prepared-upload handles.');
    }
    if (!mainSource.includes("callPlanetCreationsCallable('getUploadUrl'") ||
        !mainSource.includes("ipcMain.handle('upload-prepared-backup'")) {
        throw new Error('The packed client does not bind local uploads to the PlanetCreations backend.');
    }
    if (!privacyPage.includes('info@planetcreations.net')) {
        throw new Error('The packed public privacy page is missing its contact address.');
    }
    if (!privacyPage.includes('at least 16 years old')) {
        throw new Error('The packed public privacy page is missing the minimum-age rule.');
    }
    if (!privacyPage.includes('native upload confirmation') || !privacyPage.includes('limited desktop bridge')) {
        throw new Error('The packed public privacy page does not disclose hosted desktop file access.');
    }
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Verified Store package: ${path.basename(packagePath)} (${fs.statSync(packagePath).size} bytes)`);
