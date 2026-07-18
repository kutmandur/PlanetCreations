import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';
import { getGameColor, ICONS } from '../../utils/helpers';

const SelectBackupModal = ({ isOpen, onClose, onFileSelect, game }) => {
    const [localFiles, setLocalFiles] = useState(null);
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [activeTab, setActiveTab] = useState('parks');

    const color = getGameColor(game);

    useEffect(() => {
        if (isOpen) {
            const fetchFiles = async () => {
                setLoading(true);
                setSelectedFile(null);
                setActiveTab('parks'); // Reset tab on open
                try {
                    const files = await window.electronAPI.listAllLocalCreationsAndBackups();
                    setLocalFiles(files);
                } catch (error) {
                    console.error("Failed to fetch local files:", error);
                }
                setLoading(false);
            };
            fetchFiles();
        }
    }, [isOpen]);

    const gameFiles = useMemo(() => {
        if (!localFiles || !game) return { parks: [], blueprints: [], autosaves: [], backups: [] };
        
        const gameNameMapping = {
            'planet-coaster-2': 'Planet Coaster 2',
            'planet-zoo': 'Planet Zoo',
            'planet-coaster': 'Planet Coaster', // Add if you have this game
        };
        const mappedGameName = gameNameMapping[game] || game;
        return localFiles[mappedGameName] || { parks: [], blueprints: [], autosaves: [], backups: [] };
    }, [localFiles, game]);

    const tabs = [
        { id: 'parks', name: 'Parks', count: gameFiles.parks?.length || 0 },
        { id: 'blueprints', name: 'Blueprints', count: gameFiles.blueprints?.length || 0 },
        { id: 'backups', name: 'Backups', count: gameFiles.backups?.length || 0 },
        { id: 'autosaves', name: 'Autosaves', count: gameFiles.autosaves?.length || 0 },
    ].filter(tab => tab.count > 0);
    
    useEffect(() => {
        if (tabs.length > 0 && !tabs.find(t => t.id === activeTab)) {
            setActiveTab(tabs[0].id);
        }
    }, [tabs, activeTab]);


    if (!isOpen) return null;

    const renderFileList = (files) => {
        if (!files || files.length === 0) {
            return <p className="text-gray-500 text-center p-4">No files found in this category.</p>;
        }
        return (
            <ul className="space-y-2">
                {files.map(file => (
                    <li key={file.path}>
                        <button
                            onClick={() => setSelectedFile(file)}
                            className={`w-full text-left p-3 rounded-lg flex justify-between items-center transition-colors duration-150 ${selectedFile?.path === file.path ? `${color.bg} text-white shadow` : 'hover:bg-gray-100'}`}
                        >
                            <div>
                                <p className="font-semibold">{file.name}</p>
                                <p className={`text-xs ${selectedFile?.path === file.path ? 'text-gray-200' : 'text-gray-500'}`}>
                                    {new Date(file.modifiedAt).toLocaleString()}
                                </p>
                            </div>
                            {selectedFile?.path === file.path && <Icon path={ICONS.checkCircle} className="w-6 h-6" />}
                        </button>
                    </li>
                ))}
            </ul>
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4" onClick={onClose} style={color.style}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold">Select a Creation File</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">&times;</button>
                </div>
                
                {loading ? (
                    <div className="flex-grow flex justify-center items-center p-8"><Spinner /></div>
                ) : (
                    <>
                        <div className="p-2 border-b">
                            <div className="flex space-x-2">
                                {tabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${activeTab === tab.id ? `${color.bg} text-white` : 'text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        {tab.name} ({tab.count})
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex-grow p-4 overflow-y-auto">
                            {activeTab === 'parks' && renderFileList(gameFiles.parks)}
                            {activeTab === 'blueprints' && renderFileList(gameFiles.blueprints)}
                            {activeTab === 'backups' && renderFileList(gameFiles.backups)}
                            {activeTab === 'autosaves' && renderFileList(gameFiles.autosaves)}
                        </div>
                    </>
                )}

                <div className="p-4 border-t flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 font-semibold">
                        Cancel
                    </button>
                    <button
                        onClick={() => onFileSelect(selectedFile)}
                        disabled={!selectedFile || loading}
                        className={`px-4 py-2 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${color.bg} ${color.hoverBg}`}
                    >
                        Confirm Selection
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SelectBackupModal;