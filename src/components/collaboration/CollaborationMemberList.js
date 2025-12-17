import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { updateMemberRole, removeMember, fetchCollaborationPendingInvitations, cancelInvitation } from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import SendInviteModal from '../modals/SendInviteModal';

const ROLE_STYLES = {
    owner: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Owner' },
    editor: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Editor' },
    viewer: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Viewer' }
};

const CollaborationMemberList = ({
    members,
    currentUserId,
    isOwner,
    collaborationId,
    setModalMessage,
    setConfirmation
}) => {
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [pendingInvites, setPendingInvites] = useState([]);

    useEffect(() => {
        if (isOwner) {
            fetchCollaborationPendingInvitations(collaborationId)
                .then(setPendingInvites)
                .catch(err => console.error('Error loading invites:', err));
        }
    }, [collaborationId, isOwner]);

    const handleCancelInvite = (invite) => {
        setConfirmation({
            message: `Cancel invitation to ${invite.targetUsername}?`,
            onConfirm: async () => {
                try {
                    await cancelInvitation(collaborationId, invite.id);
                    setPendingInvites(prev => prev.filter(i => i.id !== invite.id));
                    setModalMessage('Invitation cancelled.');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };
    const sortedMembers = [...members].sort((a, b) => {
        const roleOrder = { owner: 0, editor: 1, viewer: 2 };
        return (roleOrder[a.role] || 3) - (roleOrder[b.role] || 3);
    });

    const handleRoleChange = async (memberId, newRole) => {
        try {
            await updateMemberRole(collaborationId, memberId, newRole);
            setModalMessage(`Role updated to ${newRole}.`);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleRemoveMember = (member) => {
        setConfirmation({
            message: `Remove ${member.username} from this collaboration?`,
            onConfirm: async () => {
                try {
                    await removeMember(collaborationId, member.id);
                    setModalMessage(`${member.username} has been removed.`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const formatJoinDate = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString();
    };

    const memberIds = members.map(m => m.id);

    return (
        <div className="space-y-4">
            {/* Invite Button */}
            {isOwner && (
                <div className="flex justify-end">
                    <button
                        onClick={() => setShowInviteModal(true)}
                        className="inline-flex items-center bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                    >
                        <Icon path={ICONS.userPlus} className="w-5 h-5 mr-2" />
                        Invite User
                    </button>
                </div>
            )}

            {/* Pending Invitations */}
            {isOwner && pendingInvites.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h3 className="font-medium text-yellow-800 mb-3 flex items-center gap-2">
                        <Icon path={ICONS.clock} className="w-5 h-5" />
                        Pending Invitations ({pendingInvites.length})
                    </h3>
                    <div className="space-y-2">
                        {pendingInvites.map(invite => (
                            <div
                                key={invite.id}
                                className="bg-white rounded-lg p-3 flex items-center justify-between"
                            >
                                <div>
                                    <span className="font-medium text-gray-800">{invite.targetUsername}</span>
                                    <span className="text-sm text-gray-500 ml-2">
                                        as {invite.role}
                                    </span>
                                </div>
                                <button
                                    onClick={() => handleCancelInvite(invite)}
                                    className="text-red-500 hover:text-red-700 text-sm font-medium"
                                >
                                    Cancel
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Member List */}
            <div className="space-y-3">
            {sortedMembers.map(member => {
                const roleStyle = ROLE_STYLES[member.role] || ROLE_STYLES.viewer;
                const isCurrentUser = member.id === currentUserId;
                const canManage = isOwner && !isCurrentUser && member.role !== 'owner';

                return (
                    <div
                        key={member.id}
                        className="bg-white rounded-lg shadow-sm border border-gray-200 p-4"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                                    <Icon path={ICONS.user} className="w-5 h-5 text-gray-500" />
                                </div>
                                <div>
                                    <Link
                                        to={`/profile/${member.id}`}
                                        className="font-medium text-gray-800 hover:text-purple-600 transition-colors"
                                    >
                                        {member.username}
                                        {isCurrentUser && (
                                            <span className="text-gray-500 text-sm ml-1">(you)</span>
                                        )}
                                    </Link>
                                    <p className="text-xs text-gray-500">
                                        Joined {formatJoinDate(member.joinedAt)}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {/* Role Badge or Dropdown */}
                                {canManage ? (
                                    <select
                                        value={member.role}
                                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                                        className={`px-3 py-1 text-sm font-medium rounded-full border-0 cursor-pointer ${roleStyle.bg} ${roleStyle.text}`}
                                    >
                                        <option value="editor">Editor</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                ) : (
                                    <span className={`px-3 py-1 text-sm font-medium rounded-full ${roleStyle.bg} ${roleStyle.text}`}>
                                        {roleStyle.label}
                                    </span>
                                )}

                                {/* Remove Button */}
                                {canManage && (
                                    <button
                                        onClick={() => handleRemoveMember(member)}
                                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Remove member"
                                    >
                                        <Icon path={ICONS.xMark} className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}

            {members.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                    No members found.
                </div>
            )}
            </div>

            {/* Send Invite Modal */}
            {showInviteModal && (
                <SendInviteModal
                    collaborationId={collaborationId}
                    currentUserId={currentUserId}
                    existingMemberIds={memberIds}
                    onClose={() => setShowInviteModal(false)}
                    setModalMessage={setModalMessage}
                />
            )}
        </div>
    );
};

export default CollaborationMemberList;
