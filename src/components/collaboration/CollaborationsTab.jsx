import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    fetchPublicCollaborations,
    fetchUserCollaborations,
} from '../../firebase/collaboration';
import CollaborationCard from '../cards/CollaborationCard';
import PendingInvitations from './PendingInvitations';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const CollaborationsTab = ({ user, setModalMessage }) => {
    const navigate = useNavigate();
    const isRunningInElectron = Boolean(window.electronAPI?.isElectron);
    const [collaborations, setCollaborations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const searchInputRef = useRef(null);

    const loadCollaborations = useCallback(async ({ background = false } = {}) => {
        if (!user) {
            setCollaborations([]);
            setLoading(false);
            return;
        }
        if (background) setRefreshing(true);
        try {
            const [userCollaborations, publicCollaborations] = await Promise.all([
                fetchUserCollaborations(user.uid),
                fetchPublicCollaborations(),
            ]);
            const ownIds = new Set(userCollaborations.map((collaboration) => collaboration.id));
            setCollaborations([
                ...userCollaborations,
                ...publicCollaborations.filter((collaboration) => !ownIds.has(collaboration.id)),
            ]);
        } catch (error) {
            console.error('Error loading collaborations:', error);
            setModalMessage?.(`Could not load collaborations: ${error.message}`);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [setModalMessage, user]);

    useEffect(() => {
        loadCollaborations();
    }, [loadCollaborations]);

    const filteredCollaborations = useMemo(() => {
        const search = searchTerm.trim().toLowerCase();
        return collaborations.filter((collaboration) => {
            const matchesSearch = !search ||
                String(collaboration.title || '').toLowerCase().includes(search) ||
                String(collaboration.description || '').toLowerCase().includes(search);
            const matchesStatus = filterStatus === 'all' || collaboration.status === filterStatus;
            return matchesSearch && matchesStatus;
        });
    }, [collaborations, filterStatus, searchTerm]);

    const normalizedSearch = searchTerm.trim();
    const isShareCode = /^[A-Z0-9]{8}$/i.test(normalizedSearch);

    const handleSearchSubmit = (event) => {
        event.preventDefault();
        if (isShareCode) {
            navigate(`/collaboration/join/${encodeURIComponent(normalizedSearch.toUpperCase())}`);
        }
    };

    if (!user) {
        return (
            <div className="mx-auto max-w-2xl py-10 sm:py-16">
                <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg dark:border-gray-700 dark:bg-gray-800 sm:p-10">
                    <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/40">
                        <Icon path={ICONS.lockClosed} className="h-8 w-8 text-amber-600 dark:text-amber-300" />
                    </span>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Build together without overwrites</h2>
                    <p className="mx-auto mt-3 max-w-lg text-gray-600 dark:text-gray-300">
                        Sign in to coordinate build turns, share save versions and finish one creation as a team.
                    </p>
                    <Link
                        to="/login"
                        className="mt-6 inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-bold text-white shadow-md transition hover:bg-blue-700"
                    >
                        <Icon path={ICONS.user} className="h-5 w-5" />
                        Sign in
                    </Link>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex min-h-[320px] items-center justify-center">
                <Spinner />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PendingInvitations
                userId={user.uid}
                setModalMessage={setModalMessage}
                onInvitationHandled={() => loadCollaborations({ background: true })}
            />

            <form
                onSubmit={handleSearchSubmit}
                className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center"
            >
                <label className="relative min-w-0 flex-1">
                    <span className="sr-only">Search collaborations or enter share code</span>
                    <Icon
                        path={isShareCode ? ICONS.share : ICONS.search}
                        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
                    />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search collaborations or enter an 8-character share code"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        className={`w-full rounded-full border bg-gray-50 py-2.5 pl-11 text-gray-900 focus:outline-none focus:ring-2 dark:bg-gray-900 dark:text-gray-100 ${
                            isShareCode
                                ? 'border-amber-400 pr-32 focus:ring-amber-400/20 dark:border-amber-500'
                                : 'border-gray-200 pr-4 focus:border-amber-400 focus:ring-amber-400/20 dark:border-gray-600'
                        }`}
                    />
                    {isShareCode && (
                        <button
                            type="submit"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-bold text-gray-950 transition hover:bg-amber-400"
                        >
                            Join code
                        </button>
                    )}
                </label>
                <div className="flex gap-2">
                    <select
                        value={filterStatus}
                        onChange={(event) => setFilterStatus(event.target.value)}
                        aria-label="Filter collaboration status"
                        className="min-w-0 flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-gray-700 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 sm:flex-none"
                    >
                        <option value="all">All statuses</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="published">Published</option>
                        <option value="archived">Archived</option>
                    </select>
                    <button
                        type="button"
                        onClick={() => loadCollaborations({ background: true })}
                        disabled={refreshing}
                        className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        aria-label="Refresh collaborations"
                        title="Refresh"
                    >
                        <Icon path={ICONS.refresh} className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    {isRunningInElectron && (
                        <Link
                            to="/collaboration/create"
                            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-amber-500 text-gray-950 transition hover:bg-amber-400"
                            aria-label="Create a new collaboration"
                            title="New collaboration"
                        >
                            <Icon path={ICONS.plus} className="h-5 w-5" />
                        </Link>
                    )}
                </div>
            </form>

            {!isRunningInElectron && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
                    <Icon path={ICONS.desktop} className="mt-0.5 h-5 w-5 flex-none text-blue-600 dark:text-blue-300" />
                    <div className="text-sm">
                        <p className="font-bold text-blue-900 dark:text-blue-100">Desktop client needed for save files</p>
                        <p className="mt-0.5 text-blue-700 dark:text-blue-300">
                            Search, join and follow projects on the web. Creating a collaboration and uploading saves uses the
                            {' '}<Link to="/client-info" className="font-bold underline">PlanetCreations desktop client</Link>.
                        </p>
                    </div>
                </div>
            )}

            {filteredCollaborations.length > 0 ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredCollaborations.map((collaboration) => (
                        <CollaborationCard
                            key={collaboration.id}
                            collaboration={collaboration}
                            memberCount={collaboration.memberCount ?? collaboration.memberIds?.length ?? 0}
                        />
                    ))}
                </div>
            ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center dark:border-gray-700 dark:bg-gray-800">
                    <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-700">
                        <Icon path={ICONS.users} className="h-7 w-7 text-gray-400" />
                    </span>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                        {searchTerm || filterStatus !== 'all'
                            ? 'No matching collaborations'
                            : isRunningInElectron
                                ? 'Start your first collaboration'
                                : 'No collaborations yet'}
                    </h3>
                    <p className="mx-auto mt-2 max-w-md text-gray-500 dark:text-gray-400">
                        {searchTerm || filterStatus !== 'all'
                            ? 'Adjust the search or status filter to see more projects.'
                            : isRunningInElectron
                                ? 'Create a project for one shared park or zoo, or join an existing team with its code.'
                                : 'Join an existing team with its share code, or browse public projects here.'}
                    </p>
                    {!searchTerm && filterStatus === 'all' && (
                        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                            {isRunningInElectron && (
                                <Link to="/collaboration/create" className="rounded-full bg-amber-500 px-5 py-2.5 font-bold text-gray-950 hover:bg-amber-400">
                                    Create collaboration
                                </Link>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    searchInputRef.current?.focus();
                                    searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }}
                                className="rounded-full bg-gray-100 px-5 py-2.5 font-bold text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                            >
                                Enter share code
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CollaborationsTab;
