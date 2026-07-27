import React, { useEffect, useState } from 'react';
import {
    acceptInvitation,
    declineInvitation,
    fetchUserPendingInvitations,
} from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.max(0, Date.now() - date.getTime());
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
};

const PendingInvitations = ({
    userId,
    setModalMessage,
    onInvitationHandled,
}) => {
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);

    useEffect(() => {
        if (!userId) return undefined;
        let mounted = true;
        fetchUserPendingInvitations(userId)
            .then((items) => { if (mounted) setInvitations(items); })
            .catch((error) => console.error('Error loading invitations:', error))
            .finally(() => { if (mounted) setLoading(false); });
        return () => { mounted = false; };
    }, [userId]);

    const handleInvitation = async (invitation, accept) => {
        setProcessingId(invitation.id);
        try {
            if (accept) {
                await acceptInvitation(invitation.collaborationId, invitation.inviteId, userId);
            } else {
                await declineInvitation(invitation.collaborationId, invitation.inviteId, userId);
            }
            setInvitations((current) => current.filter((item) => item.id !== invitation.id));
            setModalMessage(
                accept
                    ? `You've joined "${invitation.collaborationTitle}".`
                    : 'Invitation declined.',
            );
            onInvitationHandled?.();
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    if (loading || invitations.length === 0) return null;

    return (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/30">
            <div className="flex items-center gap-3 border-b border-amber-200 px-5 py-4 dark:border-amber-900/70">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-200/70 dark:bg-amber-900/60">
                    <Icon path={ICONS.envelope} className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                </span>
                <div>
                    <h3 className="font-bold text-amber-950 dark:text-amber-100">Collaboration invitations</h3>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                        {invitations.length} {invitations.length === 1 ? 'team is' : 'teams are'} waiting for your response.
                    </p>
                </div>
            </div>

            <div className="divide-y divide-amber-200 dark:divide-amber-900/70">
                {invitations.map((invitation) => {
                    const processing = processingId === invitation.id;
                    return (
                        <div key={invitation.id} className="flex flex-col gap-4 bg-white/70 p-5 dark:bg-gray-900/20 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <p className="truncate font-bold text-gray-900 dark:text-gray-100">{invitation.collaborationTitle}</p>
                                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                                    Invited by <span className="font-semibold">{invitation.senderUsername}</span>
                                    {' · '}
                                    <span className="capitalize">{invitation.role}</span>
                                    {' · '}
                                    {formatTime(invitation.createdAt)}
                                </p>
                            </div>
                            <div className="flex flex-none gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleInvitation(invitation, false)}
                                    disabled={processing}
                                    className="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 sm:flex-none"
                                >
                                    Decline
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleInvitation(invitation, true)}
                                    disabled={processing}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
                                >
                                    {processing ? <Spinner size="small" /> : <Icon path={ICONS.check} className="h-4 w-4" />}
                                    Accept
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

export default PendingInvitations;
