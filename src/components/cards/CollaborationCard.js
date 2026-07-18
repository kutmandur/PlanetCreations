import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import { getGameColor } from '../../utils/helpers';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const GAME_LABELS = {
    'planet-coaster-2': 'PC2',
    'planet-zoo': 'PZ'
};

const STATUS_STYLES = {
    active: { bg: 'bg-green-100', text: 'text-green-700', label: 'Active' },
    completed: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Completed' },
    archived: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Archived' }
};

const ROLE_STYLES = {
    owner: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Owner' },
    editor: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Editor' },
    viewer: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Viewer' }
};

const CollaborationCard = memo(({ collaboration, memberCount = 0 }) => {
    const gameColor = getGameColor(collaboration.game);
    const statusStyle = STATUS_STYLES[collaboration.status] || STATUS_STYLES.active;
    const roleStyle = ROLE_STYLES[collaboration.userRole] || ROLE_STYLES.editor;

    const storagePercent = collaboration.storage
        ? Math.round((collaboration.storage.totalBytes / collaboration.storage.limitBytes) * 100)
        : 0;

    const formatBytes = (bytes) => {
        if (!bytes) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(0)} MB`;
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

        return date.toLocaleDateString();
    };

    return (
        <Link to={`/collaboration/${collaboration.id}`}>
            <article
                style={gameColor.style}
                className={`bg-white rounded-lg shadow-md overflow-hidden transform hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col h-full border-l-4 ${gameColor.border}`}
            >
                <div className="p-4 flex flex-col flex-grow">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-bold text-gray-800 truncate" title={collaboration.title}>
                                {collaboration.title}
                            </h3>
                            <p className="text-sm text-gray-500 line-clamp-2 mt-1">
                                {collaboration.description || 'No description'}
                            </p>
                        </div>
                        <span className={`ml-2 px-2 py-1 text-xs font-bold rounded-full ${gameColor.bg} text-white flex-shrink-0`}>
                            {GAME_LABELS[collaboration.game] || collaboration.game}
                        </span>
                    </div>

                    {/* Status & Role Badges */}
                    <div className="flex items-center gap-2 mb-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                            {statusStyle.label}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${roleStyle.bg} ${roleStyle.text}`}>
                            {roleStyle.label}
                        </span>
                    </div>

                    {/* Storage Bar */}
                    <div className="mb-3">
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                            <span>Storage</span>
                            <span>{formatBytes(collaboration.storage?.totalBytes)} / {formatBytes(collaboration.storage?.limitBytes)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                    storagePercent > 90 ? 'bg-red-500' :
                                    storagePercent > 70 ? 'bg-yellow-500' : 'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(storagePercent, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                                <Icon path={ICONS.users} className="w-4 h-4" />
                                {memberCount}
                            </span>
                            <span className="flex items-center gap-1">
                                <Icon path={ICONS.database} className="w-4 h-4" />
                                {collaboration.storage?.fileCount || 0}
                            </span>
                        </div>
                        <span className="text-xs text-gray-400">
                            {formatDate(collaboration.updatedAt)}
                        </span>
                    </div>
                </div>
            </article>
        </Link>
    );
});

export default CollaborationCard;
