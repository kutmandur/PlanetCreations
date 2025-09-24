import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS, getGameColor } from '../../utils/helpers';
import BackupNoteModal from '../ui/BackupNoteModal';

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const GlobalLoader = ({ message }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center z-[100]">
        <Spinner />
        {message && <p className="text-white text-lg mt-4 font-semibold">{message}</p>}
    </div>
);

const ToggleSwitch = ({ isToggled, onToggle, labels }) => {
    return (
        <div className="flex items-center space-x-3">
            {labels && <span className={`font-semibold text-sm ${!isToggled ? 'text-white' : 'text-gray-400'}`}>{labels.off}</span>}
            <div
                onClick={onToggle}
                className={`relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 ${isToggled ? 'bg-green-500' : 'bg-gray-600'}`}
            >
                <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${isToggled ? 'translate-x-6' : 'translate-x-0'}`}></div>
            </div>
            {labels && <span className={`font-semibold text-sm ${isToggled ? 'text-white' : 'text-gray-400'}`}>{labels.on}</span>}
        </div>
    );
};

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
            <div className="p-2 flex items-center justify-center">
                <div className="relative flex items-center bg-gray-900 rounded-full p-1 shadow-inner">
                    <div ref={gameGliderRef} className={`absolute h-full rounded-full ${activeGameColor.bg} transition-all duration-500 ease-in-out`} />
                    {gameTabs.map((tab, index) => (
                        <button key={tab.id} ref={el => gameTabRefs.current[index] = el} onClick={() => setActiveGame(tab.id)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${ activeGame === tab.id ? 'text-white' : 'text-gray-300 hover:text-white'}`}>
                            {tab.name}
                        </button>
                    ))}
                </div>
            </div>
            <div className="p-4 flex items-center justify-center">
                <div className="relative flex items-center bg-gray-900 p-1 rounded-full mx-auto">
                    <div ref={fileTypeGliderRef} className={`absolute h-full rounded-full ${activeGameColor.bg} transition-all duration-500 ease-in-out`} />
                    {fileTypeTabs.map((tab, index) => (
                        <button key={tab.id} ref={el => fileTypeTabRefs.current[index] = el} onClick={() => setActiveTab(tab.id)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-semibold text-sm ${ activeTab === tab.id ? 'text-white' : 'text-gray-300 hover:text-white'}`}>
                            {tab.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

const FilterControls = ({ searchTerm, setSearchTerm, sortOption, setSortOption, sortOptions, showBackupAll, onBackupAll, showBackupSelected, onBackupSelected, selectedCount = 0, showRestoreSelected, onRestoreSelected }) => (
    <div className="px-6 py-4 flex items-center justify-between flex-shrink-0 bg-gray-800">
        <div className="flex-1 flex items-center space-x-2">
            {showBackupAll && (
                <button 
                    onClick={onBackupAll}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-sm"
                >
                    Backup All
                </button>
            )}
             {showBackupSelected && (
                <button 
                    onClick={onBackupSelected}
                    disabled={selectedCount === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Backup Selected ({selectedCount})
                </button>
            )}
            {showRestoreSelected && (
                <button
                    onClick={onRestoreSelected}
                    disabled={selectedCount === 0}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Restore Selected ({selectedCount})
                </button>
            )}
        </div>
        <div className="relative w-1/3 flex-1 mx-4">
             <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Icon path={ICONS.search} className="w-5 h-5 text-gray-400" />
            </span>
            <input
                type="text"
                placeholder="Search by name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-gray-700 text-white rounded-md pl-10 pr-8 py-1.5 w-full outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchTerm && (
                <button 
                    onClick={() => setSearchTerm('')} 
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
                >
                    <Icon path={"M6 18L18 6M6 6l12 12"} className="w-5 h-5" />
                </button>
            )}
        </div>
        <div className="flex items-center flex-1 justify-end">
            <label htmlFor="sort-select" className="text-sm font-semibold text-gray-400 mr-3">Sort by:</label>
            <select
                id="sort-select"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                className="bg-gray-700 text-white rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
                {sortOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
        </div>
    </div>
);

const MediaPreviewModal = ({ file, onClose }) => {
    const [dataUrl, setDataUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const getFileExtension = (filename) => {
        const lastDot = filename.lastIndexOf('.');
        if (lastDot === -1) return '';
        return filename.substring(lastDot).toLowerCase();
    };

    const fileType = useMemo(() => {
        const ext = getFileExtension(file.name);
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
        if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
        if (['.mp3', '.ogg', '.wav'].includes(ext)) return 'audio';
        return 'unsupported';
    }, [file.name]);
    
    useEffect(() => {
        const loadFile = async () => {
            if (!file || !window.electronAPI) return;
            setLoading(true); setError(null);
            try {
                const url = await window.electronAPI.readFileAsDataURL(file.path);
                if (url) { setDataUrl(url); } else { setError('Could not load file for preview.'); }
            } catch (err) { setError(`An error occurred: ${err.message}`);
            } finally { setLoading(false); }
        };
        loadFile();
    }, [file]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[60] p-4" onClick={onClose}>
            <div className="bg-gray-900 p-4 rounded-lg shadow-xl max-w-4xl max-h-[80vh] w-full border border-gray-700 flex flex-col" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold mb-3 text-white truncate" title={file.name}>Preview: {file.name}</h3>
                <div className="flex-grow flex items-center justify-center bg-black rounded">
                    {loading && <Spinner />}
                    {error && <p className="text-red-400">{error}</p>}
                    {!loading && !error && dataUrl && (
                        <>
                            {fileType === 'image' && <img src={dataUrl} alt={file.name} className="max-w-full max-h-[70vh] object-contain"/>}
                            {fileType === 'video' && <video src={dataUrl} controls autoPlay className="max-w-full max-h-[70vh] outline-none"/>}
                            {fileType === 'audio' && <audio src={dataUrl} controls autoPlay className="w-full"/>}
                            {fileType === 'unsupported' && <p className="text-yellow-400">Preview for this file type is not supported.</p>}
                        </>
                    )}
                </div>
                 <button onClick={onClose} className="mt-4 bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-lg self-center">Close</button>
            </div>
        </div>
    );
};

const MEDIA_TYPES = {
    pictures: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
    videos: ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
    audio: ['.mp3', '.ogg', '.wav', '.flac'],
};
const TABS = [{id: 'all', name: 'All'}, {id: 'pictures', name: 'Pictures'}, {id: 'videos', name: 'Videos'}, {id: 'audio', name: 'Audio'}];

const FilterTabs = ({ activeTab, setActiveTab }) => (
    <div className="w-full flex justify-center mb-2">
        <div className="flex items-center bg-gray-800 rounded-full p-1 shadow-inner">
            {TABS.map(tab => (
                 <button 
                    key={tab.id} 
                    onClick={() => setActiveTab(tab.id)} 
                    className={`py-1 px-4 rounded-full text-sm font-semibold transition-colors duration-300 ${activeTab === tab.id ? 'bg-blue-500 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
                 >
                    {tab.name}
                </button>
            ))}
        </div>
    </div>
);

const MediaList = React.forwardRef(({ title, files, action, actionIcon, onPreviewClick }, ref) => (
    <div>
        <h4 className="font-semibold mb-2">{title} ({files.length})</h4>
        <div ref={ref} className="h-64 overflow-auto bg-gray-800 p-2 rounded-lg border border-gray-700">
            {files.length === 0 && <p className="text-center text-gray-500 text-sm mt-4">No files</p>}
            {files.map(media => (
                <div key={media.path} className="flex items-center justify-between p-1.5 rounded hover:bg-gray-700 group">
                    <div className="flex items-center min-w-0">
                       <button onClick={() => onPreviewClick(media)} className="mr-2 text-gray-400 hover:text-white flex-shrink-0"><Icon path={ICONS.eye} className="w-4 h-4" /></button>
                       <span className="text-xs truncate" title={media.name}>{media.name}</span>
                    </div>
                    <button onClick={() => action(media)} className="text-xl font-bold ml-2 leading-none text-gray-400 group-hover:text-white opacity-50 group-hover:opacity-100">{actionIcon}</button>
                </div>
            ))}
        </div>
    </div>
));

const MediaSnapshotModal = ({ file, gameName, onClose, onSave }) => {
    const [associatedMedia, setAssociatedMedia] = useState([]);
    const [availableMedia, setAvailableMedia] = useState([]);
    const [loading, setLoading] = useState(true);
    const [previewFile, setPreviewFile] = useState(null);
    const [activeMediaType, setActiveMediaType] = useState('all');
    const [mediaSearchTerm, setMediaSearchTerm] = useState('');
    const availableListRef = useRef(null);
    const associatedListRef = useRef(null);
    const scrollPositionsRef = useRef({ available: 0, associated: 0 });

    useLayoutEffect(() => {
        if (availableListRef.current) { availableListRef.current.scrollTop = scrollPositionsRef.current.available; }
        if (associatedListRef.current) { associatedListRef.current.scrollTop = scrollPositionsRef.current.associated; }
    }, [availableMedia, associatedMedia]);
    
    useEffect(() => {
        const fetchMediaData = async () => {
            if (window.electronAPI) {
                setLoading(true);
                const snapshot = await window.electronAPI.getMediaSnapshot(file.path);
                const allMedia = await window.electronAPI.scanAllMediaFiles();
                const gameMedia = allMedia.filter(m => m.game === gameName);
                const associatedNames = snapshot ? snapshot.files : [];
                const associated = gameMedia.filter(m => associatedNames.includes(m.name));
                const available = gameMedia.filter(m => !associatedNames.includes(m.name));
                setAssociatedMedia(associated.sort((a, b) => a.name.localeCompare(b.name)));
                setAvailableMedia(available.sort((a, b) => a.name.localeCompare(b.name)));
                setLoading(false);
            }
        };
        fetchMediaData();
    }, [file, gameName]);
    
    const processedMedia = useMemo(() => {
        const processList = (list) => {
            let filtered = list;
            if (activeMediaType !== 'all') {
                const extensions = MEDIA_TYPES[activeMediaType];
                if (extensions) {
                    filtered = filtered.filter(mediaFile => {
                        const lastDot = mediaFile.name.lastIndexOf('.');
                        if (lastDot === -1) return false;
                        const extension = mediaFile.name.substring(lastDot).toLowerCase();
                        return extensions.includes(extension);
                    });
                }
            }
            if (mediaSearchTerm) {
                filtered = filtered.filter(mediaFile => mediaFile.name.toLowerCase().includes(mediaSearchTerm.toLowerCase()));
            }
            return filtered;
        };
        return {
            available: processList(availableMedia),
            associated: processList(associatedMedia),
        };
    }, [activeMediaType, availableMedia, associatedMedia, mediaSearchTerm]);

    const moveToAssociated = (mediaFile) => {
        if (availableListRef.current) { scrollPositionsRef.current.available = availableListRef.current.scrollTop; }
        setAvailableMedia(prev => prev.filter(m => m.path !== mediaFile.path));
        setAssociatedMedia(prev => [...prev, mediaFile].sort((a, b) => a.name.localeCompare(b.name)));
    };
    const moveToAvailable = (mediaFile) => {
        if (associatedListRef.current) { scrollPositionsRef.current.associated = associatedListRef.current.scrollTop; }
        setAssociatedMedia(prev => prev.filter(m => m.path !== mediaFile.path));
        setAvailableMedia(prev => [...prev, mediaFile].sort((a, b) => a.name.localeCompare(b.name)));
    };
    const handlePreviewClick = (mediaFile) => {
        if (availableListRef.current) { scrollPositionsRef.current.available = availableListRef.current.scrollTop; }
        if (associatedListRef.current) { scrollPositionsRef.current.associated = associatedListRef.current.scrollTop; }
        setPreviewFile(mediaFile);
    };
    const handleAddAll = () => {
        const toMove = processedMedia.available;
        setAssociatedMedia(prev => [...prev, ...toMove].sort((a, b) => a.name.localeCompare(b.name)));
        setAvailableMedia(prev => prev.filter(m => !toMove.find(moved => moved.path === m.path)));
    };
    const handleRemoveAll = () => {
        const toMove = processedMedia.associated;
        setAvailableMedia(prev => [...prev, ...toMove].sort((a, b) => a.name.localeCompare(b.name)));
        setAssociatedMedia(prev => prev.filter(m => !toMove.find(moved => moved.path === m.path)));
    };
    const handleSave = () => { const associatedPaths = associatedMedia.map(m => m.path); onSave(file.path, associatedPaths); };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
            {previewFile && <MediaPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
            <div className="bg-gray-900 p-6 rounded-lg shadow-xl max-w-5xl w-full border border-gray-700">
                <h3 className="text-xl font-bold mb-4 text-white">Manage Media for <span className="text-yellow-400">{file.name}</span></h3>
                {loading ? <Spinner /> : (
                    <div>
                        <FilterTabs activeTab={activeMediaType} setActiveTab={setActiveMediaType}/>
                        <div className="relative w-full mb-4">
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"><Icon path={ICONS.search} className="w-5 h-5 text-gray-400" /></span>
                            <input type="text" placeholder="Search in both lists..." value={mediaSearchTerm} onChange={(e) => setMediaSearchTerm(e.target.value)} className="bg-gray-700 text-white rounded-md pl-10 pr-8 py-1.5 w-full outline-none focus:ring-2 focus:ring-blue-500" />
                            {mediaSearchTerm && ( 
                                <button onClick={() => setMediaSearchTerm('')} className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white">
                                    <Icon path={"M6 18L18 6M6 6l12 12"} className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
                           <MediaList ref={availableListRef} title={`Available Media Files (${gameName})`} files={processedMedia.available} action={moveToAssociated} actionIcon={'>'} onPreviewClick={handlePreviewClick}/>
                            <div className="flex flex-col space-y-4 pt-8">
                                <button onClick={handleAddAll} disabled={processedMedia.available.length === 0} className="bg-green-500 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors">Add All &gt;&gt;</button>
                                <button onClick={handleRemoveAll} disabled={processedMedia.associated.length === 0} className="bg-red-500 hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors">&lt;&lt; Remove All</button>
                            </div>
                           <MediaList ref={associatedListRef} title="Associated Media" files={processedMedia.associated} action={moveToAvailable} actionIcon={'<'} onPreviewClick={handlePreviewClick}/>
                        </div>
                    </div>
                )}
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onClose} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-lg">Cancel</button>
                    <button onClick={handleSave} disabled={loading} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg">Save Snapshot</button>
                </div>
            </div>
        </div>
    );
};

const FileBrowser = ({ onBackupCreated, scanResults, loading, selectedPath, subHeaderProps, setGlobalLoader, refreshKey }) => {
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

    const handleBackupClick = (file) => { setBackupModalState({ isOpen: true, file: file, isBatch: false }); };
    const handleBackupAllClick = () => { setBackupModalState({ isOpen: true, file: null, isBatch: true }); };
    const handleBackupSelectedClick = () => {
        const filesToBackup = processedFiles.filter(f => selectedFiles.has(f.path));
        setBackupModalState({ isOpen: true, file: null, isBatch: true, selectedFiles: filesToBackup });
    };
    
    const handleConfirmBackup = async (note) => {
        const { file, isBatch, selectedFiles: filesForBatch } = backupModalState;
        setBackupModalState({ isOpen: false, file: null, isBatch: false, selectedFiles: [] });

        if (isBatch) {
            const filesToBackup = filesForBatch && filesForBatch.length > 0 ? filesForBatch : processedFiles;
            if (filesToBackup.length === 0) return;
            setGlobalLoader({ isLoading: true, message: `Backing up ${filesToBackup.length} creation(s)...` });
            try {
                const result = await window.electronAPI.backupAllCreations(filesToBackup, note);
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
            setBackingUpFile(file.path);
            setGlobalLoader({ isLoading: true, message: `Backing up ${file.name}...` });
            try {
                const success = await window.electronAPI.createBackup(file.path, note);
                if (success) {
                    alert(`Backup for "${file.name}" created successfully!`);
                    if(onBackupCreated) onBackupCreated();
                } else { alert('Failed to create backup.'); }
            } catch (error) { alert(`An error occurred: ${error.message}`); 
            } finally { setBackingUpFile(null); setGlobalLoader({ isLoading: false, message: '' }); }
        }
    };
    
    return (
        <div className="flex flex-col h-full bg-gray-800">
            {backupModalState.isOpen && (<BackupNoteModal onConfirm={handleConfirmBackup} onCancel={() => setBackupModalState({ isOpen: false, file: null, isBatch: false, selectedFiles: [] })} />)}
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
                    <div className="flex h-full items-center justify-center">
                        <p className="text-gray-400">Please select the 'Frontier Developments' folder to begin.</p>
                    </div>
                ) : loading ? (
                    <div className="flex h-full items-center justify-center">
                        <Spinner />
                    </div>
                ) : (
                    <FileList 
                        files={processedFiles} 
                        viewMode="backup" 
                        onBackupClick={handleBackupClick} 
                        backingUpFile={backingUpFile}
                        allBackups={allBackups}
                        selectedItems={selectedFiles}
                        onToggleSelection={handleToggleSelection}
                    />
                )}
            </div>
        </div>
    );
};

const FileList = ({ files, viewMode, onBackupClick, onManageMediaClick, onInstallMedia, onUninstallMedia, onDeleteMediaClick, mediaStatus, snapshotStatus, onBackupMediaClick, backingUpFile, backingUpMediaFile, allBackups, selectedItems, onToggleSelection }) => {
    if (!files || files.length === 0) {
        return <p className="text-gray-400 text-center mt-8">No files of this type found.</p>;
    }
    return ( <div className="space-y-3"> {files.map(file => { const displayName = file.name.includes('-') ? file.name.split('-')[0] : file.name.replace(/\.[^/.]+$/, ""); const isInstalled = viewMode === 'media' && mediaStatus && mediaStatus[file.path] === 'installed'; const hasMedia = viewMode === 'media' && snapshotStatus && snapshotStatus[file.path]; const isBackingUp = viewMode === 'backup' && backingUpFile === file.path; const isBackingUpMedia = viewMode === 'media' && backingUpMediaFile === file.path; const baseName = file.name.replace(/\.[^/.]+$/, ""); const backupsForFile = allBackups ? allBackups[baseName] : null; const lastBackupDate = backupsForFile && backupsForFile.length > 0 ? new Date(backupsForFile[0].backupDate) : null; const isSelected = viewMode === 'backup' && selectedItems && selectedItems.has(file.path); return ( <div key={file.path} className={`rounded-lg p-3 flex items-center justify-between transition-colors ${isInstalled ? 'bg-green-900 bg-opacity-40 border-l-4 border-green-500' : 'bg-gray-700 hover:bg-gray-600'}`}> {viewMode === 'backup' && ( <div className="mr-4 flex-shrink-0"> <input type="checkbox" className="h-5 w-5 rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-blue-500" checked={isSelected} onChange={() => onToggleSelection(file.path)} /> </div> )} <div className="flex items-center overflow-hidden flex-grow"> <Icon path={ICONS.document} className="w-6 h-6 text-gray-400 mr-4 flex-shrink-0" /> <div className="truncate"> <p className="font-semibold text-white truncate" title={file.name}>{displayName}</p> <p className="text-sm text-gray-500 truncate">{file.name}</p> </div> </div> <div className="flex items-center space-x-6 flex-shrink-0 ml-4"> <div className="text-center text-sm w-24"> <p className="text-gray-400 text-xs">Size</p> <p className="font-semibold text-white">{formatBytes(file.size)}</p> </div> <div className="text-center text-sm w-32"> <p className="text-gray-400 text-xs">Last Modified</p> <p className="font-semibold text-white">{new Date(file.modifiedAt).toLocaleString()}</p> </div> <div className="text-center text-sm w-32"> <p className="text-gray-400 text-xs">Last Backup</p> <p className="font-semibold text-white">{lastBackupDate ? lastBackupDate.toLocaleString() : 'N/A'}</p> </div> <div className="flex space-x-2 items-center w-auto"> {viewMode === 'backup' && ( <button onClick={() => onBackupClick(file)} disabled={isBackingUp} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-3 rounded text-sm w-20 flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed">{isBackingUp ? '...' : 'Backup'}</button> )} {viewMode === 'media' && ( <> {hasMedia && (<button onClick={() => onBackupMediaClick(file)} disabled={isBackingUpMedia} title="Backup associated media" className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-1 px-3 rounded text-sm w-28 flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed">{isBackingUpMedia ? '...' : 'Backup Media'}</button>)} <button onClick={() => onManageMediaClick(file)} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-1 px-3 rounded text-sm">Manage Media</button> {hasMedia && (<button onClick={() => onDeleteMediaClick(file)} title="Delete associated media" className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm">Delete Media</button>)} <ToggleSwitch isToggled={isInstalled} onToggle={() => isInstalled ? onUninstallMedia(file) : onInstallMedia(file)} /> </> )} </div> </div> </div> ); })} </div> );
};

