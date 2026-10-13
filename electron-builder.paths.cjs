const paths = require('./scripts/workspace-paths.cjs');
const base = {
    "files": [
        "build/**/*",
        "electron/**/*",
        "!electron/**/*.test.js",
        "!electron/modules/FrontierSaveWatcher.js"
    ],
    "directories": {
        "buildResources": "assets"
    }
};
module.exports = {
    directories: { ...base.directories, output: paths.dist },
    files: paths.organizedWorkspace
        ? [...base.files.filter(pattern => pattern !== 'build/**/*'), { from: paths.electron, to: 'build', filter: ['**/*'] }]
        : base.files,
};
