import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { assignCommunityRole, kickUser, kickAndReportUser } from '../../firebase/community';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import ProfilePage from '../pages/ProfilePage'; // ⚠️ Make sure this path is correct!

// This component now renders the full UserProfilePage in a large modal.
const ProfilePopover = ({ userId, onClose, user, userProfile, setReportModal, setModalMessage, setConfirmation }) => {
    const popoverRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onClose]);

    return createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-75 z-40 flex items-center justify-center p-4 sm:p-6 md:p-8">
            <div ref={popoverRef} className="bg-white rounded-lg shadow-xl w-full h-full max-w-5xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-2 border-b bg-gray-50 rounded-t-lg">
                    <span className="text-lg font-bold text-gray-700 ml-4">User Profile</span>
                    <button 
                        onClick={onClose} 
                        className="text-gray-400 hover:text-gray-700 p-1 rounded-full transition-colors"
                        aria-label="Close profile"
                    >
                        <Icon path={ICONS.xMark} className="w-6 h-6" />
                    </button>
                </div>
                <div className="overflow-y-auto flex-grow">
                    <ProfilePage
                        userIdOverride={userId}
                        user={user}
                        userProfile={userProfile}
                        setReportModal={setReportModal}
                        setModalMessage={setModalMessage}
                        setConfirmation={setConfirmation}
                    />
                </div>
            </div>
        </div>,
        document.body
    );
};


const RankSelectorPopover = ({ ranks, memberRoles, onRoleChange, onClose, position, memberId }) => {
    const popoverRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onClose]);

    const popoverStyle = {
        position: 'absolute',
        top: `${position.top}px`,
        left: `${position.left}px`,
    };

    return createPortal(
        <div
            ref={popoverRef}
            className="z-50 w-56 bg-white rounded-md shadow-lg border max-h-60 overflow-y-auto"
            style={popoverStyle}
        >
            {ranks.map(rank => {
                const isOwnerRank = rank.name.toLowerCase() === 'owner';
                const isDisabled = isOwnerRank;

                return (
                    <label key={rank.name} className={`flex items-center px-4 py-2 text-sm text-gray-700 ${isDisabled ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'hover:bg-gray-100 cursor-pointer'}`}>
                        <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                            checked={memberRoles.includes(rank.name.toLowerCase())}
                            onChange={() => onRoleChange(memberId, rank.name.toLowerCase())}
                            disabled={isDisabled}
                        />
                        <span className="ml-3">{rank.name}</span>
                    </label>
                );
            })}
        </div>,
        document.body
    );
};


