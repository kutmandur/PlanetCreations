const fs = require('node:fs');
const path = require('node:path');
function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function resolveZooSavePath(filePath, libraryRoot) {
    if (typeof filePath !== 'string' || !filePath || filePath.length > 4096 || filePath.includes('\0') || typeof libraryRoot !== 'string' || !libraryRoot) throw new Error('Invalid zoo save path.');
    const resolved = path.resolve(filePath), root = path.resolve(libraryRoot);
    if (!isInside(root, resolved) || !/\.(zoo|zooauto|zoo_auto)$/i.test(resolved)) throw new Error('Zoo save path is outside the configured library or unsupported.');
    // Junctions/symlinks may be useful for the selected library, but a child link
    // must not grant the hosted renderer access to another location.
    const actualRoot = fs.realpathSync(root), actualFile = fs.realpathSync(resolved);
    if (!isInside(actualRoot, actualFile) || !fs.statSync(actualFile).isFile()) throw new Error('Zoo save path resolves outside the configured library or is not a file.');
    return actualFile;
}
function assertLibraryTarget(filePath, libraryRoot) {
    const root = path.resolve(libraryRoot), target = path.resolve(filePath);
    if (!isInside(root, target)) throw new Error('Install target is outside the configured library.');
    const actualRoot = fs.realpathSync(root);
    // A new target may not exist yet. Resolve its nearest existing ancestor
    // before creating any directories or reading an existing game file.
    let existing = target;
    while (!fs.existsSync(existing)) {
        if (fs.lstatSync(existing, {throwIfNoEntry: false})?.isSymbolicLink()) throw new Error('Install target is a broken symbolic link.');
        const parent = path.dirname(existing);
        if (parent === existing) throw new Error('Install target has no existing parent.');
        existing = parent;
    }
    const actual = fs.realpathSync(existing);
    if (actual !== actualRoot && !isInside(actualRoot, actual)) throw new Error('Install target resolves outside the configured library.');
    return target;
}
module.exports = {resolveZooSavePath, assertLibraryTarget};
