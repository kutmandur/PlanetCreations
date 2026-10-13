const path = require('node:path');
const extensions = {
    'planet-coaster-2': ['.park2', '.blpr2', '.prkauto2'],
    'planet-zoo': ['.zoo', '.pzblueprint', '.zooauto', '.zoo_auto'],
    'planet-zoo-2': ['.zoo', '.zblpr'],
};
function gameForFile(filePath, expectedGame) {
    const extension = path.extname(filePath || '').toLowerCase();
    if (expectedGame) return extensions[expectedGame]?.includes(extension) ? expectedGame : null;
    const segments = String(filePath || '').toLowerCase().split(/[\\/]/);
    if (segments.includes('planet zoo 2')) return extensions['planet-zoo-2'].includes(extension) ? 'planet-zoo-2' : null;
    return Object.keys(extensions).find(game => extensions[game].includes(extension)) || null;
}
module.exports = { gameForFile, extensions };
