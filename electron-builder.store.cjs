'use strict';

const fs = require('fs');
const path = require('path');
const baseBuild = require('./package.json').build;

const storeValue = (name, fallback) => {
    const value = String(process.env[name] || fallback).trim();
    if (!value) throw new Error(`${name} must not be empty.`);
    return value;
};

const identityName = storeValue('STORE_IDENTITY_NAME', 'DonReichau.PlanetCreationsClient');
const publisher = storeValue('STORE_PUBLISHER', 'CN=8EA44CF3-DC41-47A9-8F85-4E91ECB404D5');
const publisherDisplayName = storeValue('STORE_PUBLISHER_DISPLAY_NAME', 'Don Reichau');
const installedElectronDist = path.join(__dirname, 'node_modules/electron/dist');
const electronExecutable = path.join(installedElectronDist, 'electron.exe');
const electronDist = fs.existsSync(electronExecutable) ? installedElectronDist : null;

module.exports = {
    ...baseBuild,
    ...(electronDist ? { electronDist } : {}),
    publish: null,
    directories: {
        ...baseBuild.directories,
        output: 'dist/store',
    },
    protocols: baseBuild.protocols,
    win: {
        ...baseBuild.win,
        target: [{ target: 'appx', arch: ['x64'] }],
        artifactName: '${productName}-${version}-${arch}-Store.${ext}',
    },
    appx: {
        identityName,
        publisher,
        publisherDisplayName,
        applicationId: 'PlanetCreationsClient',
        displayName: 'PlanetCreations Client',
        backgroundColor: '#111827',
        languages: ['en-US'],
        capabilities: ['runFullTrust'],
        minVersion: '10.0.19041.0',
        maxVersionTested: '10.0.26100.0',
        addAutoLaunchExtension: false,
        customExtensionsPath: 'assets/appx-extensions.xml',
        electronUpdaterAware: false,
        showNameOnTiles: true,
    },
};
