
import React, { useState, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import MediaPreviewModal from './MediaPreviewModal';

const MEDIA_TYPES = {
    images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    videos: ['.mp4', '.webm', '.mov'],
    audio: ['.mp3', '.ogg'],
};

const FilterTabs = ({ activeTab, setActiveTab }) => {
    const tabs = ['all', 'images', 'videos', 'audio'];
    return (
        <div className="flex items-center justify-center space-x-2 mb-4">
            {tabs.map(tab => (
                <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                        activeTab === tab
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
            ))}
        </div>
    );
};

const MediaList = React.forwardRef(({ title, files, action, actionIcon, onPreviewClick }, ref) => (
    <div className="bg-gray-800 p-3 rounded-lg border border-gray-700 flex flex-col h-[50vh]">
        <h4 className="text-lg font-semibold mb-2 text-white sticky top-0 bg-gray-800 py-1">{title}</h4>
        <div ref={ref} className="overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 flex-grow">
            {files.length > 0 ? (
                <ul className="space-y-2">
                    {files.map(mediaFile => (
                        <li key={mediaFile.path} className="flex items-center justify-between bg-gray-700 p-2 rounded-md">
                            <span className="truncate text-sm text-gray-300 flex-grow" title={mediaFile.name}>{mediaFile.name}</span>
                            <div className="flex items-center space-x-2 ml-2 flex-shrink-0">
                                <button onClick={() => onPreviewClick(mediaFile)} className="text-gray-400 hover:text-white p-1" title="Preview">
                                     <Icon path={ICONS.eye} className="w-4 h-4" />
                                </button>
                                <button onClick={() => action(mediaFile)} className="bg-gray-600 hover:bg-gray-500 text-white font-bold w-6 h-6 rounded-full flex items-center justify-center text-sm">
                                    {actionIcon}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-gray-500 text-center text-sm pt-4">No files.</p>
            )}
        </div>
    </div>
));
MediaList.displayName = 'MediaList';

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
                                    <Icon path={ICONS.xMark} className="w-5 h-5" />
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

export default MediaSnapshotModal;
