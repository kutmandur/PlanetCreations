import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    cancelInvitation,
    fetchCollaborationApplications,
    fetchCollaborationPendingInvitations,
    removeMember,
    respondToApplication,
    updateMemberRole,
} from '../../firebase/collaboration';
import SendInviteModal from '../modals/SendInviteModal';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const ROLE_STYLES = {
    owner: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    editor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

const ROLE_DESCRIPTIONS = {
    owner: 'Manages access, settings and the project.',
    editor: 'Can build, upload versions and contribute.',
    viewer: 'Can follow the project without editing the save.',
};

const formatJoinDate = (timestamp) => {
    if (!timestamp) return 'Join date unavailable';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return `Joined ${date.toLocaleDateString()}`;
};

const CollaborationMemberList = ({
    members,
    currentUserId,
    isOwner,
    collaborationId,
    setModalMessage,
    setConfirmation,
    onMembersChanged,
    accentColor = '#6B7280',
}) => {
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [pendingApplications, setPendingApplications] = useState([]);
    const [processingId, setProcessingId] = useState(null);

    const loadPending = useCallback(async () => {
        if (!isOwner) {
            setPendingInvites([]);
            setPendingApplications([]);
            return;
        }
        try {
            const [invitations, applications] = await Promise.all([
                fetchCollaborationPendingInvitations(collaborationId),
                fetchCollaborationApplications(collaborationId),
            ]);
            setPendingInvites(invitations);
            setPendingApplications(applications);
        } catch (error) {
            console.error('Error loading collaboration access requests:', error);
        }
    }, [collaborationId, isOwner]);

    useEffect(() => {
        loadPending();
    }, [loadPending]);

    const sortedMembers = useMemo(() => {
        const order = { owner: 0, editor: 1, viewer: 2 };
        return [...members].sort((a, b) => (
            (order[a.role] ?? 3) - (order[b.role] ?? 3) ||
            String(a.username || '').localeCompare(String(b.username || ''))
        ));
    }, [members]);

    const handleApplication = async (application, approve) => {
        setProcessingId(`application-${application.id}`);
        try {
            await respondToApplication(collaborationId, application.id, approve);
            setPendingApplications((current) => current.filter((item) => item.id !== application.id));
            if (approve) await onMembersChanged?.();
            setModalMessage(
                approve
                    ? `${application.username} has joined the collaboration.`
                    : `Application from ${application.username} declined.`,
            );
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleCancelInvite = (invitation) => {
        setConfirmation({
            message: `Cancel the invitation to ${invitation.targetUsername}?`,
            onConfirm: async () => {
                try {
                    await cancelInvitation(
                        collaborationId,
                        invitation.targetUserId,
                    );
                    setPendingInvites((current) => current.filter((item) => item.id !== invitation.id));
                    setModalMessage('Invitation cancelled.');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            },
        });
    };

    const handleRoleChange = async (memberId, role) => {
        setProcessingId(`member-${memberId}`);
        try {
            await updateMemberRole(collaborationId, memberId, role);
            await onMembersChanged?.();
            setModalMessage(`Role updated to ${role}.`);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleRemoveMember = (member) => {
        setConfirmation({
            message: `Remove ${member.username} from this collaboration? Their past contributor credit will remain.`,
            onConfirm: async () => {
                try {
                    await removeMember(collaborationId, member.id);
                    await onMembersChanged?.();
                    setModalMessage(`${member.username} has been removed.`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            },
        });
    };

    return (
        <div className="space-y-6">
            <section className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="mx-auto max-w-2xl">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Contributors</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Editors can take build turns and upload versions. Viewers can follow the project.
                    </p>
                </div>
                {isOwner && (
                    <button
                        type="button"
                        onClick={() => setShowInviteModal(true)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 font-bold text-white shadow-sm transition hover:brightness-110"
                        style={{ backgroundColor: accentColor }}
                    >
                        <Icon path={ICONS.userPlus} className="h-5 w-5" />
                        Invite contributor
                    </button>
                )}
            </section>

            {isOwner && (pendingApplications.length > 0 || pendingInvites.length > 0) && (
                <div className="grid gap-6 lg:grid-cols-2">
                    {pendingApplications.length > 0 && (
                        <section className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 shadow-sm dark:border-blue-900 dark:bg-blue-950/30">
                            <div className="border-b border-blue-200 px-5 py-4 dark:border-blue-900">
                                <h3 className="flex items-center justify-center gap-2 text-center font-bold text-blue-950 dark:text-blue-100">
                                    <Icon path={ICONS.userPlus} className="h-5 w-5" />
                                    Join requests
                                    <span className="rounded-full bg-blue-200 px-2 py-0.5 text-xs dark:bg-blue-900">{pendingApplications.length}</span>
                                </h3>
                            </div>
                            <div className="divide-y divide-blue-200 dark:divide-blue-900">
                                {pendingApplications.map((application) => {
                                    const processing = processingId === `application-${application.id}`;
                                    return (
                                        <article key={application.id} className="bg-white/70 p-5 dark:bg-gray-900/20">
                                            <Link to={`/profile/${application.id}`} className="font-bold text-gray-900 hover:underline dark:text-gray-100">
                                                {application.username}
                                            </Link>
                                            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">
                                                {application.message || 'No message included.'}
                                            </p>
                                            <div className="mt-4 flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleApplication(application, true)}
                                                    disabled={processing}
                                                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleApplication(application, false)}
                                                    disabled={processing}
                                                    className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                                >
                                                    Decline
                                                </button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {pendingInvites.length > 0 && (
                        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
                            <div className="border-b border-amber-200 px-5 py-4 dark:border-amber-900">
                                <h3 className="flex items-center justify-center gap-2 text-center font-bold text-amber-950 dark:text-amber-100">
                                    <Icon path={ICONS.envelope} className="h-5 w-5" />
                                    Pending invitations
                                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs dark:bg-amber-900">{pendingInvites.length}</span>
                                </h3>
                            </div>
                            <div className="divide-y divide-amber-200 dark:divide-amber-900">
                                {pendingInvites.map((invitation) => (
                                    <article key={invitation.id} className="flex items-center justify-between gap-3 bg-white/70 p-5 dark:bg-gray-900/20">
                                        <div className="min-w-0">
                                            <p className="truncate font-bold text-gray-900 dark:text-gray-100">{invitation.targetUsername}</p>
                                            <p className="text-sm capitalize text-gray-500 dark:text-gray-400">{invitation.role}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleCancelInvite(invitation)}
                                            className="rounded-lg px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                        >
                                            Cancel
                                        </button>
                                    </article>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            )}

            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {sortedMembers.map((member) => {
                        const isCurrentUser = member.id === currentUserId;
                        const canManage = isOwner && !isCurrentUser && member.role !== 'owner';
                        const saving = processingId === `member-${member.id}`;
                        const initials = String(member.username || '?').slice(0, 2).toUpperCase();

                        return (
                            <article key={member.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span
                                        className="flex h-11 w-11 flex-none items-center justify-center rounded-xl font-bold text-white"
                                        style={{ backgroundColor: accentColor }}
                                    >
                                        {initials}
                                    </span>
                                    <div className="min-w-0">
                                        <Link to={`/profile/${member.id}`} className="truncate font-bold text-gray-900 hover:underline dark:text-gray-100">
                                            {member.username || 'Unknown member'}
                                            {isCurrentUser && <span className="ml-1 font-normal text-gray-400">(you)</span>}
                                        </Link>
                                        <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                                            {ROLE_DESCRIPTIONS[member.role] || ROLE_DESCRIPTIONS.viewer}
                                        </p>
                                        <p className="text-xs text-gray-400">{formatJoinDate(member.joinedAt)}</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 sm:justify-end">
                                    {canManage ? (
                                        <select
                                            value={member.role}
                                            onChange={(event) => handleRoleChange(member.id, event.target.value)}
                                            disabled={saving}
                                            aria-label={`Role for ${member.username}`}
                                            className={`rounded-full border-0 px-3 py-1.5 text-sm font-bold capitalize focus:outline-none focus:ring-2 ${ROLE_STYLES[member.role] || ROLE_STYLES.viewer}`}
                                            style={{ '--tw-ring-color': accentColor }}
                                        >
                                            <option value="editor">Editor</option>
                                            <option value="viewer">Viewer</option>
                                        </select>
                                    ) : (
                                        <span className={`rounded-full px-3 py-1.5 text-sm font-bold capitalize ${ROLE_STYLES[member.role] || ROLE_STYLES.viewer}`}>
                                            {member.role || 'viewer'}
                                        </span>
                                    )}
                                    {canManage && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveMember(member)}
                                            className="rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                                            title="Remove member"
                                            aria-label={`Remove ${member.username}`}
                                        >
                                            <Icon path={ICONS.xMark} className="h-5 w-5" />
                                        </button>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
                {members.length === 0 && (
                    <p className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">No members found.</p>
                )}
            </section>

            {showInviteModal && (
                <SendInviteModal
                    collaborationId={collaborationId}
                    currentUserId={currentUserId}
                    existingMemberIds={members.map((member) => member.id)}
                    accentColor={accentColor}
                    onClose={() => setShowInviteModal(false)}
                    onInvitationSent={loadPending}
                    setModalMessage={setModalMessage}
                />
            )}
        </div>
    );
};

export default CollaborationMemberList;
