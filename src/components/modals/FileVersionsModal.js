import React, { useState, useEffect } from 'react';
import { fetchFileVersions, restoreVersion } from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const FileVersionsModal = ({
    collaborationId,
    fileId,
    file,
    currentUserId,
    isElectron,
    onClose,
    setModalMessage,
    setConfirmation
}) => {
    const [versions, setVersions] = useState({ all: [], byUser: [] });
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('byUser'); // 'byUser' or 'timeline'

    useEffect(() => {
        const loadVersions = async () => {
            try {
                const data = await fetchFileVersions(collaborationId, fileId);
                setVersions(data);
            } catch (error) {
                console.error('Error loading versions:', error);
                setModalMessage('Error loading version history.');
            } finally {
                setLoading(false);
            }
        };

        loadVersions();
    }, [collaborationId, fileId, setModalMessage]);

    const formatBytes = (bytes) => {
        if (!bytes) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const handleRestore = (version) => {
        setConfirmation({
            message: `Restore v${version.versionNumber} from ${version.uploadedByUsername}? This will create a new version based on this file.`,
            onConfirm: async () => {
                try {
                    await restoreVersion(collaborationId, fileId, version.id, currentUserId, 'Manual restore');
                    setModalMessage(`Version ${version.versionNumber} restored successfully.`);
                    onClose();
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const handleDownload = (version) => {
        // TODO: Implement download via Electron IPC
        setModalMessage('Download coming soon!');
    };

    const currentVersion = file?.currentVersion;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gray-800 p-6 text-white flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Icon path={ICONS.refresh} className="w-6 h-6" />
                            Version History
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <Icon path={ICONS.xMark} className="w-6 h-6" />
                        </button>
                    </div>
                    <p className="text-white/70 mt-1">{file?.name}</p>
                </div>

                {/* View Toggle */}
                <div className="px-6 pt-4 flex-shrink-0">
                    <div className="inline-flex bg-gray-100 rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('byUser')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                viewMode === 'byUser'
                                    ? 'bg-white shadow text-gray-800'
                                    : 'text-gray-600 hover:text-gray-800'
                            }`}
                        >
                            By User
                        </button>
                        <button
                            onClick={() => setViewMode('timeline')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                viewMode === 'timeline'
                                    ? 'bg-white shadow text-gray-800'
                                    : 'text-gray-600 hover:text-gray-800'
                            }`}
                        >
                            Timeline
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Spinner />
                        </div>
                    ) : viewMode === 'byUser' ? (
                        // By User View
                        <div className="space-y-6">
                            {versions.byUser.map(userGroup => (
                                <div key={userGroup.userId} className="border border-gray-200 rounded-lg overflow-hidden">
                                    {/* User Header */}
                                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                                <span className="text-purple-600 font-medium text-sm">
                                                    {userGroup.username?.charAt(0).toUpperCase() || '?'}
                                                </span>
                                            </div>
                                            <span className="font-medium text-gray-800">{userGroup.username}</span>
                                            <span className="text-sm text-gray-500">
                                                ({userGroup.versions.length} version{userGroup.versions.length !== 1 ? 's' : ''})
                                            </span>
                                        </div>
                                    </div>

                                    {/* User's Versions */}
                                    <div className="divide-y divide-gray-100">
                                        {userGroup.versions.map(version => (
                                            <VersionRow
                                                key={version.id}
                                                version={version}
                                                isCurrent={version.isCurrentVersion}
                                                isElectron={isElectron}
                                                onRestore={() => handleRestore(version)}
                                                onDownload={() => handleDownload(version)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {versions.byUser.length === 0 && (
                                <div className="text-center py-8 text-gray-500">
                                    No version history available.
                                </div>
                            )}
                        </div>
                    ) : (
                        // Timeline View
                        <div className="space-y-2">
                            {versions.all.map((version, index) => (
                                <div
                                    key={version.id}
                                    className={`border rounded-lg overflow-hidden ${
                                        version.isCurrentVersion
                                            ? 'border-purple-300 bg-purple-50'
                                            : 'border-gray-200'
                                    }`}
                                >
                                    <div className="p-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <span className={`font-mono font-bold ${
                                                    version.isCurrentVersion ? 'text-purple-600' : 'text-gray-600'
                                                }`}>
                                                    v{version.versionNumber}
                                                </span>
                                                {version.isCurrentVersion && (
                                                    <span className="px-2 py-0.5 bg-purple-500 text-white text-xs font-medium rounded-full">
                                                        Current
                                                    </span>
                                                )}
                                                <span className="text-gray-600">
                                                    by {version.uploadedByUsername}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isElectron && (
                                                    <button
                                                        onClick={() => handleDownload(version)}
                                                        className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                                                        title="Download"
                                                    >
                                                        <Icon path={ICONS.download} className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {!version.isCurrentVersion && (
                                                    <button
                                                        onClick={() => handleRestore(version)}
                                                        className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
                                                        title="Restore"
                                                    >
                                                        <Icon path={ICONS.refresh} className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
                                            <span>{formatBytes(version.sizeBytes)}</span>
                                            <span>{formatTime(version.uploadedAt)}</span>
                                        </div>
                                        {version.note && (
                                            <p className="mt-2 text-sm text-gray-600 italic">"{version.note}"</p>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {versions.all.length === 0 && (
                                <div className="text-center py-8 text-gray-500">
                                    No version history available.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500">
                            Each user keeps up to 2 versions. Older versions are auto-deleted when storage is full.
                        </p>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Helper component for version rows in "By User" view
const VersionRow = ({ version, isCurrent, isElectron, onRestore, onDownload }) => {
    const formatBytes = (bytes) => {
        if (!bytes) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`px-4 py-3 ${isCurrent ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-gray-700">v{version.versionNumber}</span>
                        {isCurrent && (
                            <span className="px-2 py-0.5 bg-green-500 text-white text-xs font-medium rounded-full">
                                Current
                            </span>
                        )}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                        {formatBytes(version.sizeBytes)} · {formatTime(version.uploadedAt)}
                    </div>
                    {version.note && (
                        <p className="text-sm text-gray-600 mt-1">"{version.note}"</p>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {isElectron && (
                        <button
                            onClick={onDownload}
                            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Download this version"
                        >
                            <Icon path={ICONS.download} className="w-4 h-4" />
                        </button>
                    )}
                    {!isCurrent && (
                        <button
                            onClick={onRestore}
                            className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Restore this version"
                        >
                            <Icon path={ICONS.refresh} className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FileVersionsModal;
