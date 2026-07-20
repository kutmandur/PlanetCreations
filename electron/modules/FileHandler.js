const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const GAME_CONFIG = {
    'Planet Coaster 2': {
        folderName: 'Planet Coaster 2',
        fileTypes: {
            park: '.park2', 
            blueprint: '.blpr2',
            autosave: '.prkauto2'
        }
    },
    'Planet Zoo': {
        folderName: 'Planet Zoo',
        fileTypes: {
            park: '.zoo',
            blueprint: '.pzblueprint',
            autosave: '.zooauto'
        }
    }
};

// NEU: Eine Liste der erlaubten Dateiendungen für Medien
const ALLOWED_MEDIA_EXTENSIONS = new Set([
    // Bilder
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    // Videos
    '.mp4', '.webm', '.mov',
    // Audio
    '.mp3', '.ogg'
]);

function getDocumentsPath() {
    try {
        return app.getPath('documents');
    } catch (error) {
        console.error("Could not get 'documents' path from Electron:", error);
        return null;
    }
}

function scanGamesFromPath(basePath) {
    const results = {};
    if (!basePath || !fs.existsSync(basePath)) {
        console.error(`[FileHandler] Base path does not exist: ${basePath}`);
        return results;
    }

    for (const [gameName, config] of Object.entries(GAME_CONFIG)) {
        const gameResults = { parks: [], blueprints: [], autosaves: [] };
        const gamePath = path.join(basePath, config.folderName);
        if (!fs.existsSync(gamePath)) continue;

        const steamIdFolders = fs.readdirSync(gamePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && /^\d{17}$/.test(dirent.name))
            .map(dirent => dirent.name);

        for (const steamId of steamIdFolders) {
            const savesPath = path.join(gamePath, steamId, 'Saves');

            const scanDirectory = (dirPath, fileTypeKey, category) => {
                if (!fs.existsSync(dirPath)) return;
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    if (file.toLowerCase().endsWith(config.fileTypes[fileTypeKey])) {
                        const filePath = path.join(dirPath, file);
                        const stats = fs.statSync(filePath);
                        gameResults[category].push({ 
                            name: file, path: filePath, size: stats.size, modifiedAt: stats.mtime
                        });
                    }
                }
            };

            scanDirectory(savesPath, 'park', 'parks');
            scanDirectory(savesPath, 'blueprint', 'blueprints');
            scanDirectory(savesPath, 'autosave', 'autosaves');
        }
        results[gameName] = gameResults;
    }
    return results;
}

// *** ANGEPASSTE FUNKTION ***
function scanAllMediaFiles() {
    const documentsPath = getDocumentsPath();
    if (!documentsPath) return [];

    const frontierPath = path.join(documentsPath, 'Frontier Developments');
    if (!fs.existsSync(frontierPath)) return [];

    let allMediaFiles = [];

    for (const gameName in GAME_CONFIG) {
        const gamePath = path.join(frontierPath, GAME_CONFIG[gameName].folderName);
        const mediaFoldersToScan = ['UserMedia', 'UserAudio'];

        for (const mediaFolder of mediaFoldersToScan) {
            const fullPath = path.join(gamePath, mediaFolder);
            if (fs.existsSync(fullPath)) {
                const files = fs.readdirSync(fullPath);
                for (const file of files) {
                    const fileExtension = path.extname(file).toLowerCase();
                    // Prüfe, ob die Dateiendung in unserer Liste der erlaubten Endungen ist.
                    if (!file.startsWith('.') && ALLOWED_MEDIA_EXTENSIONS.has(fileExtension)) {
                        allMediaFiles.push({
                            name: file,
                            path: path.join(fullPath, file),
                            game: gameName
                        });
                    }
                }
            }
        }
    }
    return allMediaFiles;
}

module.exports = {
    scanGamesFromPath,
    scanAllMediaFiles,
};
