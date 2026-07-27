import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import { getGameColor, ICONS } from '../../utils/helpers';
import { getGame } from '../../utils/gamesRegistry';
import Icon from '../ui/Icon';

const STATUS_STYLES = {
    active: {
        className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        label: 'Active',
    },
    completed: {
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        label: 'Completed',
    },
    published: {
        className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
        label: 'Published',
    },
    archived: {
        className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
        label: 'Archived',
    },
};

const ROLE_STYLES = {
    owner: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    editor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    visitor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
};

const ROLE_LABELS = {
    owner: 'owner',
    editor: 'editor',
    viewer: 'viewer',
    visitor: 'public view',
};

const hexToRgba = (hex, alpha) => {
    const match = String(hex || '').match(/[a-f\d]{2}/gi);
    if (!match || match.length < 3) return `rgba(107, 114, 128, ${alpha})`;
    const [r, g, b] = match.map((part) => parseInt(part, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const toMillis = (timestamp) => {
    if (typeof timestamp?.toMillis === 'function') return timestamp.toMillis();
    const value = timestamp ? new Date(timestamp).getTime() : 0;
    return Number.isFinite(value) ? value : 0;
};

const formatRelativeDate = (timestamp) => {
    const milliseconds = toMillis(timestamp);
    if (!milliseconds) return 'No updates yet';
    const diff = Math.max(0, Date.now() - milliseconds);
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(milliseconds).toLocaleDateString();
};

const CollaborationCard = memo(({ collaboration, memberCount = 0 }) => {
    const gameColor = getGameColor(collaboration.game);
    const game = getGame(collaboration.game);
    const status = STATUS_STYLES[collaboration.status] || STATUS_STYLES.active;
    const role = collaboration.userRole || 'editor';
    const lock = collaboration.buildLock;
    const lockActive = Boolean(
        lock?.activeBuilderId &&
        toMillis(lock.expiresAt) > Date.now(),
    );
    const currentVersion = collaboration.currentVersion;

    return (
        <Link
            to={`/collaboration/${collaboration.id}`}
            className="block h-full rounded-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500"
        >
            <article
                style={{
                    ...gameColor.style,
                    '--tw-ring-color': gameColor.hex,
                    backgroundImage: `linear-gradient(145deg, ${hexToRgba(gameColor.hex, 0.16)}, rgba(255,255,255,0) 48%)`,
                }}
                className="group flex h-full min-h-[280px] cursor-pointer flex-col overflow-hidden rounded-xl bg-white shadow-lg ring-4 transition duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-gray-800"
            >
                <div className="h-1.5 w-full" style={{ backgroundColor: gameColor.hex }} />
                <div className="flex flex-1 flex-col p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="truncate text-xl font-bold text-gray-900 dark:text-gray-100" title={collaboration.title}>
                                {collaboration.title}
                            </h3>
                            <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-gray-600 dark:text-gray-300">
                                {collaboration.description || 'A shared creation in progress.'}
                            </p>
                        </div>
                        <span
                            className="flex-none rounded-full px-2.5 py-1 text-xs font-bold text-white"
                            style={{ backgroundColor: gameColor.hex }}
                        >
                            {game?.shortName || collaboration.game}
                        </span>
                    </div>

                    <div className="mb-4 flex flex-wrap gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                            {status.label}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${ROLE_STYLES[role] || ROLE_STYLES.editor}`}>
                            {ROLE_LABELS[role] || role}
                        </span>
                    </div>

                    <div className="rounded-xl border border-gray-200/80 bg-white/70 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                        <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 flex-none rounded-full ${lockActive ? 'bg-red-500' : 'bg-emerald-500'}`} />
                            <p className="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                                {lockActive
                                    ? `${lock.username || 'Someone'} is building`
                                    : 'Free to build'}
                            </p>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>
                                {currentVersion?.number
                                    ? `Current version v${currentVersion.number}`
                                    : 'No version uploaded yet'}
                            </span>
                            <span>{formatRelativeDate(collaboration.updatedAt)}</span>
                        </div>
                    </div>

                    <div className="mt-auto flex items-center justify-between border-t border-gray-200/80 pt-4 text-sm dark:border-gray-700">
                        <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                            <Icon path={ICONS.users} className="h-4 w-4" />
                            {memberCount} {memberCount === 1 ? 'member' : 'members'}
                        </span>
                        <span className="flex items-center gap-1 font-semibold" style={{ color: gameColor.hex }}>
                            {role === 'visitor' ? 'View project' : 'Open project'}
                            <Icon path={ICONS.chevronRight} className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                    </div>
                </div>
            </article>
        </Link>
    );
});

export default CollaborationCard;