const DeleteConfirmationModal = ({ item, title, warning, onConfirm, onCancel }) => {
    const [confirmText, setConfirmText] = useState('');
    const canConfirm = confirmText.toLowerCase() === 'delete';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={onCancel}>
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-red-400 mb-4">{title}</h2>
                <p className="mb-4">{warning}</p>
                <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-md p-2"
                    placeholder='Type "DELETE" to confirm'
                />
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 font-bold py-2 px-6 rounded-lg">Cancel</button>
                    <button onClick={onConfirm} disabled={!canConfirm} className="bg-red-600 hover:bg-red-700 font-bold py-2 px-6 rounded-lg disabled:opacity-50">Confirm Delete</button>
                </div>
            </div>
        </div>
    );
};

const DeleteMediaModal = ({ file, onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={onCancel}>
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-xl" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-2">Delete Media for: {file.name}</h2>
                <p className="text-gray-400 mb-6">Choose your deletion method. This action cannot be undone.</p>
                <div className="space-y-4">
                    <button onClick={() => onConfirm('safe')} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-4 rounded-lg">
                        <h3 className="font-bold text-green-400">Safe Delete (Recommended)</h3>
                        <p className="text-sm text-gray-300">Deletes associated media files that are **NOT** used by any other of your creations.</p>
                    </button>
                    <button onClick={() => onConfirm('force')} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-4 rounded-lg">
                        <h3 className="font-bold text-red-400">Force Delete</h3>
                        <p className="text-sm text-gray-300">Deletes **ALL** associated media files, even if they are used by your other creations. This might break other blueprints.</p>
                    </button>
                </div>
                 <div className="flex justify-end mt-6">
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 font-bold py-2 px-6 rounded-lg">Cancel</button>
                </div>
            </div>
        </div>
    );
};

