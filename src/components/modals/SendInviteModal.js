import React, { useState, useEffect } from 'react';
import { sendInvitation, searchUsersForInvite } from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const SendInviteModal = ({ collaborationId, currentUserId, existingMemberIds, onClose, setModalMessage }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedRole, setSelectedRole] = useState('editor');
    const [sending, setSending] = useState(false);

    // Debounced search
    useEffect(() => {
        if (searchTerm.length < 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const results = await searchUsersForInvite(searchTerm);
                // Filter out current members and self
                const filtered = results.filter(
                    user => user.id !== currentUserId && !existingMemberIds.includes(user.id)
                );
                setSearchResults(filtered);
            } catch (error) {
                console.error('Search error:', error);
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchTerm, currentUserId, existingMemberIds]);

    const handleSelectUser = (user) => {
        setSelectedUser(user);
        setSearchTerm('');
        setSearchResults([]);
    };

    const handleSendInvite = async () => {
        if (!selectedUser) return;

        setSending(true);
        try {
            await sendInvitation(collaborationId, currentUserId, selectedUser.id, selectedRole);
            setModalMessage(`Invitation sent to ${selectedUser.username}!`);
            onClose();
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-purple-500 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Icon path={ICONS.userPlus} className="w-6 h-6" />
                            Invite Member
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <Icon path={ICONS.xMark} className="w-6 h-6" />
                        </button>
                    </div>
                    <p className="text-white/80 mt-2 text-sm">
                        Search for a user to invite to this collaboration
                    </p>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">
                    {/* Selected User */}
                    {selectedUser ? (
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-purple-200 rounded-full flex items-center justify-center">
                                        <span className="text-purple-700 font-medium">
                                            {selectedUser.username?.charAt(0).toUpperCase() || '?'}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-800">{selectedUser.username}</p>
                                        <p className="text-sm text-gray-500">Selected for invitation</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedUser(null)}
                                    className="p-1 hover:bg-purple-100 rounded transition-colors"
                                >
                                    <Icon path={ICONS.xMark} className="w-5 h-5 text-purple-600" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Search Input */
                        <div className="relative">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Search by username
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Enter username..."
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                                {searching && (
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                        <Spinner size="small" />
                                    </div>
                                )}
                            </div>

                            {/* Search Results Dropdown */}
                            {searchResults.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {searchResults.map(user => (
                                        <button
                                            key={user.id}
                                            onClick={() => handleSelectUser(user)}
                                            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                                        >
                                            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                                                <span className="text-gray-600 font-medium text-sm">
                                                    {user.username?.charAt(0).toUpperCase() || '?'}
                                                </span>
                                            </div>
                                            <span className="font-medium text-gray-800">{user.username}</span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {searchTerm.length >= 2 && !searching && searchResults.length === 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500">
                                    No users found
                                </div>
                            )}
                        </div>
                    )}

                    {/* Role Selection */}
                    {selectedUser && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Role
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setSelectedRole('editor')}
                                    className={`p-3 rounded-lg border-2 transition-colors text-left ${
                                        selectedRole === 'editor'
                                            ? 'border-purple-500 bg-purple-50'
                                            : 'border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Icon path={ICONS.pencil} className={`w-5 h-5 ${selectedRole === 'editor' ? 'text-purple-600' : 'text-gray-500'}`} />
                                        <span className={`font-medium ${selectedRole === 'editor' ? 'text-purple-700' : 'text-gray-700'}`}>
                                            Editor
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Can upload and edit files
                                    </p>
                                </button>
                                <button
                                    onClick={() => setSelectedRole('viewer')}
                                    className={`p-3 rounded-lg border-2 transition-colors text-left ${
                                        selectedRole === 'viewer'
                                            ? 'border-purple-500 bg-purple-50'
                                            : 'border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Icon path={ICONS.eye} className={`w-5 h-5 ${selectedRole === 'viewer' ? 'text-purple-600' : 'text-gray-500'}`} />
                                        <span className={`font-medium ${selectedRole === 'viewer' ? 'text-purple-700' : 'text-gray-700'}`}>
                                            Viewer
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Can view and comment only
                                    </p>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSendInvite}
                            disabled={!selectedUser || sending}
                            className="flex-1 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            {sending ? (
                                <Spinner size="small" />
                            ) : (
                                <>
                                    <Icon path={ICONS.paperAirplane} className="w-5 h-5" />
                                    Send Invite
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