const MemberManager = ({ members, ranks, communityId, user, userProfile, setModalMessage, setConfirmation, setReportModal, currentUserRankWeight, currentUserId }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [rankFilter, setRankFilter] = useState('all');
    const [loadingStates, setLoadingStates] = useState({});
    const [rankPopoverState, setRankPopoverState] = useState(null);
    const [profilePopoverState, setProfilePopoverState] = useState(null);

    const getMemberRoles = (member) => {
        if (!member) return [];
        if (member.roles && Array.isArray(member.roles)) {
            return member.roles;
        }
        if (member.role && typeof member.role === 'string') {
            return [member.role];
        }
        return [];
    };

    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#ffffff';
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    };

    const handleRolesChange = async (targetUserId, toggledRole) => {
        const member = members.find(m => m.id === targetUserId);
        if (!member) return;

        const currentRoles = getMemberRoles(member);

        if (toggledRole === 'owner' && currentRoles.includes('owner')) {
            setModalMessage("The owner rank cannot be removed.");
            return;
        }

        let newRoles;

        if (currentRoles.includes(toggledRole)) {
            if (currentRoles.length === 1) {
                setModalMessage("A member must have at least one rank.");
                return;
            }
            newRoles = currentRoles.filter(r => r !== toggledRole);
        } else {
            newRoles = [...currentRoles, toggledRole];
        }

        setLoadingStates(prev => ({ ...prev, [targetUserId]: true }));
        try {
            await assignCommunityRole(communityId, targetUserId, newRoles);
        } catch (error) {
            setModalMessage(`Error updating rank: ${error.message}`);
        } finally {
            setLoadingStates(prev => ({ ...prev, [targetUserId]: false }));
        }
    };
    
    const handleOpenRankPopover = (event, memberId) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setRankPopoverState({
            memberId: memberId,
            position: {
                top: rect.bottom + window.scrollY,
                left: rect.left + window.scrollX,
            }
        });
    };
    
    const handleKick = (member) => {
        setConfirmation({
            message: `Are you sure you want to kick ${member.username}?`,
            onConfirm: async () => {
                try {
                    await kickUser(communityId, member.id);
                    setModalMessage(`${member.username} has been kicked from the community.`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const handleKickAndReport = (member) => {
        const reason = prompt(`Please provide a reason for kicking and reporting ${member.username}:`);
        if (reason) {
            setConfirmation({
                message: `Are you sure you want to kick and report ${member.username}? This will also create a report for site moderators to review.`,
                onConfirm: async () => {
                    try {
                        await kickAndReportUser(communityId, member.id, reason, currentUserId);
                        setModalMessage(`${member.username} has been kicked and reported.`);
                    } catch (error) {
                        setModalMessage(`Error: ${error.message}`);
                    }
                }
            });
        }
    };


    const getHighestRankWeight = (memberRoles) => {
        if (!memberRoles || memberRoles.length === 0) return 99;
        const weights = memberRoles.map(role => {
            const rank = ranks.find(r => r.name.toLowerCase() === role.toLowerCase());
            return rank ? rank.weight : 99;
        });
        return Math.min(...weights);
    };

    const filteredMembers = useMemo(() => {
        return members
            .filter(member => {
                const searchMatch = member.username?.toLowerCase().includes(searchTerm.toLowerCase());
                const memberRoles = getMemberRoles(member);
                const rankMatch = rankFilter === 'all' || memberRoles.includes(rankFilter);
                return searchMatch && rankMatch;
            })
            .sort((a, b) => getHighestRankWeight(getMemberRoles(a)) - getHighestRankWeight(getMemberRoles(b)));
    }, [members, searchTerm, rankFilter, ranks]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
                <div className="relative flex-grow">
                    <input
                        type="text"
                        placeholder="Search members by username..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full p-2 pl-10 border rounded-lg"
                    />
                    <Icon path={ICONS.search} className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
                <div className="relative">
                    <select
                        value={rankFilter}
                        onChange={(e) => setRankFilter(e.target.value)}
                        className="w-full sm:w-auto p-2 border rounded-lg appearance-none pr-8"
                    >
                        <option value="all">All Ranks</option>
                        {ranks.map(rank => (
                            <option key={rank.name} value={rank.name.toLowerCase()}>{rank.name}</option>
                        ))}
                    </select>
                    <Icon path={ICONS.filter} className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead className="border-b bg-gray-50">
                        <tr>
                            <th className="p-2 font-semibold">Username</th>
                            <th className="p-2 font-semibold">Joined</th>
                            <th className="p-2 font-semibold">Rank</th>
                            <th className="p-2 font-semibold">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredMembers.map(member => {
                            const memberRoles = getMemberRoles(member);
                            const memberRankWeight = getHighestRankWeight(memberRoles);
                            const canManageMember = currentUserRankWeight < memberRankWeight;

                            return (
                                <tr key={member.id} className="border-b hover:bg-gray-50">
                                    <td className="p-2">
                                        <button onClick={() => setProfilePopoverState({ userId: member.id })} className="text-blue-500 hover:underline font-semibold">
                                            {member.username || 'N/A'}
                                        </button>
                                    </td>
                                    <td className="p-2 text-gray-500">
                                        {member.joinedAt ? new Date(member.joinedAt.seconds * 1000).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="p-2">
                                        {loadingStates[member.id] ? <Spinner gameId="default" /> : (
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {canManageMember && (
                                                    <button
                                                        onClick={(e) => handleOpenRankPopover(e, member.id)}
                                                        className="text-xs bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-2 rounded-md"
                                                    >
                                                        Assign Ranks
                                                    </button>
                                                )}
                                                
                                                {memberRoles.map(role => {
                                                    const isOwnerRole = role.toLowerCase() === 'owner';
                                                    const rankInfo = ranks.find(r => r.name.toLowerCase() === role);
                                                    const bgColor = rankInfo ? rankInfo.color : '#6B7280';
                                                    const textColor = getTextColorForBackground(bgColor);

                                                    return (
                                                        <div 
                                                            key={role} 
                                                            className="group relative text-xs font-semibold px-2.5 py-1 rounded-full flex items-center capitalize"
                                                            style={{ backgroundColor: bgColor, color: textColor }}
                                                        >
                                                            <span>{role}</span>
                                                            {!isOwnerRole && canManageMember && (
                                                                <button
                                                                    onClick={() => handleRolesChange(member.id, role)}
                                                                    className="absolute inset-0 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                                                                    aria-label={`Remove ${role} rank`}
                                                                >
                                                                    <Icon path={ICONS.xMark || "M6 18L18 6M6 6l12 12"} className="w-3 h-3" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {canManageMember && (
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => handleKick(member)} className="text-xs bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-1 px-2 rounded-md">Kick</button>
                                                <button onClick={() => handleKickAndReport(member)} className="text-xs bg-red-500 hover:bg-red-600 text-white font-semibold py-1 px-2 rounded-md">Kick & Report</button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {rankPopoverState && (
                <RankSelectorPopover
                    ranks={ranks}
                    memberRoles={getMemberRoles(members.find(m => m.id === rankPopoverState.memberId))}
                    onRoleChange={handleRolesChange}
                    onClose={() => setRankPopoverState(null)}
                    position={rankPopoverState.position}
                    memberId={rankPopoverState.memberId}
                />
            )}

            {profilePopoverState && (
                <ProfilePopover
                    userId={profilePopoverState.userId}
                    onClose={() => setProfilePopoverState(null)}
                    user={user}
                    userProfile={userProfile}
                    setReportModal={setReportModal}
                    setModalMessage={setModalMessage}
                    setConfirmation={setConfirmation}
                />
            )}
        </div>
    );
};

export default MemberManager;