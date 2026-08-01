import React, { useEffect, useState } from 'react';
import { searchUsersForInvite, sendInvitation } from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const SendInviteModal = ({
    collaborationId,
    currentUserId,
    existingMemberIds,
    accentColor = '#6B7280',
    onClose,
    onInvitationSent,
    setModalMessage,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedRole, setSelectedRole] = useState('editor');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        const normalized = searchTerm.trim();
        if (normalized.length < 2 || selectedUser) {
            setSearchResults([]);
            setSearchError('');
            return undefined;
        }

        let active = true;
        const timer = window.setTimeout(async () => {
            setSearching(true);
            setSearchError('');
            try {
                const results = await searchUsersForInvite(normalized);
                if (!active) return;
                setSearchResults(results.filter(
                    (user) => user.id !== currentUserId && !existingMemberIds.includes(user.id),
                ));
            } catch (error) {
                if (active) {
                    setSearchResults([]);
                    setSearchError(error.message || 'Search failed.');
                }
            } finally {
                if (active) setSearching(false);
            }
        }, 300);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [searchTerm, currentUserId, existingMemberIds, selectedUser]);

    const handleSelectUser = (user) => {
        setSelectedUser(user);
        setSearchTerm('');
        setSearchResults([]);
    };

    const handleSendInvite = async () => {
        if (!selectedUser || sending) return;
        setSending(true);
        try {
            await sendInvitation(collaborationId, selectedUser.id, selectedRole);
            await onInvitationSent?.();
            setModalMessage(`Invitation sent to ${selectedUser.username}.`);
            onClose();
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setSending(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="direct-invite-title"
            >
                <div className="h-2" style={{ backgroundColor: accentColor }} />
                <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: accentColor }}>
                                Direct invitation
                            </p>
                            <h2 id="direct-invite-title" className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                                Invite a contributor
                            </h2>
                            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                                Search by username and choose whether they can build or only follow the project.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-white"
                            aria-label="Close"
                        >
                            <Icon path={ICONS.xMark} className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="mt-6 space-y-5">
                        {selectedUser ? (
                            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
                                <div
                                    className="flex h-11 w-11 flex-none items-center justify-center rounded-full font-bold text-white"
                                    style={{ backgroundColor: accentColor }}
                                >
                                    {selectedUser.username?.charAt(0).toUpperCase() || '?'}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-bold text-gray-900 dark:text-white">{selectedUser.username}</p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Selected for invitation</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedUser(null)}
                                    className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-white"
                                    aria-label={`Remove ${selectedUser.username}`}
                                >
                                    <Icon path={ICONS.xMark} className="h-5 w-5" />
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <label htmlFor="invite-user-search" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-200">
                                    Username
                                </label>
                                <div className="relative">
                                    <input
                                        id="invite-user-search"
                                        type="search"
                                        value={searchTerm}
                                        onChange={(event) => setSearchTerm(event.target.value)}
                                        placeholder="Start typing a username..."
                                        autoFocus
                                        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pr-11 text-gray-900 outline-none transition focus:border-[--game-color] focus:ring-2 focus:ring-[--game-color]/25 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                                        style={{ '--game-color': accentColor }}
                                    />
                                    {searching && (
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2">
                                            <Spinner size="small" />
                                        </span>
                                    )}
                                </div>

                                {searchResults.length > 0 && (
                                    <div className="absolute z-10 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                                        {searchResults.map((user) => (
                                            <button
                                                key={user.id}
                                                type="button"
                                                onClick={() => handleSelectUser(user)}
                                                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                                                    {user.username?.charAt(0).toUpperCase() || '?'}
                                                </span>
                                                <span className="font-semibold text-gray-900 dark:text-white">{user.username}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {searchTerm.trim().length >= 2 && !searching && searchResults.length === 0 && (
                                    <p className={`mt-2 text-sm ${searchError ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                        {searchError || 'No available users found.'}
                                    </p>
                                )}
                            </div>
                        )}

                        {selectedUser && (
                            <fieldset>
                                <legend className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-200">Access</legend>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {[
                                        {
                                            id: 'editor',
                                            label: 'Contributor',
                                            hint: 'Can start a build session and upload the shared save.',
                                            icon: ICONS.pencil,
                                        },
                                        {
                                            id: 'viewer',
                                            label: 'Viewer',
                                            hint: 'Can follow status, tasks, members and version history.',
                                            icon: ICONS.eye,
                                        },
                                    ].map((role) => {
                                        const selected = selectedRole === role.id;
                                        return (
                                            <button
                                                key={role.id}
                                                type="button"
                                                onClick={() => setSelectedRole(role.id)}
                                                className={`rounded-2xl border-2 p-4 text-left transition ${
                                                    selected
                                                        ? 'bg-gray-50 shadow-sm dark:bg-gray-900/60'
                                                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                                                }`}
                                                style={selected ? { borderColor: accentColor } : undefined}
                                                aria-pressed={selected}
                                            >
                                                <span className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                                                    <span style={selected ? { color: accentColor } : undefined}>
                                                        <Icon path={role.icon} className="h-5 w-5" />
                                                    </span>
                                                    {role.label}
                                                </span>
                                                <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">{role.hint}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>
                        )}
                    </div>

                    <div className="mt-7 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={sending}
                            className="flex-1 rounded-xl bg-gray-100 px-5 py-3 font-bold text-gray-800 transition hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSendInvite}
                            disabled={!selectedUser || sending}
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ backgroundColor: accentColor }}
                        >
                            {sending ? <Spinner size="small" /> : (
                                <>
                                    <Icon path={ICONS.paperAirplane} className="h-5 w-5" />
                                    Send invite
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SendInviteModal;