const BackupRestore = ({ refreshKey, subHeaderProps, setGlobalLoader }) => {
    const [allBackups, setAllBackups] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('date_desc');
    const [deleteModalState, setDeleteModalState] = useState({ isOpen: false, backup: null });
    const [selectedBackups, setSelectedBackups] = useState({});
    const { activeGame, activeTab } = subHeaderProps;
    
    const SORT_OPTIONS = [ { value: 'date_desc', label: 'Date (Newest)' }, { value: 'date_asc', label: 'Date (Oldest)' }, { value: 'name_asc', label: 'Name (A-Z)' }, { value: 'name_desc', label: 'Name (Z-A)' }, { value: 'count_desc', label: 'Backup Count (Most)' }, { value: 'count_asc', label: 'Backup Count (Fewest)' }, ];
    
    const fetchBackups = useCallback(async () => {
        setLoading(true);
        if (window.electronAPI) {
            try {
                const backups = await window.electronAPI.listAllBackups();
                setAllBackups(backups);
            } catch(e){ console.error(e); }
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchBackups();
        setSelectedBackups({});
    }, [fetchBackups, refreshKey, activeGame, activeTab]);

    const processedBackups = useMemo(() => {
        if (!allBackups) return [];
        const gameBackups = Object.entries(allBackups).map(([saveName, backups]) => ({saveName, backups}));
        
        const filteredByType = gameBackups.filter(({saveName, backups}) => {
            const firstBackup = backups[0];
            if (!firstBackup) return false;

            const pathLower = firstBackup.originalFilePath.toLowerCase();
            const gameMatches = (activeGame === 'Planet Coaster 2' && pathLower.includes('planet coaster 2')) || (activeGame === 'Planet Zoo' && pathLower.includes('planet zoo'));
            if (!gameMatches) return false;

            if (activeTab === 'customMedia') {
                return firstBackup.backupType === 'media';
            }

            const fileTypeMatches = (activeTab === 'parks' && (firstBackup.originalFileName.includes('.park2') || firstBackup.originalFileName.endsWith('.zoo'))) ||
                                  (activeTab === 'blueprints' && (firstBackup.originalFileName.endsWith('.blpr2') || firstBackup.originalFileName.endsWith('.pzblueprint'))) ||
                                  (activeTab === 'autosaves' && (firstBackup.originalFileName.endsWith('.prkauto2') || firstBackup.originalFileName.endsWith('.zooauto')));
            return fileTypeMatches;
        });
        
        const filteredByName = filteredByType.filter(item => item.saveName.toLowerCase().includes(searchTerm.toLowerCase()));
        
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
    }, [allBackups, activeGame, activeTab, searchTerm, sortOption]);

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
        const selectedCount = Object.keys(selectedBackups).length;
        if (selectedCount === 0) return;

        const confirmed = window.confirm(`Are you sure you want to restore ${selectedCount} selected backup(s)? This will overwrite current files.`);
        if (confirmed) {
            setGlobalLoader({isLoading: true, message: `Restoring ${selectedCount} backup(s)...`});
            let successCount = 0;
            for (const backup of Object.values(selectedBackups)) {
                const success = await window.electronAPI.restoreBackup(backup.filePath, backup.originalFilePath);
                if (success) successCount++;
            }
            setGlobalLoader({isLoading: false, message: ''});
            alert(`${successCount} of ${selectedCount} backups restored successfully.`);
            setSelectedBackups({});
        }
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
    
    if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
    const hasBackups = processedBackups && processedBackups.length > 0;

    return (
        <div className="flex flex-col h-full bg-gray-800">
            {deleteModalState.isOpen && <DeleteConfirmationModal item={deleteModalState.backup} title="Delete Backup" warning='This action cannot be undone. To confirm, please type "DELETE" in the box below.' onConfirm={handleConfirmDelete} onCancel={() => setDeleteModalState({ isOpen: false, backup: null })} />}
            <SubHeader {...subHeaderProps} />
            <FilterControls 
                searchTerm={searchTerm} setSearchTerm={setSearchTerm} 
                sortOption={sortOption} setSortOption={setSortOption} 
                sortOptions={SORT_OPTIONS} 
                showRestoreSelected={true}
                onRestoreSelected={handleRestoreSelected}
                selectedCount={Object.keys(selectedBackups).length}
            />
            <div className="flex-1 overflow-y-auto p-6 min-h-0 scrollbar-gutter-stable">
                {!hasBackups ? (
                    <div className="flex h-full items-center justify-center">
                        <p className="text-gray-400">No backups found for this category.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {processedBackups.map(({saveName, backups}) => (
                            <div key={saveName} className="bg-gray-700 rounded-lg p-3">
                                <h3 className="font-bold text-lg text-white mb-2">{saveName} ({backups.length})</h3>
                                <div className="space-y-2">
                                    {backups.map(backup => (
                                        <div key={backup.backupDate} className="bg-gray-800 rounded-md p-2 flex justify-between items-center">
                                            <div className="flex items-center">
                                                <input 
                                                    type="checkbox" 
                                                    className="h-5 w-5 rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-blue-500 mr-4"
                                                    checked={selectedBackups[saveName]?.filePath === backup.filePath}
                                                    onChange={() => handleToggleBackupSelection(saveName, backup)}
                                                />
                                                <div>
                                                    <p className="text-xs font-semibold text-white">{new Date(backup.backupDate).toLocaleString()}</p>
                                                    <p className="text-xs text-gray-400 italic">{backup.note || "No note"}</p>
                                                </div>
                                            </div>
                                            <div className="flex space-x-2">
                                                <button onClick={() => handleDeleteClick(backup)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-xs">Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const MediaManager = ({ scanResults, loading, selectedPath, subHeaderProps, setGlobalLoader }) => {
    const [snapshotModalState, setSnapshotModalState] = useState({ isOpen: false, file: null, gameName: null });
    const [mediaStatus, setMediaStatus] = useState({});
    const [snapshotStatus, setSnapshotStatus] = useState({});
    const [statusLoading, setStatusLoading] = useState(false);
    const [backingUpMediaFile, setBackingUpMediaFile] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('modifiedAt_desc');
    const [deleteMediaModalState, setDeleteMediaModalState] = useState({ isOpen: false, file: null });
    const [finalDeleteState, setFinalDeleteState] = useState({ isOpen: false, file: null, mode: null });
    const [allBackups, setAllBackups] = useState(null);
    const { activeGame, activeTab } = subHeaderProps;

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

    const checkStatuses = useCallback(async (files) => { if (!files || !window.electronAPI) return; setStatusLoading(true); const mediaStatusMap = {}, snapshotStatusMap = {}; for (const file of files) { const [media, snapshot] = await Promise.all([ window.electronAPI.getMediaStatus(file.path), window.electronAPI.hasMediaSnapshot(file.path) ]); mediaStatusMap[file.path] = media; snapshotStatusMap[file.path] = snapshot; } setMediaStatus(mediaStatusMap); setSnapshotStatus(snapshotStatusMap); setStatusLoading(false); }, []);
    useEffect(() => { const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) { checkStatuses(currentFiles); } }, [scanResults, activeGame, activeTab, checkStatuses]);
    const handleManageMediaClick = (file) => { setSnapshotModalState({ isOpen: true, file: file, gameName: activeGame }); };
    const handleBackupMediaClick = async (file) => { setBackingUpMediaFile(file.path); setGlobalLoader({ isLoading: true, message: `Backing up media for ${file.name}...` }); try { const result = await window.electronAPI.backupCreationMedia(file.path); alert(result.message); } catch (error) { alert(`An error occurred: ${error.message}`); } finally { setBackingUpMediaFile(null); setGlobalLoader({ isLoading: false, message: '' }); } };
    const handleSaveSnapshot = async (savePath, mediaPaths) => { const fileToInstall = snapshotModalState.file; if (!fileToInstall) { alert('Error: Could not identify the target file.'); return; } const snapshotSuccess = await window.electronAPI.createMediaSnapshot(savePath, mediaPaths); const currentFiles = scanResults?.[activeGame]?.[activeTab]; if (snapshotSuccess) { const installSuccess = await window.electronAPI.installMedia(fileToInstall.path); alert(installSuccess ? 'Snapshot saved and media activated!' : 'Snapshot saved, but activation failed.'); if (currentFiles) { checkStatuses(currentFiles); } } else { alert('Failed to save snapshot.'); } setSnapshotModalState({ isOpen: false, file: null, gameName: null }); };
    const handleInstall = async (file) => { const success = await window.electronAPI.installMedia(file.path); if(success) alert('Media installed!'); else alert('Failed to install media.'); const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) checkStatuses(currentFiles); };
    const handleUninstall = async (file) => { const success = await window.electronAPI.uninstallMedia(file.path); if(success) alert('Media uninstalled!'); else alert('Failed to uninstall media.'); const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) checkStatuses(currentFiles); };
    const handleDeleteMediaClick = (file) => { setDeleteMediaModalState({ isOpen: true, file: file }); };
    const handleDeletionModeSelected = (mode) => { setFinalDeleteState({ isOpen: true, file: deleteMediaModalState.file, mode: mode }); setDeleteMediaModalState({ isOpen: false, file: null }); };
    const handleConfirmMediaDelete = async () => { const { file, mode } = finalDeleteState; if (!file || !mode) return; setGlobalLoader({ isLoading: true, message: `Deleting media for ${file.name}...` }); try { const result = await window.electronAPI.deleteCreationMedia(file.path, mode); alert(result.message); if (result.success) { const currentFiles = scanResults?.[activeGame]?.[activeTab]; if(currentFiles) checkStatuses(currentFiles); } } catch (error) { alert(`An error occurred: ${error.message}`); } finally { setGlobalLoader({ isLoading: false, message: '' }); setFinalDeleteState({ isOpen: false, file: null, mode: null }); } };
    const deleteWarning = finalDeleteState.mode === 'safe' ? "This will delete all associated media for this creation that is NOT used by other creations." : "WARNING: This will delete ALL associated media files, even if they ARE USED by other creations.";

    return (
        <div className="flex flex-col h-full bg-gray-800">
            {snapshotModalState.isOpen && ( <MediaSnapshotModal file={snapshotModalState.file} gameName={snapshotModalState.gameName} onClose={() => setSnapshotModalState({ isOpen: false, file: null, gameName: null })} onSave={handleSaveSnapshot} /> )}
            {deleteMediaModalState.isOpen && <DeleteMediaModal file={deleteMediaModalState.file} onCancel={() => setDeleteMediaModalState({ isOpen: false, file: null })} onConfirm={handleDeletionModeSelected} />}
            {finalDeleteState.isOpen && <DeleteConfirmationModal item={finalDeleteState.file} title={`Confirm ${finalDeleteState.mode.charAt(0).toUpperCase() + finalDeleteState.mode.slice(1)} Delete`} warning={deleteWarning} onConfirm={handleConfirmMediaDelete} onCancel={() => setFinalDeleteState({ isOpen: false, file: null, mode: null })} />}
            <SubHeader {...subHeaderProps} />
            <FilterControls searchTerm={searchTerm} setSearchTerm={setSearchTerm} sortOption={sortOption} setSortOption={setSortOption} sortOptions={SORT_OPTIONS} />
            <div className="flex-1 overflow-y-auto p-6 min-h-0 scrollbar-gutter-stable">
                {!selectedPath && !loading ? (
                    <div className="flex h-full items-center justify-center">
                        <p className="text-gray-400">Please select the 'Frontier Developments' folder to begin.</p>
                    </div>
                ) : loading ? (
                    <div className="flex h-full items-center justify-center">
                        <Spinner />
                    </div>
                ) : (
                    <>
                        {statusLoading && <div className="text-center text-xs text-gray-400 mb-2">Checking statuses...</div>}
                        <FileList files={processedFiles} viewMode="media" onManageMediaClick={handleManageMediaClick} onInstallMedia={handleInstall} onUninstallMedia={handleUninstall} onDeleteMediaClick={handleDeleteMediaClick} mediaStatus={mediaStatus} snapshotStatus={snapshotStatus} onBackupMediaClick={handleBackupMediaClick} backingUpMediaFile={backingUpMediaFile} allBackups={allBackups} />
                    </>
                )}
            </div>
        </div>
    );
};

const ClientDashboard = () => {
    const [activeView, setActiveView] = useState('backup');
    const [backupRefreshKey, setBackupRefreshKey] = useState(0);
    const [scanResults, setScanResults] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedPath, setSelectedPath] = useState(null);
    const [globalLoader, setGlobalLoader] = useState({ isLoading: false, message: '' });

    const GAME_TABS = useMemo(() => [ { id: 'Planet Coaster 2', name: 'Planet Coaster 2' }, { id: 'Planet Zoo', name: 'Planet Zoo' }, ], []);
    const FILE_TYPE_TABS = useMemo(() => {
        const baseTabs = [ { id: 'parks', name: 'Parks' }, { id: 'blueprints', name: 'Blueprints' }, { id: 'autosaves', name: 'Autosaves' }, ];
        if (activeView === 'restore') {
            return [ ...baseTabs, { id: 'customMedia', name: 'Custom Media' }, ];
        }
        return baseTabs;
    }, [activeView]);
    const [activeGame, setActiveGame] = useState(GAME_TABS[0].id);
    const [activeTab, setActiveTab] = useState(FILE_TYPE_TABS[0].id);
    
    useEffect(() => {
        const currentTabExists = FILE_TYPE_TABS.some(tab => tab.id === activeTab);
        if (!currentTabExists) {
            setActiveTab(FILE_TYPE_TABS[0].id);
        }
    }, [activeView, FILE_TYPE_TABS, activeTab]);

    const gameTabRefs = useRef([]);
    const gameGliderRef = useRef(null);
    const fileTypeTabRefs = useRef([]);
    const fileTypeGliderRef = useRef(null);
    const activeGameColor = getGameColor(activeGame === 'Planet Zoo' ? 'planet-zoo' : 'planet-coaster-2');
    
    const handleScan = useCallback(async (basePath) => {
        if (!basePath) return;
        setLoading(true);
        setScanResults(null);
        if (window.electronAPI) {
            try {
                const filesByGame = await window.electronAPI.scanGames(basePath);
                setScanResults(filesByGame);
            } catch (error) {
                console.error("Error scanning games:", error);
                alert(`An error occurred: ${error.message}`);
            }
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        const loadStoredPath = async () => {
            if (window.electronAPI) {
                const path = await window.electronAPI.getStoredPath();
                if (path) {
                    setSelectedPath(path);
                    handleScan(path);
                } else {
                    setLoading(false);
                }
            }
        };
        loadStoredPath();
    }, [handleScan]);
    
    const handleBackupCreated = () => {
        setBackupRefreshKey(key => key + 1);
    };

    const subHeaderProps = { gameTabs: GAME_TABS, activeGame, setActiveGame, gameTabRefs, gameGliderRef, fileTypeTabs: FILE_TYPE_TABS, activeTab, setActiveTab, fileTypeTabRefs, fileTypeGliderRef, activeGameColor };
    
    const MAIN_TABS = useMemo(() => [ { id: 'backup', name: 'Backup' }, { id: 'restore', name: 'Restore' }, { id: 'media', name: 'Media Manager' }, ], []);
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
        const props = { scanResults, loading, selectedPath, subHeaderProps, setGlobalLoader };
        switch(activeView) {
            case 'backup':
                return <FileBrowser onBackupCreated={handleBackupCreated} refreshKey={backupRefreshKey} {...props} />;
            case 'restore':
                return <BackupRestore refreshKey={backupRefreshKey} {...props} />;
            case 'media':
                return <MediaManager {...props} />;
            default:
                return null;
        }
    };
    
    return (
        <div className="h-full flex flex-col bg-gray-800 text-white overflow-hidden">
            {globalLoader.isLoading && <GlobalLoader message={globalLoader.message} />}
            
            <div className="p-4 flex justify-center items-center flex-shrink-0">
                 <div className="relative flex items-center bg-gray-900 rounded-full p-1 shadow-inner">
                    <div ref={mainGliderRef} className={`absolute h-full rounded-full ${activeGameColor.bg} transition-all duration-500 ease-in-out`} />
                    {MAIN_TABS.map((tab, index) => (
                        <button key={tab.id} ref={el => mainTabRefs.current[index] = el} onClick={() => setActiveView(tab.id)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${ activeView === tab.id ? 'text-white' : 'text-gray-300 hover:text-white'}`}>
                            {tab.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
                {renderActiveView()}
            </div>
        </div>
    );
};

export default ClientDashboard;