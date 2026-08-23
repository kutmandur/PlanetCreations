import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';
import { getGameColor, ICONS } from '../../utils/helpers';
import { getGameDisplayName, getGames } from '../../utils/gamesRegistry';

const EMPTY_FILES = { parks: [], blueprints: [], autosaves: [], backups: [] };

function fileKindLabel(file) {
    if (file?.isBackup) return 'PlanetCreations backup';
    const kind = file?.frontierMetadata?.kind;
    if (kind === 'park') return 'Park save';
    if (kind === 'blueprint') return 'Blueprint';
    if (kind === 'autosave') return 'Autosave';
    if (String(file?.name || '').toLowerCase().endsWith('.planetcreations')) return 'PlanetCreations backup';
    return 'Creation file';
}

const SelectBackupModal = ({
    isOpen,
    onClose,
    onFileSelect,
    game,
    allowGameSelection = false,
}) => {
    const [localFiles, setLocalFiles] = useState(null);
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [activeTab, setActiveTab] = useState('parks');
    const [selectedGameId, setSelectedGameId] = useState(game);
    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [metadataLoading, setMetadataLoading] = useState(false);
    const [metadataError, setMetadataError] = useState(null);
    const [configurationError, setConfigurationError] = useState(null);

    const effectiveGameId = allowGameSelection ? selectedGameId : game;
    const color = getGameColor(effectiveGameId || game);

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        setSelectedFile(null);
        setPreview(null);
        setMetadataError(null);
        setConfigurationError(null);
        setActiveTab('parks');
        setSelectedGameId(game);
        try {
            const files = await window.electronAPI.listAllLocalCreationsAndBackups();
            setLocalFiles(files);
            if (allowGameSelection) {
                const options = getGames().filter(entry => {
                    const groups = files?.[entry.name];
                    return groups && Object.values(groups).some(items => Array.isArray(items) && items.length > 0);
                });
                if (!options.some(entry => entry.id === game)) setSelectedGameId(options[0]?.id || game);
            }
        } catch (error) {
            console.error('Failed to fetch local files:', error);
            setLocalFiles({});
        } finally {
            setLoading(false);
        }
    }, [allowGameSelection, game]);

    useEffect(() => {
        if (isOpen) void fetchFiles();
    }, [fetchFiles, isOpen]);

    const handleChooseGameFolder = async () => {
        if (!window.electronAPI?.selectFrontierFolder) {
            setConfigurationError('Please update the desktop client, then choose your game folder again.');
            return;
        }
        try {
            const selectedPath = await window.electronAPI.selectFrontierFolder();
            if (selectedPath) await fetchFiles();
        } catch (error) {
            setConfigurationError(error.message || 'The game folder could not be configured.');
        }
    };

    const gameOptions = useMemo(() => getGames().filter(entry => {
        if (!allowGameSelection) return entry.id === game;
        const groups = localFiles?.[entry.name];
        return groups && Object.values(groups).some(items => Array.isArray(items) && items.length > 0);
    }), [allowGameSelection, game, localFiles]);

    const gameFiles = useMemo(() => {
        if (!localFiles || !effectiveGameId) return EMPTY_FILES;
        return localFiles[getGameDisplayName(effectiveGameId)] || EMPTY_FILES;
    }, [effectiveGameId, localFiles]);

    const tabs = useMemo(() => [
        { id: 'parks', name: 'Parks', count: gameFiles.parks?.length || 0 },
        { id: 'blueprints', name: 'Blueprints', count: gameFiles.blueprints?.length || 0 },
        { id: 'backups', name: 'Backups', count: gameFiles.backups?.length || 0 },
        { id: 'autosaves', name: 'Autosaves', count: gameFiles.autosaves?.length || 0 },
    ].filter(tab => tab.count > 0), [gameFiles]);

    useEffect(() => {
        setSelectedFile(null);
        setPreview(null);
        setMetadataError(null);
        setActiveTab(current => tabs.some(tab => tab.id === current) ? current : (tabs[0]?.id || 'parks'));
    }, [effectiveGameId, tabs]);

    useEffect(() => {
        const filePath = selectedFile?.path;
        if (!filePath) return undefined;
        const isBackup = selectedFile.isBackup || String(filePath).toLowerCase().endsWith('.planetcreations');
        let cancelled = false;
        setPreview(null);
        setPreviewLoading(!isBackup && Boolean(window.electronAPI?.readFrontierPreview));
        setMetadataError(selectedFile.frontierMetadataError || null);

        if (!isBackup && window.electronAPI?.readFrontierPreview) {
            window.electronAPI.readFrontierPreview(filePath)
                .then(value => { if (!cancelled) setPreview(value || null); })
                .catch(() => { if (!cancelled) setPreview(null); })
                .finally(() => { if (!cancelled) setPreviewLoading(false); });
        }

        if (!isBackup && !selectedFile.frontierMetadata && window.electronAPI?.inspectFrontierFile) {
            setMetadataLoading(true);
            window.electronAPI.inspectFrontierFile(filePath)
                .then(inspection => {
                    if (cancelled || !inspection?.metadata) return;
                    setSelectedFile(current => current?.path === filePath ? {
                        ...current,
                        frontierMetadata: inspection.metadata,
                        customMediaReferences: inspection.mediaReferences || current.customMediaReferences || [],
                        metadataStatus: 'ready',
                        frontierMetadataError: undefined,
                    } : current);
                    setMetadataError(null);
                })
                .catch(error => {
                    if (!cancelled) setMetadataError(error.message || 'Metadata could not be read.');
                })
                .finally(() => { if (!cancelled) setMetadataLoading(false); });
        } else {
            setMetadataLoading(false);
        }

        return () => { cancelled = true; };
    }, [selectedFile?.path]); // A replacement object for the same file must not restart extraction.

    if (!isOpen) return null;

    const currentFiles = gameFiles[activeTab] || [];
    const metadata = selectedFile?.frontierMetadata;
    const detail = metadata?.park || metadata?.blueprint;
    const rideCount = detail?.rideCount ?? detail?.trackedRideCount;
    const constructionParts = detail?.placedPartCount ?? detail?.sceneryCount;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onClick={onClose} style={color.style}>
            <div role="dialog" aria-modal="true" aria-label="Select a Creation File" className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-white shadow-2xl dark:bg-gray-900" onClick={event => event.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Select a Creation File</h2>
                        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Choose a local save and review its in-game preview before continuing.</p>
                    </div>
                    <button type="button" aria-label="Close file selector" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-2xl text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-white">&times;</button>
                </div>

                {loading ? (
                    <div className="flex flex-grow items-center justify-center p-12"><Spinner /></div>
                ) : localFiles?.__configurationRequired ? (
                    <div className="grid flex-grow place-items-center p-8 text-center">
                        <div className="max-w-lg rounded-2xl border border-gray-200 bg-gray-50 p-8 dark:border-gray-700 dark:bg-gray-950">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Choose your game folder first</h3>
                            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">The desktop client needs the Frontier Developments folder that contains your local Planet Coaster 2 or Planet Zoo saves. The folder remains on this device.</p>
                            {configurationError && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{configurationError}</p>}
                            <button type="button" onClick={handleChooseGameFolder} className={`mt-5 rounded-lg px-5 py-2.5 font-semibold text-white ${color.bg} ${color.hoverBg}`}>Choose Game Folder</button>
                        </div>
                    </div>
                ) : (
                    <>
                        {allowGameSelection && gameOptions.length > 1 && (
                            <div className="flex flex-wrap gap-2 border-b border-gray-200 p-3 dark:border-gray-700">
                                {gameOptions.map(option => (
                                    <button key={option.id} type="button" onClick={() => setSelectedGameId(option.id)} style={effectiveGameId === option.id ? { backgroundColor: getGameColor(option.id).hex } : {}} className={`rounded-full px-4 py-2 text-sm font-semibold ${effectiveGameId === option.id ? 'text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200'}`}>
                                        {option.name}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="flex flex-wrap gap-2 border-b border-gray-200 p-3 dark:border-gray-700">
                            {tabs.map(tab => (
                                <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); setSelectedFile(null); }} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === tab.id ? `${color.bg} text-white` : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
                                    {tab.name} ({tab.count})
                                </button>
                            ))}
                        </div>

                        <div className="grid min-h-0 flex-grow overflow-y-auto lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden">
                            <div className="min-h-48 overflow-y-auto p-4">
                                {currentFiles.length === 0 ? (
                                    <p className="p-8 text-center text-gray-500">No files found in this category.</p>
                                ) : (
                                    <ul className="grid gap-2 sm:grid-cols-2">
                                        {currentFiles.map(file => {
                                            const selected = selectedFile?.path === file.path;
                                            const displayName = file.frontierMetadata?.name || file.name;
                                            return (
                                                <li key={file.path}>
                                                    <button type="button" onClick={() => setSelectedFile(file)} aria-pressed={selected} className={`h-full w-full rounded-xl border p-3 text-left transition-colors ${selected ? `${color.bg} border-transparent text-white shadow-lg` : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800'}`}>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <p className="truncate font-semibold" title={displayName}>{displayName}</p>
                                                                <p className={`mt-1 truncate text-xs ${selected ? 'text-white/75' : 'text-gray-500'}`}>{file.name}</p>
                                                            </div>
                                                            {selected && <Icon path={ICONS.checkCircle} className="h-6 w-6 flex-none" />}
                                                        </div>
                                                        <p className={`mt-2 text-xs ${selected ? 'text-white/75' : 'text-gray-500'}`}>{new Date(file.modifiedAt).toLocaleString()}</p>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            <aside className="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-950 lg:overflow-y-auto lg:border-l lg:border-t-0">
                                {!selectedFile ? (
                                    <div className="grid h-full min-h-48 place-items-center rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">Select a file to see its in-game image and extracted details.</div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-gray-800 to-gray-950">
                                            {preview && <img src={preview} alt="In-game save preview" className="h-full w-full object-cover" />}
                                            {previewLoading && <div className="absolute inset-0 grid place-items-center bg-black/25"><Spinner /></div>}
                                            {!preview && !previewLoading && <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-gray-400">No in-game preview stored in this file.</div>}
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">{fileKindLabel(selectedFile)}</p>
                                            <h3 className="mt-1 break-words text-lg font-bold text-gray-900 dark:text-white">{metadata?.name || selectedFile.name}</h3>
                                        </div>
                                        {metadataLoading && <div className="flex items-center gap-2 text-sm text-gray-500"><Spinner /> Reading save metadata…</div>}
                                        {metadataError && <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{metadataError}</p>}
                                        {metadata && (
                                            <>
                                                <div className="grid grid-cols-2 gap-2 text-sm">
                                                    {Number.isFinite(rideCount) && <div className="rounded-lg bg-white p-2 dark:bg-gray-900"><p className="text-xs text-gray-500">Rides</p><p className="font-semibold dark:text-white">{rideCount}</p></div>}
                                                    {Number.isFinite(constructionParts) && <div className="rounded-lg bg-white p-2 dark:bg-gray-900"><p className="text-xs text-gray-500">Construction parts</p><p className="font-semibold dark:text-white">{constructionParts.toLocaleString()}</p></div>}
                                                </div>
                                                {metadata.requiredDlcs?.length > 0 && <div className="flex flex-wrap gap-1.5">{metadata.requiredDlcs.map(dlc => <span key={dlc} className="rounded-full bg-purple-100 px-2 py-1 text-xs text-purple-800 dark:bg-purple-950 dark:text-purple-200">{dlc}</span>)}</div>}
                                                {metadata.description && <p className="line-clamp-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>}
                                            </>
                                        )}
                                    </div>
                                )}
                            </aside>
                        </div>
                    </>
                )}

                <div className="flex justify-end gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
                    <button type="button" onClick={onClose} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600">Cancel</button>
                    <button
                        type="button"
                        onClick={() => onFileSelect({ ...selectedFile, gameId: effectiveGameId, gameName: getGameDisplayName(effectiveGameId), previewDataUrl: preview })}
                        disabled={!selectedFile || loading || metadataLoading}
                        className={`rounded-lg px-4 py-2 font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${color.bg} ${color.hoverBg}`}
                    >
                        Confirm Selection
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SelectBackupModal;
