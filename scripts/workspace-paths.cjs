const fs = require('node:fs');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.dirname(projectRoot);
// A normal clone/CI checkout retains its established repository-local paths.
const organizedWorkspace = !process.env.CI && path.basename(projectRoot) === 'planet-creation-net-project'
    && ['build-artefakte', 'release-belege', 'lokale-werkzeuge'].every(name => fs.existsSync(path.join(workspaceRoot, name)));
const paths = {
    projectRoot,
    organizedWorkspace,
    web: organizedWorkspace ? path.join(workspaceRoot, 'build-artefakte', 'web') : path.join(projectRoot, 'build'),
    electron: organizedWorkspace ? path.join(workspaceRoot, 'build-artefakte', 'electron') : path.join(projectRoot, 'build'),
    dist: organizedWorkspace ? path.join(workspaceRoot, 'build-artefakte', 'dist') : path.join(projectRoot, 'dist'),
    evidence: organizedWorkspace ? path.join(workspaceRoot, 'release-belege', '.security-build') : path.join(projectRoot, '.security-build'),
    runtimes: organizedWorkspace ? path.join(workspaceRoot, 'lokale-werkzeuge', '.local-runtimes') : path.join(projectRoot, '.local-runtimes'),
};
module.exports = paths;
if (require.main === module) {
    const value = paths[process.argv[2]];
    if (typeof value !== 'string') throw new Error('Unknown workspace path');
    process.stdout.write(value);
}
