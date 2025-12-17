import React, { useState, useEffect } from 'react';
import { fetchUserPendingInvitations, acceptInvitation, declineInvitation } from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const PendingInvitations = ({ userId, setModalMessage, onInvitationHandled }) => {
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);

    useEffect(() => {
        if (!userId) return;

        const loadInvitations = async () => {
            try {
                const invites = await fetchUserPendingInvitations(userId);
                setInvitations(invites);
            } catch (error) {
                console.error('Error loading invitations:', error);
            } finally {
                setLoading(false);
            }
        };

        loadInvitations();
    }, [userId]);

    const handleAccept = async (invite) => {
        setProcessingId(invite.id);
        try {
            await acceptInvitation(invite.collaborationId, invite.inviteId, userId);
            setInvitations(prev => prev.filter(i => i.id !== invite.id));
            setModalMessage(`You've joined "${invite.collaborationTitle}"!`);
            if (onInvitationHandled) onInvitationHandled();
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleDecline = async (invite) => {
        setProcessingId(invite.id);
        try {
            await declineInvitation(invite.collaborationId, invite.inviteId, userId);
            setInvitations(prev => prev.filter(i => i.id !== invite.id));
            setModalMessage('Invitation declined.');
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    };

    if (loading) {
        return null; // Don't show anything while loading
    }

    if (invitations.length === 0) {
        return null; // No pending invitations
    }

    return (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
                <Icon path={ICONS.envelope} className="w-5 h-5 text-yellow-600" />
                <h3 className="font-medium text-yellow-800">
                    Pending Invitations ({invitations.length})
                </h3>
            </div>

            <div className="space-y-3">
                {invitations.map(invite => (
                    <div
                        key={invite.id}
                        className="bg-white rounded-lg p-4 border border-yellow-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                        <div className="flex-1">
                            <p className="font-medium text-gray-800">
                                {invite.collaborationTitle}
                            </p>
                            <p className="text-sm text-gray-500">
                                Invited by <span className="font-medium">{invite.senderUsername}</span> as{' '}
                                <span className="font-medium capitalize">{invite.role}</span>
                                {' · '}
                                {formatTime(invite.createdAt)}
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => handleDecline(invite)}
                                disabled={processingId === invite.id}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                            >
                                Decline
                            </button>
                            <button
                                onClick={() => handleAccept(invite)}
                                disabled={processingId === invite.id}
                                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {processingId === invite.id ? (
                                    <Spinner size="small" />
                                ) : (
                                    <>
                                        <Icon path={ICONS.check} className="w-4 h-4" />
                                        Accept
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PendingInvitations;
