import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS, getGameColor } from '../../utils/helpers';
import useGames from '../../hooks/useGames';
import { getAppCheckTokenIfAvailable } from '../../firebase/appCheck';
import { getCachedFrontierDlcCatalogs } from '../../utils/frontierDlcCatalogCache';

// Import der ausgelagerten Komponenten
import GlobalLoader from '../ui/GlobalLoader';
import ToggleSwitch from '../ui/ToggleSwitch';
import BackupNoteModal from '../modals/BackupNoteModal';
import DeleteConfirmationModal from '../modals/DeleteConfirmationModal';
import DeleteMediaModal from '../modals/DeleteMediaModal';
import MediaSnapshotModal from '../modals/MediaSnapshotModal';
import CreationMetadataPanel from '../ui/CreationMetadataPanel';

// --- HILFSFUNKTIONEN ---
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function applyMetadataUpdate(results, update) {
    if (!results || !update?.filePath) return results;
    let changed = false;
    const next = {};
    for (const [gameName, game] of Object.entries(results)) {
        if (!game || typeof game !== 'object') {
            next[gameName] = game;
            continue;
        }
        const nextGame = { ...game };
        for (const category of ['parks', 'blueprints', 'autosaves']) {
            nextGame[category] = (game[category] || []).map(file => {
                if (file.path !== update.filePath) return file;
                changed = true;
                return {
                    ...file,
                    frontierMetadata: update.metadata || file.frontierMetadata,
                    customMediaReferences: update.mediaReferences || file.customMediaReferences || [],
                    frontierMetadataError: update.error || undefined,
                    metadataStatus: update.status,
                };
            });
        }
        next[gameName] = nextGame;
    }
    return changed ? next : results;
}

