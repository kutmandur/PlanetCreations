const fs = require('node:fs');
const path = require('node:path');
const {gameForFile} = require('./GameFileTypes');
const GAMES = {'planet-coaster-2':'Planet Coaster 2','planet-zoo':'Planet Zoo','planet-zoo-2':'Planet Zoo 2'};
function readAnalysisPreferences(userData) {
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(path.join(userData,'save-analysis-settings.json'),'utf8')); } catch {}
    return Object.fromEntries(Object.keys(GAMES).map(id => [id, stored[id] === true]));
}
function setAnalysisPreference(userData, gameId, enabled) {
    if (!Object.hasOwn(GAMES,gameId) || typeof enabled !== 'boolean') throw new Error('Invalid game analysis setting.');
    const prefs = {...readAnalysisPreferences(userData), [gameId]:enabled};
    fs.mkdirSync(userData,{recursive:true});
    const target=path.join(userData,'save-analysis-settings.json');
    fs.writeFileSync(target+'.tmp',JSON.stringify(prefs));fs.renameSync(target+'.tmp',target);
    return prefs;
}
function analysisEnabled(userData,filePath) { return readAnalysisPreferences(userData)[gameForFile(filePath)] === true; }
module.exports = {GAMES,readAnalysisPreferences,setAnalysisPreference,analysisEnabled};
