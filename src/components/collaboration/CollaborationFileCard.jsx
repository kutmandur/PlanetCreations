import React from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const FILE_TYPE_ICONS = {
    '.park2': '🎢',
    '.zoo': '🦁',
    '.blpr2': '📐',
    '.pzblueprint': '📐',
    '.prkauto2': '💾',
    '.zooauto': '💾'
};

const CollaborationFileCard = ({
    file,
    currentUserId,
    userRole,
    isOwner,
    isElectron,
    onCheckOut,
    onCheckIn,
    onForceUnlock,
    onNotify,
    onShowVersions,
    onDownload
}) => {
    const isLocked = !!file.lock;
    const isLockedByMe = isLocked && file.lock.lockedBy === currentUserId;
    const canEdit = userRole !== 'viewer';
    const canForceUnlock = isOwner && isLocked && !isLockedByMe;

    const formatBytes = (bytes) => {
        if (!bytes) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString();
    };

    const formatLockDuration = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);

        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const fileIcon = FILE_TYPE_ICONS[file.type] || '📄';

    return (
        <div className={`bg-white rounded-lg shadow-sm border ${isLocked ? 'border-yellow-300' : 'border-gray-200'} overflow-hidden`}>
            <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl flex-shrink-0">{fileIcon}</span>
                        <div className="min-w-0">
                            <h3 className="font-semibold text-gray-800 truncate" title={file.name}>
                                {file.name}
                            </h3>
                            <p className="text-sm text-gray-500">
                                {formatBytes(file.currentVersion?.sizeBytes)} · v{file.currentVersion?.number || 1}
                            </p>
                        </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex-shrink-0 ml-2">
                        {isLockedByMe ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
                                <Icon path={ICONS.pencil} className="w-3 h-3" />
                                You're editing
                            </span>
                        ) : isLocked ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full">
                                <Icon path={ICONS.lockClosed} className="w-3 h-3" />
                                In progress
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                                <Icon path={ICONS.checkCircle} className="w-3 h-3" />
                                Available
                            </span>
                        )}
                    </div>
                </div>

                {/* Lock Info */}
                {isLocked && !isLockedByMe && (
                    <div className="mt-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                        <div className="flex items-center gap-2 text-sm">
                            <Icon path={ICONS.user} className="w-4 h-4 text-orange-600" />
                            <span className="font-medium text-orange-800">
                                {file.lock.lockedByUsername}
                            </span>
                            <span className="text-orange-600">
                                is editing · {formatLockDuration(file.lock.lockedAt)}
                            </span>
                        </div>
                        {file.lock.note && (
                            <p className="text-sm text-orange-700 mt-1 italic">
                                "{file.lock.note}"
                            </p>
                        )}
                    </div>
                )}

                {/* Last Update Info */}
                <div className="mt-3 text-xs text-gray-500">
                    Last updated by {file.currentVersion?.uploadedByUsername || 'Unknown'} · {formatTime(file.currentVersion?.uploadedAt || file.updatedAt)}
                    {file.currentVersion?.note && (
                        <span className="block mt-1 text-gray-600">"{file.currentVersion.note}"</span>
                    )}
                </div>

                {/* Actions */}
                <div className="mt-4 flex flex-wrap gap-2">
                    {/* Download/Edit Button - Electron only */}
                    {isElectron && (
                        <>
                            {isLockedByMe ? (
                                <button
                                    onClick={onCheckIn}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
                                >
                                    <Icon path={ICONS.checkCircle} className="w-4 h-4" />
                                    Done Editing
                                </button>
                            ) : !isLocked && canEdit ? (
                                <button
                                    onClick={onCheckOut}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
                                >
                                    <Icon path={ICONS.download} className="w-4 h-4" />
                                    Download & Edit
                                </button>
                            ) : isLocked && !isLockedByMe ? (
                                <>
                                    <button
                                        onClick={onNotify}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                                    >
                                        <Icon path={ICONS.bell} className="w-4 h-4" />
                                        Notify Me
                                    </button>
                                    <button
                                        onClick={onDownload}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                                    >
                                        <Icon path={ICONS.download} className="w-4 h-4" />
                                        Download Anyway
                                    </button>
                                </>
                            ) : null}
                        </>
                    )}

                    {/* Version History - Always visible */}
                    <button
                        onClick={onShowVersions}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                    >
                        <Icon path={ICONS.refresh} className="w-4 h-4" />
                        History
                    </button>

                    {/* Force Unlock - Owner only */}
                    {canForceUnlock && (
                        <button
                            onClick={onForceUnlock}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg transition-colors"
                        >
                            <Icon path={ICONS.lockClosed} className="w-4 h-4" />
                            Force Unlock
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CollaborationFileCard;
