// Run the packaged Electron runtime without launching the app or touching user data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
async function main() {
    const root = path.resolve(__dirname, '..');
    const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
    const packageDirectory = path.resolve(root, option('package', '.security-build/package/win-unpacked'));
    const resources = path.join(packageDirectory, 'resources');
    if (process.argv.includes('--child')) {
        const {runBackupJob} = require(path.join(resources, 'app.asar/electron/modules/BackupJobs'));
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-packaged-worker-'));
        const source = path.join(directory, 'test.park2');
        const destination = path.join(directory, 'test.PlanetCreations');
        const zooFile = path.join(directory, 'test.zoo');
        try {
            const bytes = Buffer.from('Packaged worker smoke fixture');
            fs.writeFileSync(source, bytes);
            const hash = await runBackupJob('hash', {path: source});
            assert.equal(hash.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
            await runBackupJob('archive', {sourcePath: source, destination, metadata: {
                payloadPath: 'test.park2', payloadSize: hash.size, payloadSha256: hash.sha256,
            }, manifest: '{}'});
            const metadata = await runBackupJob('metadata', {path: destination});
            assert.equal(metadata.payloadSha256, hash.sha256);
            console.log(JSON.stringify({packagedWorker: 'passed', operations: ['hash', 'archive', 'metadata']}));
            const {loadPlanetZooAnalysis} = require(path.join(resources, 'app.asar/electron/modules/PlanetZooAnalysisService'));
            const {zooArchive} = require('../tests/helpers/planet-zoo-fixture.cjs');
            const zooBytes = zooArchive(); fs.writeFileSync(zooFile, zooBytes);
            const zoo = await loadPlanetZooAnalysis(zooFile);
            assert.equal(zoo.schemaVersion, 1);
            assert.deepEqual(zoo.animals, []);
            assert.deepEqual(fs.readFileSync(zooFile), zooBytes);
            console.log(JSON.stringify({packagedZooWorker: 'passed', sourceUnchanged: true}));
        } finally {
            for (const file of [source, destination, zooFile]) if (fs.existsSync(file)) fs.unlinkSync(file);
            fs.rmdirSync(directory);
        }
        return;
    }
    const web = fs.readFileSync(path.resolve(root, option('web', '.security-build/web'), 'index.html'), 'utf8');
    const desktop = fs.readFileSync(path.resolve(root, option('electron', '.security-build/electron'), 'index.html'), 'utf8');
    assert.match(web, /src="\/assets\//);
    assert.match(desktop, /src="\.\/assets\//);
    const asar = require('@electron/asar');
    const archive = path.join(resources, 'app.asar');
    assert.equal(asar.extractFile(archive, 'build/index.html').toString(), desktop);
    const packedPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString());
    assert.ok(packedPackage.main);
    assert.equal(packedPackage.version, require('../package.json').version);
    console.log(JSON.stringify({webBase: '/', electronBase: './', packagedHtml: 'matches'}));
    const executable = path.join(resources, '../PlanetCreations Client.exe');
    process.stdout.write(execFileSync(executable, [__filename, '--child', `--package=${packageDirectory}`], {
        env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, windowsHide: true, timeout: 60000,
    }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