// --- UI-KOMPONENTEN ---
const SubHeader = ({ gameTabs, activeGame, setActiveGame, gameTabRefs, gameGliderRef, fileTypeTabs, activeTab, setActiveTab, fileTypeTabRefs, fileTypeGliderRef, activeGameColor }) => {
    useEffect(() => {
        if (!gameTabRefs.current.length || !gameGliderRef.current) return;
        const activeGameIndex = gameTabs.findIndex(tab => tab.id === activeGame);
        const activeGameNode = gameTabRefs.current[activeGameIndex];
        if (activeGameNode) {
            gameGliderRef.current.style.left = `${activeGameNode.offsetLeft}px`;
            gameGliderRef.current.style.width = `${activeGameNode.offsetWidth}px`;
        }
    }, [activeGame, gameTabs, gameTabRefs, gameGliderRef]);

    useEffect(() => {
        if (!fileTypeTabRefs.current.length || !fileTypeGliderRef.current || !fileTypeTabs.length) return;
        const activeTabIndex = fileTypeTabs.findIndex(tab => tab.id === activeTab);
        if (activeTabIndex === -1) {
            if(fileTypeGliderRef.current) fileTypeGliderRef.current.style.width = '0px';
            return;
        };
        const activeTabNode = fileTypeTabRefs.current[activeTabIndex];
        if (activeTabNode) {
            fileTypeGliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            fileTypeGliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [activeTab, fileTypeTabs, fileTypeTabRefs, fileTypeGliderRef]);

    return (
        <div className="flex-shrink-0">
            <div className="p-2 flex items-center justify-center"><div className="relative flex items-center bg-gray-900 rounded-full p-1 shadow-inner"><div ref={gameGliderRef} className={`absolute h-full rounded-full ${activeGameColor.bg} transition-all duration-500 ease-in-out`} />{gameTabs.map((tab, index) => (<button key={tab.id} ref={el => gameTabRefs.current[index] = el} onClick={() => setActiveGame(tab.id)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${ activeGame === tab.id ? 'text-white offline-active-tab' : 'text-gray-300 hover:text-white'}`}>{tab.name}</button>))}</div></div>
            <div className="p-4 flex items-center justify-center"><div className="relative flex items-center bg-gray-900 p-1 rounded-full mx-auto"><div ref={fileTypeGliderRef} className={`absolute h-full rounded-full ${activeGameColor.bg} transition-all duration-500 ease-in-out`} />{fileTypeTabs.map((tab, index) => (<button key={tab.id} ref={el => fileTypeTabRefs.current[index] = el} onClick={() => setActiveTab(tab.id)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-semibold text-sm ${ activeTab === tab.id ? 'text-white offline-active-tab' : 'text-gray-300 hover:text-white'}`}>{tab.name}</button>))}</div></div>
        </div>
    );
};

const FilterControls = ({ searchTerm, setSearchTerm, sortOption, setSortOption, sortOptions, showBackupAll, onBackupAll, showBackupSelected, onBackupSelected, selectedCount = 0, showRestoreSelected, onRestoreSelected }) => (
    <div className="px-6 py-4 flex items-center justify-between flex-shrink-0 bg-gray-800">
        <div className="flex-1 flex items-center space-x-2">{showBackupAll && (<button onClick={onBackupAll} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-sm">Backup All</button>)}{showBackupSelected && (<button onClick={onBackupSelected} disabled={selectedCount === 0} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">Backup Selected ({selectedCount})</button>)}{showRestoreSelected && (<button onClick={onRestoreSelected} disabled={selectedCount === 0} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">Restore Selected ({selectedCount})</button>)}</div>
        <div className="relative w-1/3 flex-1 mx-4"><span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"><Icon path={ICONS.search} className="w-5 h-5 text-gray-400" /></span><input type="text" placeholder="Search by name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-gray-700 text-white rounded-md pl-10 pr-8 py-1.5 w-full outline-none focus:ring-2 focus:ring-blue-500" />{searchTerm && (<button onClick={() => setSearchTerm('')} className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"><Icon path={ICONS.xMark} className="w-5 h-5" /></button>)}</div>
        <div className="flex items-center flex-1 justify-end"><label htmlFor="sort-select" className="text-sm font-semibold text-gray-400 mr-3">Sort by:</label><select id="sort-select" value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="bg-gray-700 text-white rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 appearance-none">{sortOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
    </div>
);


// --- LISTENDARSTELLUNG ---

const FileList = ({ files, viewMode, onBackupClick, onManageMediaClick, onInstallMedia, onUninstallMedia, onDeleteMediaClick, mediaStatus, snapshotStatus, mediaDiscoveryStatus, onBackupMediaClick, backingUpFile, backingUpMediaFile, allBackups, selectedItems, onToggleSelection }) => {
    if (!files || files.length === 0) {
        return <p className="text-gray-400 text-center mt-8">No files of this type found.</p>;
    }
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4 items-start">
            {files.map(file => {
                const displayName = file.frontierMetadata?.name || (file.name.includes('-') ? file.name.split('-')[0] : file.name.replace(/\.[^/.]+$/, ""));
                const isInstalled = viewMode === 'media' && mediaStatus && mediaStatus[file.path] === 'installed';
                const hasMedia = viewMode === 'media' && snapshotStatus && snapshotStatus[file.path];
                const isBackingUp = viewMode === 'backup' && backingUpFile === file.path;
                const isBackingUpMedia = viewMode === 'media' && backingUpMediaFile === file.path;
                const baseName = file.name.replace(/\.[^/.]+$/, "");
                const backupsForFile = allBackups ? allBackups[baseName] : null;
                const lastBackupDate = backupsForFile && backupsForFile.length > 0 ? new Date(backupsForFile[0].backupDate) : null;
                const isSelected = viewMode === 'backup' && selectedItems && selectedItems.has(file.path);
                const discovery = viewMode === 'media' ? mediaDiscoveryStatus?.[file.path] : null;

                return (
                    <div key={file.path} className={`pc-creation-file-card rounded-xl p-4 flex flex-col shadow-lg border transition-colors ${isInstalled ? 'bg-green-900 bg-opacity-40 border-green-500' : 'bg-gray-700 border-gray-600 hover:border-gray-500'}`}>
                        {viewMode === 'backup' && (
                            <div className="self-end flex-shrink-0">
                                <input
                                    type="checkbox"
                                    className="h-5 w-5 rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-blue-500"
                                    checked={isSelected}
                                    onChange={() => onToggleSelection(file.path)}
                                />
                            </div>
                        )}
                        <div className="flex flex-col items-center overflow-hidden w-full flex-grow text-center">
                            <div className="truncate w-full">
                                <p className="font-semibold text-white truncate text-lg" title={file.name}>{displayName}</p>
                                <p className="text-sm text-gray-500 truncate">{file.name}</p>
                            </div>
                            <CreationMetadataPanel
                                metadata={file.frontierMetadata}
                                filePath={file.path}
                                metadataStatus={file.metadataStatus}
                                metadataError={file.frontierMetadataError}
                                customMediaReferences={file.customMediaReferences}
                            />
                            {file.frontierMetadataError && <p className="mt-2 text-xs text-amber-400">Metadata could not be read.</p>}
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full mt-4">
                            <div className="text-center text-sm bg-gray-800 rounded-lg p-2">
                                <p className="text-gray-400 text-xs">Size</p>
                                <p className="font-semibold text-white">{formatBytes(file.size)}</p>
                            </div>
                            <div className="text-center text-sm bg-gray-800 rounded-lg p-2">
                                <p className="text-gray-400 text-xs">Last Modified</p>
                                <p className="font-semibold text-white">{new Date(file.modifiedAt).toLocaleString()}</p>
                            </div>
                            <div className="text-center text-sm bg-gray-800 rounded-lg p-2 col-span-2">
                                <p className="text-gray-400 text-xs">Last Backup</p>
                                <p className="font-semibold text-white">{lastBackupDate ? lastBackupDate.toLocaleString() : 'N/A'}</p>
                            </div>
                            <div className="flex flex-wrap gap-2 items-center justify-center col-span-2 mt-2">
                                {viewMode === 'media' && discovery && (
                                    <div className="w-full rounded-md bg-gray-800 px-2 py-1 text-center text-xs text-gray-300">
                                        {discovery.success ? `${discovery.assetCount} media file(s) matched` : 'Automatic media detection failed'}
                                        {discovery.missing?.length > 0 && <span className="text-amber-400"> · {discovery.missing.length} missing</span>}
                                    </div>
                                )}
                                {viewMode === 'backup' && (
                                    <button onClick={() => onBackupClick(file)} disabled={isBackingUp} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-3 rounded text-sm w-20 flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed">
                                        {isBackingUp ? '...' : 'Backup'}
                                    </button>
                                )}
                                {viewMode === 'media' && (
                                    <>
                                        <button onClick={() => onBackupMediaClick(file)} disabled={isBackingUpMedia} title="Automatically detect and back up referenced media" className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-1 px-3 rounded text-sm w-28 flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed">
                                            {isBackingUpMedia ? '...' : 'Backup Media'}
                                        </button>
                                        <button onClick={() => onManageMediaClick(file)} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-1 px-3 rounded text-sm">
                                            Manage Media
                                        </button>
                                        <button onClick={() => onDeleteMediaClick(file)} disabled={!hasMedia} title="Delete associated media" className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                                            Delete Media
                                        </button>
                                        <div className="flex items-center gap-2 bg-gray-800 rounded-full px-3 py-1.5">
                                            <span className={`text-xs font-semibold ${isInstalled ? 'text-green-400' : 'text-gray-400'}`}>{isInstalled ? 'Installed' : 'Not installed'}</span>
                                            <ToggleSwitch isToggled={isInstalled} onToggle={() => isInstalled ? onUninstallMedia(file) : onInstallMedia(file)} />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// --- TAB-SPEZIFISCHE KOMPONENTEN ---

const FileBrowser = ({ user, onBackupCreated, scanResults, loading, selectedPath, subHeaderProps, setGlobalLoader, refreshKey }) => {
    const [backupModalState, setBackupModalState] = useState({ isOpen: false, file: null, isBatch: false, selectedFiles: [] });
    const [backingUpFile, setBackingUpFile] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('modifiedAt_desc');
    const [allBackups, setAllBackups] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState(new Set());
    const { activeGame, activeTab } = subHeaderProps;
    
    useEffect(() => {
        const fetchBackups = async () => {
            if (window.electronAPI) {
                const backups = await window.electronAPI.listAllBackups();
                setAllBackups(backups);
            }
        };
        fetchBackups();
    }, [refreshKey]);

    useEffect(() => {
        setSelectedFiles(new Set());
    }, [activeGame, activeTab]);

    const SORT_OPTIONS = [ { value: 'modifiedAt_desc', label: 'Date (Newest)' }, { value: 'modifiedAt_asc', label: 'Date (Oldest)' }, { value: 'name_asc', label: 'Name (A-Z)' }, { value: 'name_desc', label: 'Name (Z-A)' }, { value: 'size_desc', label: 'Size (Largest)' }, { value: 'size_asc', label: 'Size (Smallest)' }, ];
    
    const processedFiles = useMemo(() => {
        const files = scanResults?.[activeGame]?.[activeTab] || [];
        const filtered = files.filter(file => file.name.toLowerCase().includes(searchTerm.toLowerCase()));
        const [key, direction] = sortOption.split('_');
        return filtered.sort((a, b) => {
            let valA = a[key], valB = b[key];
            if (key === 'name') { valA = valA.toLowerCase(); valB = valB.toLowerCase(); }
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [scanResults, activeGame, activeTab, searchTerm, sortOption]);

    const handleToggleSelection = (filePath) => {
        setSelectedFiles(prev => {
            const newSet = new Set(prev);
            if (newSet.has(filePath)) {
                newSet.delete(filePath);
            } else {
                newSet.add(filePath);
            }
            return newSet;
        });
    };

    const handleBackupClick = (file) => { setBackupModalState({ isOpen: true, file: file, isBatch: false, selectedFiles: [] }); };
    const handleBackupAllClick = () => { setBackupModalState({ isOpen: true, file: null, isBatch: true, selectedFiles: [] }); };
    const handleBackupSelectedClick = () => {
        const filesToBackup = processedFiles.filter(f => selectedFiles.has(f.path));
        setBackupModalState({ isOpen: true, file: null, isBatch: true, selectedFiles: filesToBackup });
    };
    
    const handleConfirmBackup = async (note, isSigned, includeMediaPackage) => {
        const { file, isBatch, selectedFiles: filesForBatch } = backupModalState;
        setBackupModalState({ isOpen: false, file: null, isBatch: false, selectedFiles: [] });

        let idToken = null;
        let appCheckToken = null;
        if (isSigned) {
            if (!user) {
                alert("You must be in online mode and logged in to sign a backup.");
                return;
            }
            try {
                setGlobalLoader({ isLoading: true, message: 'Requesting signature...' });
                [idToken, appCheckToken] = await Promise.all([
                    user.getIdToken(true),
                    getAppCheckTokenIfAvailable(),
                ]);
            } catch (error) {
                alert("Could not get authentication token. Please try again.");
                setGlobalLoader({ isLoading: false, message: '' });
                return;
            }
        }
        
        if (isBatch) {
            const filesToBackup = filesForBatch && filesForBatch.length > 0 ? filesForBatch : processedFiles;
            if (filesToBackup.length === 0) return;
            setGlobalLoader({ isLoading: true, message: `Backing up ${filesToBackup.length} creation(s)...` });
            try {
                const result = await window.electronAPI.backupAllCreations(
                    filesToBackup,
                    note,
                    isSigned,
                    idToken,
                    appCheckToken,
                    includeMediaPackage,
                );
                alert(result.message);
                if (result.success) {
                    onBackupCreated();
                    setSelectedFiles(new Set());
                }
            } catch(e) {
                alert(`An error occurred: ${e.message}`);
            } finally {
                setGlobalLoader({ isLoading: false, message: '' });
            }
        } else {
            if (!file) return;
            setGlobalLoader({ isLoading: true, message: `Backing up ${file.name}...` });
            try {
                await window.electronAPI.createBackup(
                    file.path,
                    note,
                    isSigned,
                    idToken,
                    appCheckToken,
                );
                let message = `Backup for "${file.name}" created successfully!`;
                if (includeMediaPackage) {
                    setGlobalLoader({ isLoading: true, message: `Creating matching Custom Media package for ${file.name}...` });
                    const mediaResult = await window.electronAPI.backupCreationMedia(
                        file.path,
                        note,
                        isSigned,
                        idToken,
                        appCheckToken,
                    );
                    message += `\n\n${mediaResult.message}`;
                }
                alert(message);
                if(onBackupCreated) onBackupCreated();
            } catch (error) { 
                alert(`An error occurred: ${error.message}`); 
            } finally { 
                setBackingUpFile(null); 
                setGlobalLoader({ isLoading: false, message: '' }); 
            }
        }
    };
    
    return (
        <div className="flex flex-col h-full bg-gray-800">
            {backupModalState.isOpen && (<BackupNoteModal onConfirm={handleConfirmBackup} onCancel={() => setBackupModalState({ isOpen: false, file: null, isBatch: false, selectedFiles: [] })} isOnline={!!user} showMediaPackageOption />)}
            <SubHeader {...subHeaderProps} />
            <FilterControls 
                searchTerm={searchTerm} setSearchTerm={setSearchTerm} 
                sortOption={sortOption} setSortOption={setSortOption} 
                sortOptions={SORT_OPTIONS} 
                showBackupAll={true} onBackupAll={handleBackupAllClick}
                showBackupSelected={true} onBackupSelected={handleBackupSelectedClick}
                selectedCount={selectedFiles.size}
            />
            <div className="flex-1 overflow-y-auto p-6 min-h-0 scrollbar-gutter-stable">
                {!selectedPath && !loading ? (
                    <div className="flex h-full items-center justify-center"><p className="text-gray-400">Please select the 'Frontier Developments' folder to begin.</p></div>
                ) : loading ? (
                    <div className="flex h-full items-center justify-center"><Spinner /></div>
                ) : (
                    <FileList 
                        files={processedFiles} viewMode="backup" onBackupClick={handleBackupClick} 
                        backingUpFile={backingUpFile} allBackups={allBackups}
                        selectedItems={selectedFiles} onToggleSelection={handleToggleSelection}
                    />
                )}
            </div>
        </div>
    );
};

const BackupRestore = ({ refreshKey, subHeaderProps, setGlobalLoader, activeView }) => {
    const [allBackups, setAllBackups] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('date_desc');
    const [deleteModalState, setDeleteModalState] = useState({ isOpen: false, backup: null });
    const [selectedBackups, setSelectedBackups] = useState({});
    const [workshopPreviews, setWorkshopPreviews] = useState({});
    const { activeGame, activeTab } = subHeaderProps;
    
    const SORT_OPTIONS = [ { value: 'date_desc', label: 'Date (Newest)' }, { value: 'date_asc', label: 'Date (Oldest)' }, { value: 'name_asc', label: 'Name (A-Z)' }, { value: 'name_desc', label: 'Name (Z-A)' }, { value: 'count_desc', label: 'Backup Count (Most)' }, { value: 'count_asc', label: 'Backup Count (Fewest)' }, ];
    
    const fetchBackups = useCallback(async () => {
        let isMounted = true;
        setLoading(true);
        if (window.electronAPI) {
            try {
                const backups = await window.electronAPI.listAllBackups();
                if (isMounted) {
                    setAllBackups(backups);
                    const previewEntries = Object.values(backups).flat()
                        .filter(backup => backup.category === 'Workshop' && backup.previewPath);
                    const loadedPreviews = await Promise.all(previewEntries.map(async (backup) => {
                        try { return [backup.filePath, await window.electronAPI.readFileAsDataURL(backup.previewPath)]; }
                        catch (error) { return [backup.filePath, null]; }
                    }));
                    setWorkshopPreviews(Object.fromEntries(loadedPreviews));
                }
            } catch(e){ console.error(e); }
        }
        if (isMounted) {
            setLoading(false);
        }
        return () => { isMounted = false; };
    }, []);

    useEffect(() => {
        fetchBackups();
    }, [fetchBackups, refreshKey]);

    useEffect(() => {
        setSelectedBackups({});
    }, [activeGame, activeTab]);

    const processedBackups = useMemo(() => {
        if (!allBackups) return [];
        const allBackupEntries = Object.entries(allBackups).map(([saveName, backups]) => ({saveName, backups}));

        const filteredItems = allBackupEntries.filter(({saveName, backups}) => {
            const firstBackup = backups[0];
            if (!firstBackup) return false;

            // 1. Filter by Main View (Workshop vs. Restore)
            const isWorkshopItem = firstBackup.category === 'Workshop';
            if (activeView === 'workshop' && !isWorkshopItem) return false;
            if (activeView === 'restore' && isWorkshopItem) return false;

            // 2. Filter by Game
            const pathLower = (firstBackup.originalFilePath || '').toLowerCase();
            const gameMatches = (activeGame === 'Planet Coaster 2' && (firstBackup.gameId === 'planet-coaster-2' || pathLower.includes('planet coaster 2'))) ||
                (activeGame === 'Planet Zoo' && (firstBackup.gameId === 'planet-zoo' || pathLower.includes('planet zoo')));
            if (!gameMatches) return false;

            // 3. Filter by File Type (Sub-Tab)
            if (activeTab === 'customMedia') {
                return firstBackup.backupType === 'media';
            }
            
            if (firstBackup.backupType !== 'creation') return false;

            switch (activeTab) {
                case 'all':
                    return true;
                case 'parks':
                    return firstBackup.originalFileName.endsWith('.park2') || firstBackup.originalFileName.endsWith('.zoo');
                case 'blueprints':
                    return firstBackup.originalFileName.endsWith('.blpr2') || firstBackup.originalFileName.endsWith('.pzblueprint');
                case 'autosaves':
                    return firstBackup.originalFileName.endsWith('.prkauto2') || firstBackup.originalFileName.endsWith('.zooauto');
                default:
                    return false;
            }
        });
        
        const filteredByName = filteredItems.filter(item => item.saveName.toLowerCase().includes(searchTerm.toLowerCase()));
        
        const [key, direction] = sortOption.split('_');
        return filteredByName.sort((a, b) => {
            let valA, valB;
            switch(key) {
                case 'name': valA = a.saveName.toLowerCase(); valB = b.saveName.toLowerCase(); break;
                case 'count': valA = a.backups.length; valB = b.backups.length; break;
                default: valA = new Date(a.backups[0].backupDate); valB = new Date(b.backups[0].backupDate); break;
            }
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [allBackups, activeGame, activeTab, searchTerm, sortOption, activeView]);

    const handleToggleBackupSelection = (saveName, backup) => {
        setSelectedBackups(prev => {
            const newSelection = {...prev};
            if (newSelection[saveName] && newSelection[saveName].filePath === backup.filePath) {
                delete newSelection[saveName];
            } else {
                newSelection[saveName] = backup;
            }
            return newSelection;
        });
    };

    const handleRestoreSelected = async () => {
        const selectedToRestore = Object.values(selectedBackups);
        if (selectedToRestore.length === 0) return;

        setGlobalLoader({ isLoading: true, message: `Verifying ${selectedToRestore.length} backup(s)...` });

        let restoredCount = 0;

        for (const backup of selectedToRestore) {
            // Erste Verifizierung - prüft nur den Status
            const verifyResult = await window.electronAPI.restoreBackup(backup.filePath, backup.originalFilePath);

            if (verifyResult.status === 'canceled') continue;

            if (verifyResult.status === 'invalid') {
                alert(`SIGNATURE INVALID: The backup for "${backup.originalFileName}" could not be restored because its signature is invalid. It may have been tampered with.`);
                continue;
            }

            if (verifyResult.status === 'unsigned') {
                const confirmed = window.confirm(`WARNING: The backup for "${backup.originalFileName}" is not signed. Only restore this file if you created it yourself or trust the source.\n\nDo you want to continue restoring this file?`);
                if (!confirmed) {
                    continue;
                }
            }

            // Die Wiederherstellung wurde bereits durch restoreBackup durchgeführt
            if (verifyResult.success) {
                restoredCount++;
            } else {
                alert(`Failed to restore "${backup.originalFileName}": ${verifyResult.message || 'Unknown error'}`);
            }
        }

        setGlobalLoader({ isLoading: false, message: '' });
        alert(`${restoredCount} of ${selectedToRestore.length} backups were restored successfully.`);
        setSelectedBackups({});
        fetchBackups();
    };

    const handleDeleteClick = (backup) => {
        setDeleteModalState({ isOpen: true, backup });
    };

    const handleConfirmDelete = async () => {
        const backupToDelete = deleteModalState.backup;
        if (!backupToDelete) return;

        setGlobalLoader({ isLoading: true, message: `Deleting backup...` });
        const result = await window.electronAPI.deleteBackup(backupToDelete.filePath);
        setGlobalLoader({ isLoading: false, message: '' });

        alert(result.message);
        setDeleteModalState({ isOpen: false, backup: null });
        if (result.success) {
            fetchBackups();
        }
    };
    
    const handleWorkshopInstall = async (backup) => {
        setGlobalLoader({ isLoading: true, message: `Installing ${backup.originalFileName}...` });
        try {
            const result = await window.electronAPI.installWorkshopPackage(backup.filePath);
            alert(result.success ? `Installed ${result.installedFileName || backup.originalFileName}.` : `Installation failed: ${result.message}`);
        } finally {
            setGlobalLoader({ isLoading: false, message: '' });
            fetchBackups();
        }
    };

    const handleWorkshopUninstall = async (backup) => {
        if (!window.confirm(`Uninstall "${backup.originalFileName}" from the game?\n\nThe archived workshop package will be kept.`)) return;
        setGlobalLoader({ isLoading: true, message: `Uninstalling ${backup.originalFileName}...` });
        try {
            const result = await window.electronAPI.uninstallWorkshopPackage(backup.filePath);
            alert(result.message);
        } finally {
            setGlobalLoader({ isLoading: false, message: '' });
            fetchBackups();
        }
    };

    const hasBackups = processedBackups && processedBackups.length > 0;

    return (
        <div className="flex flex-col h-full bg-gray-800">
            {deleteModalState.isOpen && <DeleteConfirmationModal item={deleteModalState.backup} title="Delete Backup" warning='This action cannot be undone. To confirm, please type "DELETE" in the box below.' onConfirm={handleConfirmDelete} onCancel={() => setDeleteModalState({ isOpen: false, backup: null })} />}
            <SubHeader {...subHeaderProps} />
            <FilterControls 
                searchTerm={searchTerm} setSearchTerm={setSearchTerm} 
                sortOption={sortOption} setSortOption={setSortOption} 
                sortOptions={SORT_OPTIONS} 
                showRestoreSelected={activeView !== 'workshop'}
                onRestoreSelected={handleRestoreSelected}
                selectedCount={Object.keys(selectedBackups).length}
            />
            <div className="flex-1 overflow-y-auto p-6 min-h-0 scrollbar-gutter-stable">
                {loading ? (
                    <div className="flex h-full items-center justify-center"><Spinner /></div>
                ) : !hasBackups ? (
                    <div className="flex h-full items-center justify-center"><p className="text-gray-400">No backups found for this category.</p></div>
                ) : (
                    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 items-start ${activeView === 'restore' ? 'xl:grid-cols-3 2xl:grid-cols-4' : 'lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6'}`}>
                        {processedBackups.map(({saveName, backups}) => (
                            <div key={saveName} className="bg-gray-700 rounded-xl overflow-hidden shadow-lg border border-gray-600 hover:border-gray-500 transition-colors">
                                {activeView === 'workshop' && (
                                    <div className="h-32 bg-gray-900 flex items-center justify-center overflow-hidden">
                                        {workshopPreviews[backups[0]?.filePath] ?
                                            <img src={workshopPreviews[backups[0].filePath]} alt="" className="w-full h-full object-cover" /> :
                                            <Icon path={ICONS.cog} className="w-12 h-12 text-gray-600" />}
                                    </div>
                                )}
                                <div className="p-3">
                                <h3 className={`font-bold text-white text-center truncate ${activeView === 'restore' ? 'text-xl my-4' : 'text-base mb-3'}`} title={backups[0]?.workshopTitle || saveName}>{backups[0]?.workshopTitle || saveName}</h3>
                                <div className="space-y-2">
                                    {backups.map(backup => (
                                        <div key={backup.backupDate} className="bg-gray-800 rounded-lg p-2.5">
                                            <div className="flex items-start">
                                                {activeView !== 'workshop' && <input
                                                    type="checkbox" 
                                                    className="h-5 w-5 rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-blue-500 mr-4"
                                                    checked={selectedBackups[saveName]?.filePath === backup.filePath}
                                                    onChange={() => handleToggleBackupSelection(saveName, backup)}
                                                />}
                                                <div className="flex items-center space-x-2">
                                                    {backup.isSigned && (
                                                        <div title={`Signed by: ${backup.signerUsername}`}>
                                                            <Icon path={ICONS.shieldCheck} className="w-5 h-5 text-green-400" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="text-xs font-semibold text-white">{new Date(backup.backupDate).toLocaleString()}</p>
                                                        <p className="text-xs text-gray-400 italic">{backup.note || "No note"}</p>
                                                        {activeView === 'workshop' && <p className={`text-xs font-semibold mt-1 ${backup.installStatus === 'installed' ? 'text-green-400' : backup.installStatus === 'modified' ? 'text-yellow-400' : 'text-gray-400'}`}>{backup.installStatus === 'installed' ? 'Installed' : backup.installStatus === 'modified' ? 'Installed · game file changed' : 'Not installed'}</p>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap justify-center gap-2 mt-3">
                                                {activeView === 'workshop' && backup.installStatus === 'not-installed' && <button onClick={() => handleWorkshopInstall(backup)} className="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-3 rounded text-xs">Install</button>}
                                                {activeView === 'workshop' && backup.installStatus !== 'not-installed' && <button onClick={() => handleWorkshopUninstall(backup)} className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-1 px-3 rounded text-xs">Uninstall</button>}
                                                <button onClick={() => handleDeleteClick(backup)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-xs">{activeView === 'workshop' ? 'Delete Package' : 'Delete'}</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const MediaManager = ({ user, scanResults, loading, selectedPath, subHeaderProps, setGlobalLoader }) => {
    const [snapshotModalState, setSnapshotModalState] = useState({ isOpen: false, file: null, gameName: null });
    const [mediaStatus, setMediaStatus] = useState({});
    const [snapshotStatus, setSnapshotStatus] = useState({});
    const [mediaDiscoveryStatus, setMediaDiscoveryStatus] = useState({});
    const [statusLoading, setStatusLoading] = useState(false);
    const [backingUpMediaFile, setBackingUpMediaFile] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('modifiedAt_desc');
    const [deleteMediaModalState, setDeleteMediaModalState] = useState({ isOpen: false, file: null });
    const [finalDeleteState, setFinalDeleteState] = useState({ isOpen: false, file: null, mode: null });
    const [allBackups, setAllBackups] = useState(null);
    const { activeGame, activeTab } = subHeaderProps;
    const [mediaBackupModalState, setMediaBackupModalState] = useState({ isOpen: false, file: null });

    useEffect(() => {
        const fetchBackups = async () => {
            if (window.electronAPI) {
                const backups = await window.electronAPI.listAllBackups();
                setAllBackups(backups);
            }
        };
        fetchBackups();
    }, [scanResults]);

    const SORT_OPTIONS = [ { value: 'modifiedAt_desc', label: 'Date (Newest)' }, { value: 'modifiedAt_asc', label: 'Date (Oldest)' }, { value: 'name_asc', label: 'Name (A-Z)' }, { value: 'name_desc', label: 'Name (Z-A)' }, { value: 'snapshot_desc', label: 'Media Attached First' }, { value: 'snapshot_asc', label: 'Media Attached Last' }, ];
    
    const processedFiles = useMemo(() => {
        const files = scanResults?.[activeGame]?.[activeTab] || [];
        const filtered = files.filter(file => file.name.toLowerCase().includes(searchTerm.toLowerCase()));
        const [key, direction] = sortOption.split('_');
        
        return filtered.sort((a, b) => {
            const isAInstalled = mediaStatus[a.path] === 'installed';
            const isBInstalled = mediaStatus[b.path] === 'installed';
            if (isAInstalled && !isBInstalled) return -1;
            if (!isAInstalled && isBInstalled) return 1;

            let valA, valB;
            switch (key) {
                case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                case 'snapshot': valA = snapshotStatus[a.path] ? 1 : 0; valB = snapshotStatus[b.path] ? 1 : 0; break;
                default: valA = new Date(a.modifiedAt); valB = new Date(b.modifiedAt); break;
            }
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [scanResults, activeGame, activeTab, searchTerm, sortOption, snapshotStatus, mediaStatus]);

    const checkStatuses = useCallback(async (files) => {
        if (!files || !window.electronAPI) return;
        setStatusLoading(true);
        const mediaStatusMap = {};
        const snapshotStatusMap = {};
        const discoveryStatusMap = {};
        for (const file of files) {
            const [media, hasSnapshot, snapshot] = await Promise.all([
                window.electronAPI.getMediaStatus(file.path),
                window.electronAPI.hasMediaSnapshot(file.path),
                window.electronAPI.getMediaSnapshot(file.path),
            ]);
            mediaStatusMap[file.path] = media;
            snapshotStatusMap[file.path] = hasSnapshot;
            if (snapshot?.discovery) {
                discoveryStatusMap[file.path] = {
                    success: true,
                    status: 'synchronized',
                    associationMode: snapshot.associationMode,
                    assetCount: snapshot.assets?.length || 0,
                    referenceCount: snapshot.discovery?.references?.length || 0,
                    missing: snapshot.discovery?.missing || [],
                };
            }
        }
        setMediaStatus(mediaStatusMap);
        setSnapshotStatus(snapshotStatusMap);
        setMediaDiscoveryStatus(discoveryStatusMap);
        setStatusLoading(false);
    }, []);
    useEffect(() => { const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) { checkStatuses(currentFiles); } }, [scanResults, activeGame, activeTab, checkStatuses]);
    const synchronizeMedia = useCallback(async (file) => {
        const result = await window.electronAPI.syncAutomaticMediaSnapshot(file.path);
        setMediaDiscoveryStatus(previous => ({ ...previous, [file.path]: result }));
        const currentFiles = scanResults?.[activeGame]?.[activeTab];
        if (currentFiles) await checkStatuses(currentFiles);
        return result;
    }, [activeGame, activeTab, checkStatuses, scanResults]);

    const handleManageMediaClick = async (file) => {
        setGlobalLoader({ isLoading: true, message: `Detecting referenced media for ${file.name}...` });
        try {
            const result = await synchronizeMedia(file);
            if (!result.success) alert(`Automatic media detection failed: ${result.message}`);
            setSnapshotModalState({ isOpen: true, file, gameName: activeGame });
        } catch (error) {
            alert(`Automatic media detection failed: ${error.message}`);
        } finally {
            setGlobalLoader({ isLoading: false, message: '' });
        }
    };
    
    const handleBackupMediaClick = async (file) => {
        setGlobalLoader({ isLoading: true, message: `Detecting referenced media for ${file.name}...` });
        try {
            const result = await synchronizeMedia(file);
            if (!result.success) {
                alert(`Automatic media detection failed: ${result.message}`);
                return;
            }
            if (result.assetCount === 0) {
                const message = result.referenceCount > 0 ?
                    `${result.referenceCount} media reference(s) were found, but none of the files are available locally.` :
                    'This creation does not reference any detectable custom media.';
                alert(message);
                return;
            }
            setMediaBackupModalState({ isOpen: true, file });
        } catch (error) {
            alert(`Automatic media detection failed: ${error.message}`);
        } finally {
            setGlobalLoader({ isLoading: false, message: '' });
        }
    };

    const handleConfirmMediaBackup = async (note, isSigned) => {
        const { file } = mediaBackupModalState;
        if (!file) return;
        setMediaBackupModalState({ isOpen: false, file: null });

        let idToken = null;
        let appCheckToken = null;
        if (isSigned) {
            if (!user) {
                alert("You must be in online mode and logged in to sign a media backup.");
                return;
            }
            try {
                setGlobalLoader({ isLoading: true, message: 'Requesting signature...' });
                [idToken, appCheckToken] = await Promise.all([
                    user.getIdToken(true),
                    getAppCheckTokenIfAvailable(),
                ]);
            } catch (error) {
                alert("Could not get authentication token. Please try again.");
                setGlobalLoader({ isLoading: false, message: '' });
                return;
            }
        }

        setBackingUpMediaFile(file.path);
        setGlobalLoader({ isLoading: true, message: `Backing up media for ${file.name}...` });
        try {
            const result = await window.electronAPI.backupCreationMedia(
                file.path,
                note,
                isSigned,
                idToken,
                appCheckToken,
            );
            alert(result.message);
        } catch (error) {
            alert(`An error occurred: ${error.message}`);
        } finally {
            setBackingUpMediaFile(null);
            setGlobalLoader({ isLoading: false, message: '' });
        }
    };

    const activateMediaWithConflictHandling = async (filePath) => {
        let result = await window.electronAPI.installMedia(filePath);
        if (result?.status === 'conflict') {
            const names = result.conflicts.map(conflict => conflict.logicalName).join(', ');
            const confirmed = window.confirm(
                `Different files with the same target name already exist: ${names}.\n\n` +
                'Activation has been stopped without changing anything. Temporarily park the existing files and activate this media set?'
            );
            if (confirmed) result = await window.electronAPI.installMedia(filePath, { parkConflicts: true });
        }
        return result;
    };
    const handleSaveSnapshot = async (savePath, mediaPaths) => { const fileToInstall = snapshotModalState.file; if (!fileToInstall) { alert('Error: Could not identify the target file.'); return; } const snapshotSuccess = await window.electronAPI.createMediaSnapshot(savePath, mediaPaths); const currentFiles = scanResults?.[activeGame]?.[activeTab]; if (snapshotSuccess) { const installResult = await activateMediaWithConflictHandling(fileToInstall.path); alert(installResult?.success ? 'Snapshot saved and media activated!' : `Snapshot saved, but activation failed: ${installResult?.message || installResult?.status || 'unknown error'}`); if (currentFiles) { checkStatuses(currentFiles); } } else { alert('Failed to save snapshot. Only supported image/video files and MP3/OGG audio may be selected.'); } setSnapshotModalState({ isOpen: false, file: null, gameName: null }); };
    const handleInstall = async (file) => { const discovery = await synchronizeMedia(file); if (!discovery.success || discovery.assetCount === 0) { alert(discovery.message || 'No available referenced media was found for this creation.'); return; } const result = await activateMediaWithConflictHandling(file.path); if(result?.success) alert('Media installed!'); else if (result?.status !== 'conflict') alert(`Failed to install media: ${result?.message || result?.status || 'unknown error'}`); const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) checkStatuses(currentFiles); };
    const handleUninstall = async (file) => { const result = await window.electronAPI.uninstallMedia(file.path); if(result?.success) alert('Media uninstalled!'); else alert(`Failed to uninstall media: ${result?.message || 'unknown error'}`); const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) checkStatuses(currentFiles); };
    const handleDeleteMediaClick = (file) => { setDeleteMediaModalState({ isOpen: true, file: file }); };
    const handleDeletionModeSelected = (mode) => { setFinalDeleteState({ isOpen: true, file: deleteMediaModalState.file, mode: mode }); setDeleteMediaModalState({ isOpen: false, file: null }); };
    const handleConfirmMediaDelete = async () => { const { file, mode } = finalDeleteState; if (!file || !mode) return; setGlobalLoader({ isLoading: true, message: `Deleting media for ${file.name}...` }); try { const result = await window.electronAPI.deleteCreationMedia(file.path, mode); alert(result.message); if (result.success) { const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) checkStatuses(currentFiles); } } catch (error) { alert(`An error occurred: ${error.message}`); } finally { setGlobalLoader({ isLoading: false, message: '' }); setFinalDeleteState({ isOpen: false, file: null, mode: null }); } };
    const deleteWarning = finalDeleteState.mode === 'safe' ? "This will delete all associated media for this creation that is NOT used by other creations." : "WARNING: This will delete ALL associated media files, even if they ARE USED by other creations.";

    return (
        <div className="flex flex-col h-full bg-gray-800">
            {mediaBackupModalState.isOpen && <BackupNoteModal onConfirm={handleConfirmMediaBackup} onCancel={() => setMediaBackupModalState({ isOpen: false, file: null })} isOnline={!!user} />}
            {snapshotModalState.isOpen && ( <MediaSnapshotModal file={snapshotModalState.file} gameName={snapshotModalState.gameName} onClose={() => setSnapshotModalState({ isOpen: false, file: null, gameName: null })} onSave={handleSaveSnapshot} /> )}
            {deleteMediaModalState.isOpen && <DeleteMediaModal file={deleteMediaModalState.file} onCancel={() => setDeleteMediaModalState({ isOpen: false, file: null })} onConfirm={handleDeletionModeSelected} />}
            {finalDeleteState.isOpen && <DeleteConfirmationModal item={finalDeleteState.file} title={`Confirm ${finalDeleteState.mode.charAt(0).toUpperCase() + finalDeleteState.mode.slice(1)} Delete`} warning={deleteWarning} onConfirm={handleConfirmMediaDelete} onCancel={() => setFinalDeleteState({ isOpen: false, file: null, mode: null })} />}
            <SubHeader {...subHeaderProps} />
            <FilterControls searchTerm={searchTerm} setSearchTerm={setSearchTerm} sortOption={sortOption} setSortOption={setSortOption} sortOptions={SORT_OPTIONS} />
            <div className="flex-1 overflow-y-auto p-6 min-h-0 scrollbar-gutter-stable">
                {!selectedPath && !loading ? (
                    <div className="flex h-full items-center justify-center"><p className="text-gray-400">Please select the 'Frontier Developments' folder to begin.</p></div>
                ) : loading ? (
                    <div className="flex h-full items-center justify-center"><Spinner /></div>
                ) : (
                    <>
                        {statusLoading && <div className="text-center text-xs text-gray-400 mb-2">Checking statuses...</div>}
                        <FileList files={processedFiles} viewMode="media" onManageMediaClick={handleManageMediaClick} onInstallMedia={handleInstall} onUninstallMedia={handleUninstall} onDeleteMediaClick={handleDeleteMediaClick} mediaStatus={mediaStatus} snapshotStatus={snapshotStatus} mediaDiscoveryStatus={mediaDiscoveryStatus} onBackupMediaClick={handleBackupMediaClick} backingUpMediaFile={backingUpMediaFile} allBackups={allBackups} />
                    </>
                )}
            </div>
        </div>
    );
};

// --- HAUPT-WRAPPER-KOMPONENTE ---

const ClientDashboard = ({ user }) => {
    const [activeView, setActiveView] = useState('backup');
    const [backupRefreshKey, setBackupRefreshKey] = useState(0);
    const [scanResults, setScanResults] = useState(null);
    const [loading, setLoading] = useState(true);
    const [scanProgress, setScanProgress] = useState({ completed: 0, total: 0, running: false });
    const [selectedPath, setSelectedPath] = useState(null);
    const [selectingPath, setSelectingPath] = useState(false);
    const [pathSelectionError, setPathSelectionError] = useState(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [globalLoader, setGlobalLoader] = useState({ isLoading: false, message: '' });
    const settingsRef = useRef(null);
    const pendingMetadataUpdatesRef = useRef(new Map());
    
    // Desktop-Client indexiert lokale Dateien nach Anzeigenamen; nur Spiele mit
    // Datei-Endungen (= vom Desktop-Client scannbar) anbieten.
    const registryGames = useGames();
    const GAME_TABS = useMemo(() =>
        registryGames
            .filter(g => g.fileExtensions?.length > 0)
            .map(g => ({ id: g.name, name: g.name })),
    [registryGames]);
    const FILE_TYPE_TABS = useMemo(() => {
        const baseTabs = [ { id: 'parks', name: 'Parks' }, { id: 'blueprints', name: 'Blueprints' }, { id: 'autosaves', name: 'Autosaves' }, ];
        if (activeView === 'restore') {
            return [ ...baseTabs, { id: 'customMedia', name: 'Custom Media' }];
        }
        if (activeView === 'workshop') {
            return [{ id: 'all', name: 'All' }, ...baseTabs];
        }
        return baseTabs;
    }, [activeView]);
    const [activeGame, setActiveGame] = useState(GAME_TABS[0]?.id || 'Planet Coaster 2');
    const [activeTab, setActiveTab] = useState(FILE_TYPE_TABS[0].id);
    
    useEffect(() => {
        const currentTabExists = FILE_TYPE_TABS.some(tab => tab.id === activeTab);
        if (!currentTabExists) {
            setActiveTab(FILE_TYPE_TABS[0]?.id || null);
        }
    }, [activeView, FILE_TYPE_TABS, activeTab]);

    const gameTabRefs = useRef([]);
    const gameGliderRef = useRef(null);
    const fileTypeTabRefs = useRef([]);
    const fileTypeGliderRef = useRef(null);
    const activeGameColor = getGameColor(registryGames.find(g => g.name === activeGame)?.id);
    
    const handleScan = useCallback(async (basePath, options = {}) => {
        if (!basePath) return;
        pendingMetadataUpdatesRef.current.clear();
        if (!options.preserveResults) {
            setLoading(true);
            setScanResults(null);
        }
        if (window.electronAPI) {
            try {
                const indexed = await window.electronAPI.scanGames(basePath, {
                    forceMetadataRefresh: options.forceMetadataRefresh === true,
                    dlcCatalogs: getCachedFrontierDlcCatalogs(),
                });
                const { __metadataProgress: progress, ...filesByGame } = indexed || {};
                let merged = filesByGame;
                let latestProgress = progress;
                for (const update of pendingMetadataUpdatesRef.current.values()) {
                    merged = applyMetadataUpdate(merged, update);
                    if (update.progress) latestProgress = update.progress;
                }
                setScanResults(merged);
                setScanProgress(latestProgress || { completed: 0, total: 0, running: false });
            } catch (error) {
                console.error("Error scanning games:", error);
                alert(`An error occurred: ${error.message}`);
            }
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onFrontierMetadataUpdated) return undefined;
        return window.electronAPI.onFrontierMetadataUpdated(update => {
            pendingMetadataUpdatesRef.current.set(update.filePath, update);
            setScanResults(current => applyMetadataUpdate(current, update));
            if (update.progress) setScanProgress(update.progress);
        });
    }, []);

    useEffect(() => {
        const loadStoredPath = async () => {
            try {
                if (!window.electronAPI?.getStoredPath) {
                    throw new Error('The local file bridge is unavailable. Please restart the desktop client.');
                }
                const path = await window.electronAPI.getStoredPath();
                if (path) {
                    setSelectedPath(path);
                    await handleScan(path);
                }
            } catch (error) {
                console.error('Could not load the configured game folder:', error);
                setPathSelectionError(error.message || 'The configured game folder could not be loaded.');
            } finally {
                setLoading(false);
            }
        };
        void loadStoredPath();
    }, [handleScan]);

    const handleBackupCreated = () => {
        setBackupRefreshKey(key => key + 1);
    };

    useEffect(() => {
        const handleBackupsUpdated = () => {
            setBackupRefreshKey(key => key + 1);
        };

        if (window.electronAPI?.onBackupsUpdated) {
            const unsubscribe = window.electronAPI.onBackupsUpdated(handleBackupsUpdated);
            return () => {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            };
        }
    }, []);
    
    const handleAutoImport = useCallback(async (filePath) => {
        if (!filePath || !window.electronAPI) return;

        setGlobalLoader({ isLoading: true, message: `Importing file...` });
        try {
            const result = await window.electronAPI.importBackupFromPath(filePath);
            setGlobalLoader({ isLoading: false, message: '' });

            if (result.status === 'canceled' || !result.message) return;

            if (result.status === 'invalid') {
                alert(`SIGNATURE INVALID: ${result.message}`);
                return;
            }

            let confirmed = true;
            if (result.status === 'unsigned') {
                confirmed = window.confirm('WARNING: This backup is not signed. It should only be used if you created it yourself or received it from a trusted source.\n\nDo you want to continue importing this backup?');
            }

            if (confirmed) {
                alert(result.message);
                if (result.success) {
                    handleBackupCreated();
                }
            }
        } catch (error) {
            setGlobalLoader({ isLoading: false, message: '' });
            alert(`Import failed: ${error.message}`);
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onFileImportTriggered) {
            const unsubscribe = window.electronAPI.onFileImportTriggered(handleAutoImport);
            window.electronAPI.reportClientDashboardReady?.().catch(() => {});
            return () => {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            };
        }
    }, [handleAutoImport]);
    
    const handleSelectFolder = async () => {
        setIsSettingsOpen(false);
        setPathSelectionError(null);
        setSelectingPath(true);
        try {
            const selectFolder = window.electronAPI?.selectFrontierFolder || window.electronAPI?.selectFolder;
            if (!selectFolder) {
                throw new Error('The game-folder picker is unavailable. Please restart or update the desktop client.');
            }
            const path = await selectFolder();
            if (path) {
                setSelectedPath(path);
                await handleScan(path);
            }
        } catch (error) {
            console.error('Could not select the game folder:', error);
            setPathSelectionError(error.message || 'The game folder could not be selected.');
        } finally {
            setSelectingPath(false);
        }
    };
    
    const handleOpenBackupFolder = () => {
        window.electronAPI.openBackupFolder();
        setIsSettingsOpen(false);
    };

    const handleRefreshAllStats = () => {
        if (selectedPath) {
            handleScan(selectedPath, { forceMetadataRefresh: true, preserveResults: true });
        }
        setIsSettingsOpen(false);
    };
    
    const handleLoadExternalBackup = async () => {
        const result = await window.electronAPI.loadExternalBackup();
        if (result.status === 'canceled' || !result.message) return;
    
        if (result.status === 'invalid') {
            alert(`SIGNATURE INVALID: ${result.message}`);
            return;
        }
    
        let confirmed = true;
        if (result.status === 'unsigned') {
            confirmed = window.confirm('WARNING: This backup is not signed. It should only be used if you created it yourself or received it from a trusted source.\n\nDo you want to continue importing this backup?');
        }
    
        if (confirmed) {
            alert(result.message);
            if (result.success) {
                handleBackupCreated();
            }
        }
        setIsSettingsOpen(false);
    };
    
    const handleImportMediaBackup = async () => {
        const result = await window.electronAPI.importMediaBackup();
        alert(result.message);
        if (result.success) {
            handleScan(selectedPath);
        }
        setIsSettingsOpen(false);
    };
    
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (settingsRef.current && !settingsRef.current.contains(event.target)) {
                setIsSettingsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const subHeaderProps = { gameTabs: GAME_TABS, activeGame, setActiveGame, gameTabRefs, gameGliderRef, fileTypeTabs: FILE_TYPE_TABS, activeTab, setActiveTab, fileTypeTabRefs, fileTypeGliderRef, activeGameColor };
    
    const MAIN_TABS = useMemo(() => [ { id: 'backup', name: 'Backup' }, { id: 'restore', name: 'Restore' }, { id: 'workshop', name: 'Workshop' }, { id: 'media', name: 'Media Manager' }, ], []);
    const mainTabRefs = useRef([]);
    const mainGliderRef = useRef(null);

    useEffect(() => {
        const activeTabIndex = MAIN_TABS.findIndex(tab => tab.id === activeView);
        const activeTabNode = mainTabRefs.current[activeTabIndex];
        if (activeTabNode && mainGliderRef.current) {
            mainGliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            mainGliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [activeView, MAIN_TABS]);

    const renderActiveView = () => {
        const props = { user, scanResults, loading, selectedPath, subHeaderProps, setGlobalLoader };
        switch(activeView) {
            case 'backup':
                return <FileBrowser onBackupCreated={handleBackupCreated} refreshKey={backupRefreshKey} {...props} />;
            case 'restore':
                return <BackupRestore refreshKey={backupRefreshKey} activeView={activeView} {...props} />;
            case 'workshop':
                return <BackupRestore refreshKey={backupRefreshKey} activeView={activeView} {...props} />;
            case 'media':
                return <MediaManager {...props} />;
            default:
                return null;
        }
    };
    
    return (
        <div className="offline-manager h-full flex flex-col bg-gray-800 text-white overflow-hidden" style={activeGameColor.style}>
            {globalLoader.isLoading && <GlobalLoader message={globalLoader.message} />}
            
            <div className="p-4 flex justify-between items-center flex-shrink-0">
                <div className="flex-1">
                    {scanProgress.running && <p className="text-xs text-blue-300">Analyzing files {scanProgress.completed} / {scanProgress.total}</p>}
                </div>
                <div className="flex-1 flex justify-center">
                    <div className="relative flex items-center bg-gray-900 rounded-full p-1 shadow-inner overflow-x-auto">
                        <div ref={mainGliderRef} className={`absolute h-full rounded-full ${activeGameColor.bg} transition-all duration-500 ease-in-out`} />
                        {MAIN_TABS.map((tab, index) => (
                            <button key={tab.id} ref={el => mainTabRefs.current[index] = el} onClick={() => { setActiveView(tab.id); if (tab.id === 'workshop') setActiveTab('all'); }} className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${ activeView === tab.id ? 'text-white offline-active-tab' : 'text-gray-300 hover:text-white'}`}>
                                {tab.name}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex-1 flex justify-end">
                    <div className="relative" ref={settingsRef}>
                        <button onClick={() => setIsSettingsOpen(prev => !prev)} title="Settings" className="bg-gray-700 hover:bg-gray-600 text-white font-bold p-2 rounded-full">
                            <Icon path={ICONS.cog} className="w-6 h-6" />
                        </button>
                        {isSettingsOpen && (
                            <div className="absolute top-full right-0 mt-2 w-64 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50">
                                <ul className="text-sm text-white">
                                    <li onClick={handleSelectFolder} className="px-4 py-3 hover:bg-gray-600 cursor-pointer rounded-t-lg">Change Game Files Path</li>
                                    <li onClick={handleRefreshAllStats} className="px-4 py-3 hover:bg-gray-600 cursor-pointer">Refresh all stats</li>
                                    <li onClick={handleLoadExternalBackup} className="px-4 py-3 hover:bg-gray-600 cursor-pointer">Import Backup</li>
                                    <li onClick={handleImportMediaBackup} className="px-4 py-3 hover:bg-gray-600 cursor-pointer">Import Media Backup</li>
                                    <li onClick={handleOpenBackupFolder} className="px-4 py-3 hover:bg-gray-600 cursor-pointer rounded-b-lg">Open Backup Folder</li>
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
                {loading ? (
                    <div className="flex h-full items-center justify-center"><Spinner /></div>
                ) : !selectedPath ? (
                    <div className="flex h-full items-center justify-center p-6">
                        <div className="max-w-xl rounded-2xl border border-gray-600 bg-gray-900 p-8 text-center shadow-xl">
                            <Icon path={ICONS.database} className="mx-auto h-12 w-12 text-blue-300" />
                            <h2 className="mt-4 text-xl font-bold">Choose your Frontier game folder</h2>
                            <p className="mt-3 text-sm leading-6 text-gray-300">
                                Select the <strong>Frontier Developments</strong> folder that contains your Planet Coaster 2 or Planet Zoo saves. It is normally located under <strong>Saved Games</strong>. The client only scans supported game and backup files inside this folder.
                            </p>
                            {pathSelectionError && <p role="alert" className="mt-4 rounded-lg bg-red-950/70 p-3 text-sm text-red-200">{pathSelectionError}</p>}
                            <button type="button" onClick={handleSelectFolder} disabled={selectingPath} className={`mt-6 rounded-lg px-5 py-3 font-semibold text-white ${activeGameColor.bg} disabled:cursor-wait disabled:opacity-60`}>
                                {selectingPath ? 'Opening folder picker…' : 'Select Game Files Path'}
                            </button>
                            <p className="mt-3 text-xs text-gray-400">Recommended: Saved Games\\Frontier Developments</p>
                        </div>
                    </div>
                ) : renderActiveView()}
            </div>
        </div>
    );
};

export default ClientDashboard;
