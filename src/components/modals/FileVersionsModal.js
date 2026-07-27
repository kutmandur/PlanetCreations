import React, { useEffect, useState } from 'react';
import {
    fetchFileVersions,
    getCollaborationVersionDownloadUrl,
} from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import { recordInstalledCollaborationVersion } from '../../utils/collaborationVersionUpdates';

const formatBytes = (bytes) => {
    if (!bytes) return '0 MB';
    const megabytes = bytes / (1024 * 1024);
    return megabytes < 1
        ? `${(megabytes * 1024).toFixed(0)} KB`
        : `${megabytes.toFixed(1)} MB`;
};

const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return `${date.toLocaleDateString()} · ${date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    })}`;
};

const VersionItem = ({
    version,
    isElectron,
    downloading,
    onDownload,
    accentColor,
    showContributor = false,
}) => (
    <article className={`p-4 sm:p-5 ${version.isCurrentVersion ? 'bg-emerald-50/80 dark:bg-emerald-950/20' : ''}`}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-bold text-gray-900 dark:text-gray-100">
                        v{version.versionNumber}
                    </span>
                    {version.isCurrentVersion && (
                        <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">Current</span>
                    )}
                    {showContributor && (
                        <span className="truncate text-sm text-gray-500 dark:text-gray-400">
                            by {version.uploadedByUsername || 'Unknown'}
                        </span>
                    )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>{formatBytes(version.sizeBytes)}</span>
                    <span>{formatTimestamp(version.uploadedAt)}</span>
                </div>
                {version.note && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{version.note}</p>
                )}
            </div>
            <button
                type="button"
                onClick={onDownload}
                disabled={!isElectron || downloading}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                style={isElectron ? { color: accentColor } : undefined}
                title={isElectron ? `Download version ${version.versionNumber}` : 'Downloads require the desktop client'}
                aria-label={`Download version ${version.versionNumber}`}
            >
                {downloading
                    ? <Spinner size="small" />
                    : <Icon path={ICONS.download} className="h-5 w-5" />}
            </button>
        </div>
    </article>
);

const FileVersionsModal = ({
    collaborationId,
    fileId,
    file,
    gameId,
    currentUserId,
    retentionLimit,
    isElectron,
    accentColor = '#6B7280',
    onClose,
    setModalMessage,
}) => {
    const [versions, setVersions] = useState({ all: [], byUser: [] });
    const [loading, setLoading] = useState(true);
    const [downloadingId, setDownloadingId] = useState(null);
    const [viewMode, setViewMode] = useState('timeline');

    useEffect(() => {
        let mounted = true;
        fetchFileVersions(collaborationId, fileId)
            .then((data) => { if (mounted) setVersions(data); })
            .catch((error) => {
                if (mounted) setModalMessage(`Error loading version history: ${error.message}`);
            })
            .finally(() => { if (mounted) setLoading(false); });
        return () => { mounted = false; };
    }, [collaborationId, fileId, setModalMessage]);

    const handleDownload = async (version) => {
        if (!isElectron || !window.electronAPI?.saveCollaborationVersion) {
            setModalMessage('Version downloads require the desktop client.');
            return;
        }
        setDownloadingId(version.id);
        try {
            const download = await getCollaborationVersionDownloadUrl(collaborationId, version.id);
            const result = await window.electronAPI.saveCollaborationVersion({
                downloadUrl: download.downloadUrl,
                gameId,
            });
            if (result?.status === 'canceled') return;
            if (!result?.success) throw new Error(result?.message || 'The version could not be saved.');
            if (version.isCurrentVersion) {
                recordInstalledCollaborationVersion({
                    userId: currentUserId,
                    collaborationId,
                    gameId,
                    versionId: version.id,
                    versionNumber: version.versionNumber,
                    targetPath: result.targetPath,
                });
            }
            setModalMessage(`Version ${version.versionNumber} saved to ${result.targetPath}.`);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setDownloadingId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="version-history-title"
                className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="h-2 flex-none" style={{ backgroundColor: accentColor }} />
                <header className="flex flex-none items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-700 sm:px-6 sm:py-5">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: accentColor }}>Shared save</p>
                        <h2 id="version-history-title" className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">Version history</h2>
                        <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">{file?.name || 'Collaboration save'}</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" aria-label="Close version history">
                        <Icon path={ICONS.xMark} className="h-6 w-6" />
                    </button>
                </header>

                <div className="flex flex-none flex-col gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="inline-flex w-full rounded-xl bg-gray-100 p-1 dark:bg-gray-900 sm:w-auto">
                        {[
                            { id: 'timeline', label: 'Timeline' },
                            { id: 'byUser', label: 'By contributor' },
                        ].map((mode) => (
                            <button
                                type="button"
                                key={mode.id}
                                onClick={() => setViewMode(mode.id)}
                                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                                    viewMode === mode.id
                                        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                                }`}
                            >
                                {mode.label}
                            </button>
                        ))}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                        {versions.all.length} {versions.all.length === 1 ? 'version' : 'versions'}
                    </span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex min-h-[260px] items-center justify-center"><Spinner /></div>
                    ) : versions.all.length === 0 ? (
                        <div className="px-6 py-16 text-center">
                            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-700">
                                <Icon path={ICONS.refresh} className="h-7 w-7 text-gray-400" />
                            </span>
                            <h3 className="mt-4 text-lg font-bold text-gray-900 dark:text-gray-100">No versions yet</h3>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                The first desktop upload will appear here.
                            </p>
                        </div>
                    ) : viewMode === 'timeline' ? (
                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                            {versions.all.map((version) => (
                                <VersionItem
                                    key={version.id}
                                    version={version}
                                    showContributor
                                    isElectron={isElectron}
                                    downloading={downloadingId === version.id}
                                    onDownload={() => handleDownload(version)}
                                    accentColor={accentColor}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-5 p-5 sm:p-6">
                            {versions.byUser.map((group) => (
                                <section key={group.userId} className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
                                    <header className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/50">
                                        <span className="flex h-9 w-9 items-center justify-center rounded-xl font-bold text-white" style={{ backgroundColor: accentColor }}>
                                            {String(group.username || '?').slice(0, 2).toUpperCase()}
                                        </span>
                                        <div>
                                            <h3 className="font-bold text-gray-900 dark:text-gray-100">{group.username || 'Unknown contributor'}</h3>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {group.versions.length} retained {group.versions.length === 1 ? 'version' : 'versions'}
                                            </p>
                                        </div>
                                    </header>
                                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {group.versions.map((version) => (
                                            <VersionItem
                                                key={version.id}
                                                version={version}
                                                isElectron={isElectron}
                                                downloading={downloadingId === version.id}
                                                onDownload={() => handleDownload(version)}
                                                accentColor={accentColor}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}
                </div>

                <footer className="flex flex-none flex-col gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-900/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Up to <strong className="text-gray-700 dark:text-gray-200">{retentionLimit}</strong> versions are kept per contributor.
                    </p>
                    <button type="button" onClick={onClose} className="rounded-xl border border-gray-300 bg-white px-5 py-2 font-bold text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
                        Close
                    </button>
                </footer>
            </section>
        </div>
    );
};

export default FileVersionsModal;
