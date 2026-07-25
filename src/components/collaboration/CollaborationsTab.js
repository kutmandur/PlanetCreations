import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchUserCollaborations } from '../../firebase/collaboration';
import CollaborationCard from '../cards/CollaborationCard';
import PendingInvitations from './PendingInvitations';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const CollaborationsTab = ({ user, userProfile, setModalMessage }) => {
    const isRunningInElectron = window.electronAPI?.isElectron;
    const [collaborations, setCollaborations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [refreshKey, setRefreshKey] = useState(0);

    const loadCollaborations = useCallback(async () => {
        if (!user) {
            setCollaborations([]);
            setLoading(false);
            return;
        }

        try {
            const collabs = await fetchUserCollaborations(user.uid);
            setCollaborations(collabs);
        } catch (error) {
            console.error('Error loading collaborations:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        loadCollaborations();
    }, [loadCollaborations, refreshKey]);

    const handleInvitationHandled = () => {
        // Refresh collaborations when an invitation is accepted
        setRefreshKey(prev => prev + 1);
    };

    const filteredCollaborations = collaborations.filter(collab => {
        const matchesSearch = collab.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (collab.description && collab.description.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesStatus = filterStatus === 'all' || collab.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    // Login required - show for both web and client
    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center p-8">
                <Icon path={ICONS.lockClosed} className="w-16 h-16 text-gray-300 mb-4" />
                <h2 className="text-2xl font-bold text-gray-700 mb-2">Login Required</h2>
                <p className="text-gray-500 mb-4">Sign in to create and join collaborations.</p>
                <Link
                    to="/login"
                    className="inline-flex items-center bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                >
                    <Icon path={ICONS.user} className="w-5 h-5 mr-2" />
                    Sign In
                </Link>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Spinner />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Pending Invitations */}
            <PendingInvitations
                userId={user.uid}
                setModalMessage={setModalMessage}
                onInvitationHandled={handleInvitationHandled}
            />

            {/* Web Info Banner */}
            {!isRunningInElectron && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-start gap-3">
                    <Icon path={ICONS.infoCircle} className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="text-purple-800 font-medium">You're viewing on the web</p>
                        <p className="text-purple-600">
                            You can view collaborations, comments, and status updates.
                            File sharing requires the <Link to="/client-info" className="underline font-medium">desktop client</Link>.
                        </p>
                    </div>
                </div>
            )}

            {/* Header with Create Button */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                    <input
                        type="text"
                        placeholder="Search collaborations..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="flex-1 sm:w-64 p-3 bg-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="p-3 border border-gray-300 rounded-full shadow-sm bg-white"
                    >
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="archived">Archived</option>
                    </select>
                </div>
                <Link
                    to="/collaboration/create"
                    className="inline-flex items-center bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-6 rounded-full transition-colors shadow-lg"
                >
                    <Icon path={ICONS.plus} className="w-5 h-5 mr-2" />
                    New Collaboration
                </Link>
            </div>

            {/* Collaborations Grid */}
            {filteredCollaborations.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredCollaborations.map(collab => (
                        <CollaborationCard
                            key={collab.id}
                            collaboration={collab}
                            memberCount={collab.memberIds?.length || 0}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <Icon path={ICONS.users} className="w-20 h-20 text-gray-300 mb-4" />
                    {searchTerm || filterStatus !== 'all' ? (
                        <>
                            <h2 className="text-xl font-bold text-gray-700 mb-2">No Results</h2>
                            <p className="text-gray-500">Try adjusting your search or filters.</p>
                        </>
                    ) : (
                        <>
                            <h2 className="text-xl font-bold text-gray-700 mb-2">No Collaborations Yet</h2>
                            <p className="text-gray-500 mb-4">
                                Start a new collaboration or join one with an invite code.
                            </p>
                            <div className="flex gap-3">
                                <Link
                                    to="/collaboration/create"
                                    className="inline-flex items-center bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                                >
                                    <Icon path={ICONS.plus} className="w-5 h-5 mr-2" />
                                    Create
                                </Link>
                                <button
                                    onClick={() => {
                                        const code = prompt('Enter invite code:');
                                        if (code) {
                                            window.location.href = `#/collaboration/join/${code}`;
                                        }
                                    }}
                                    className="inline-flex items-center bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2 px-4 rounded-lg transition-colors"
                                >
                                    <Icon path={ICONS.share} className="w-5 h-5 mr-2" />
                                    Join with Code
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default CollaborationsTab;
