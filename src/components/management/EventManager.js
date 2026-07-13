import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, getDoc, collection, query, where, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS, getGameColor } from '../../utils/helpers';
import AutoGroupSubmissionsModal from '../modals/AutoGroupSubmissionModal';

// Sub-component for rendering a single submission entry
const SubmissionItem = ({ submission, members, community, eventData, eventId, isDone, onDoneToggle, groupAssignments, groups, onGroupChange, onAssignVideo, onCopyToClipboard, onShowCreation, color }) => {
    
    const author = members.find(m => m.id === submission.userId);
    const authorRoles = author?.roles || [];
    const authorRanks = authorRoles.map(roleName => community.ranks.find(r => r.name.toLowerCase() === roleName.toLowerCase())).filter(Boolean);
    const customData = submission.eventSubmissions?.[eventId] || {};

    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#000000';
        try {
            const r = parseInt(hexColor.substr(1, 2), 16);
            const g = parseInt(hexColor.substr(3, 2), 16);
            const b = parseInt(hexColor.substr(5, 2), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? '#000000' : '#ffffff';
        } catch(e) { return '#000000'; }
    };

    return (
        <div className={`bg-white p-4 rounded-lg shadow-md border-l-4 transition-opacity ${isDone ? 'opacity-50' : 'opacity-100'}`} style={{borderColor: isDone ? '#9CA3AF' : color.bg.replace('bg-', '')}}>
            <div className="flex items-center gap-4">
                <div className="flex-grow">
                    <div className="flex items-center gap-2">
                        <button onClick={() => onCopyToClipboard(submission.title)} title="Click to copy title" className="font-bold text-lg text-gray-800 hover:text-blue-600 transition-colors text-left">
                            {submission.title}
                        </button>
                        <button onClick={() => onShowCreation({ name: 'detail', id: submission.id })} className="text-xs bg-gray-200 text-gray-700 hover:bg-gray-300 px-2 py-1 rounded font-semibold">
                            Show Creation
                        </button>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                        <span>by {submission.username}</span>
                        <div className="flex flex-wrap gap-1">
                            {authorRanks.map(rank => (
                                <span key={rank.name} className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{backgroundColor: rank.color, color: getTextColorForBackground(rank.color)}}>
                                    {rank.name}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                    <button onClick={() => onAssignVideo(submission.id, submission.assignedVideoUrl)} className="p-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg">
                        <Icon path={ICONS.video} className="w-5 h-5" />
                    </button>
                    <select 
                        value={groupAssignments[submission.id] || ''} 
                        onChange={(e) => onGroupChange(submission.id, e.target.value)}
                        className="w-40 p-2 border rounded-lg bg-gray-50 text-sm disabled:bg-gray-200"
                        disabled={groups.length === 0}
                    >
                        <option value="">{groups.length === 0 ? 'No groups created' : 'Assign to Group...'}</option>
                        {groups.map(group => (
                            <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                    </select>
                    <input type="checkbox" className="h-5 w-5 rounded" checked={isDone} onChange={() => onDoneToggle(submission.id)} />
                </div>
            </div>
            <div className="mt-3 pt-3 border-t flex flex-wrap items-start gap-4 text-sm">
                {submission.shareCode && (
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-600 mb-1">Share Code</p>
                        <button onClick={() => onCopyToClipboard(submission.shareCode)} title={submission.shareCode} className="text-left w-full text-sm text-gray-800 font-medium bg-gray-100 p-2 rounded hover:bg-gray-200 transition-colors truncate">
                            {submission.shareCode}
                        </button>
                    </div>
                )}
                {eventData.customFields?.map(field => {
                    const value = customData[field.id];
                    if (!value) return null;
                    return (
                        <div key={field.id} className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-600 mb-1">{field.label}</p>
                            <button onClick={() => onCopyToClipboard(value)} title={value} className="text-left w-full text-sm text-gray-800 font-medium bg-gray-100 p-2 rounded hover:bg-gray-200 transition-colors truncate">
                                {value}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const TABS = ['Submissionlist', 'Groups', 'Stats'];

const EventManager = ({ user, userProfile, setModalMessage, setPopoverView }) => {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [eventData, setEventData] = useState(null);
    const [community, setCommunity] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [voteCounts, setVoteCounts] = useState({});
    const [reactionCounts, setReactionCounts] = useState({});
    const [isSyncingReactions, setIsSyncingReactions] = useState(false);

    const [activeTab, setActiveTab] = useState(TABS[0]);
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);

    const [doneSubmissions, setDoneSubmissions] = useState([]);
    const [groupAssignments, setGroupAssignments] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [rankFilter, setRankFilter] = useState('all');
    const [sortBy, setSortBy] = useState('createdAt');
    
    const [groups, setGroups] = useState([]);
    const [newGroupName, setNewGroupName] = useState('');
    const [expandedGroups, setExpandedGroups] = useState([]);
    const [doneGroups, setDoneGroups] = useState([]);
    const [isAutoGroupModalOpen, setIsAutoGroupModalOpen] = useState(false);

    useEffect(() => {
        if (!eventId) return;
        
        const eventRef = doc(db, 'events', eventId);
        const unsubscribeEvent = onSnapshot(eventRef, async (docSnap) => {
            if (docSnap.exists()) {
                const fetchedEventData = { id: docSnap.id, ...docSnap.data() };
                setEventData(fetchedEventData);

                const communityRef = doc(db, 'communitys', fetchedEventData.communityId);
                const communitySnap = await getDoc(communityRef);
                if (communitySnap.exists()) {
                    setCommunity({ id: communitySnap.id, ...communitySnap.data() });
                }

                const submissionsQuery = query(collection(db, 'creations'), where('eventIds', 'array-contains', eventId));
                const submissionsSnap = await getDocs(submissionsQuery);
                const submissionData = submissionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setSubmissions(submissionData);

                const membersQuery = query(collection(db, 'communitys', fetchedEventData.communityId, 'members'));
                const membersSnap = await getDocs(membersQuery);
                setMembers(membersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                
                setLoading(false);
            } else {
                setLoading(false);
            }
        });

        return () => unsubscribeEvent();
    }, [eventId]);

    const syncReactionCounts = async () => {
        if (submissions.length === 0) return;
        setIsSyncingReactions(true);
        const functions = getFunctions();
        const getDiscordReactionCount = httpsCallable(functions, 'getDiscordReactionCount');
        const newReactionCounts = {};

        for (const sub of submissions) {
            const linkRef = doc(db, 'communitys', eventData.communityId, 'creations', sub.id);
            const linkSnap = await getDoc(linkRef);

            if (linkSnap.exists()) {
                const linkData = linkSnap.data();
                if (linkData.discordChannelId && linkData.discordMessageId) {
                    try {
                        const result = await getDiscordReactionCount({ channelId: linkData.discordChannelId, messageId: linkData.discordMessageId });
                        newReactionCounts[sub.id] = result.data.count;
                    } catch (error) {
                        console.error("Error fetching reaction count:", error);
                        newReactionCounts[sub.id] = 0;
                    }
                } else {
                    newReactionCounts[sub.id] = 0;
                }
            }
        }
        setReactionCounts(newReactionCounts);
        setIsSyncingReactions(false);
    };

    useEffect(() => {
        if (submissions.length === 0) return;

        const voteUnsubscribers = submissions.map(sub => {
            const votesQuery = query(collection(db, 'creations', sub.id, 'votes'));
            return onSnapshot(votesQuery, (snapshot) => {
                setVoteCounts(prev => ({ ...prev, [sub.id]: snapshot.size }));
            });
        });

        return () => {
            voteUnsubscribers.forEach(unsub => unsub());
        };
    }, [submissions]);
    
    useEffect(() => {
        if (loading) return;
        const activeTabIndex = TABS.findIndex(tab => tab === activeTab);
        const activeTabNode = tabRefs.current[activeTabIndex];
        if (activeTabNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [activeTab, loading]);

    const filteredAndSortedSubmissions = useMemo(() => {
        let filtered = [...submissions];

        if (rankFilter !== 'all') {
            filtered = filtered.filter(submission => {
                const author = members.find(m => m.id === submission.userId);
                return author?.roles?.map(r => r.toLowerCase()).includes(rankFilter.toLowerCase());
            });
        }

        if (searchTerm.trim() !== '') {
            const lowerCaseSearch = searchTerm.toLowerCase();
            filtered = filtered.filter(submission =>
                submission.title.toLowerCase().includes(lowerCaseSearch) ||
                submission.username.toLowerCase().includes(lowerCaseSearch)
            );
        }

        filtered.sort((a, b) => {
            const aIsDone = doneSubmissions.includes(a.id);
            const bIsDone = doneSubmissions.includes(b.id);
            if (aIsDone !== bIsDone) return aIsDone ? 1 : -1;

            switch (sortBy) {
                case 'name':
                    return a.title.localeCompare(b.title);
                case 'votes':
                    return (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0);
                case 'reactions':
                    return (reactionCounts[b.id] || 0) - (reactionCounts[a.id] || 0);
                case 'time':
                default:
                    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
            }
        });

        return filtered;
    }, [submissions, members, rankFilter, searchTerm, doneSubmissions, sortBy, voteCounts, reactionCounts]);

    const handleDoneToggle = (submissionId) => {
        setDoneSubmissions(prev => 
            prev.includes(submissionId) 
                ? prev.filter(id => id !== submissionId)
                : [...prev, submissionId]
        );
    };
    
    const handleDoneGroupToggle = (groupId) => {
        setDoneGroups(prev => 
            prev.includes(groupId) 
                ? prev.filter(id => id !== groupId)
                : [...prev, groupId]
        );
    };

    const handleGroupChange = (submissionId, groupId) => {
        setGroupAssignments(prev => ({ ...prev, [submissionId]: groupId }));
    };

    const handleAddGroup = () => {
        if (newGroupName.trim() && !groups.some(g => g.name === newGroupName.trim())) {
            setGroups(prev => [...prev, { id: `group-${Date.now()}`, name: newGroupName.trim() }]);
            setNewGroupName('');
        }
    };
    
    const handleRemoveGroup = (groupId) => {
        setGroups(prev => prev.filter(group => group.id !== groupId));
    };

    const handleAssignVideoToGroup = async (groupId) => {
        const videoUrl = prompt("Please enter the YouTube video URL to assign to all creations in this group:");
        if (videoUrl) {
            try {
                const batch = writeBatch(db);
                const updatedSubmissions = [];
                submissions.forEach(sub => {
                    if (groupAssignments[sub.id] === groupId) {
                        const creationRef = doc(db, 'creations', sub.id);
                        batch.update(creationRef, { assignedVideoUrl: videoUrl });
                        updatedSubmissions.push({ ...sub, assignedVideoUrl: videoUrl });
                    } else {
                        updatedSubmissions.push(sub);
                    }
                });
                await batch.commit();
                setSubmissions(updatedSubmissions);
                setModalMessage("Video assigned to group successfully!");
            } catch (error) {
                setModalMessage(`Error assigning video to group: ${error.message}`);
            }
        }
    };

    const handleCopyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setModalMessage("Copied to clipboard!");
    };

    const handleToggleGroup = (groupId) => {
        setExpandedGroups(prev => 
            prev.includes(groupId)
                ? prev.filter(id => id !== groupId)
                : [...prev, groupId]
        );
    };

    const handleAssignVideo = async (submissionId, currentUrl) => {
        const videoUrl = prompt("Please enter the YouTube video URL to assign:", currentUrl || "");
        if (videoUrl !== null) { 
            try {
                const creationRef = doc(db, 'creations', submissionId);
                await updateDoc(creationRef, {
                    assignedVideoUrl: videoUrl
                });
                setSubmissions(prev => prev.map(sub => 
                    sub.id === submissionId ? { ...sub, assignedVideoUrl: videoUrl } : sub
                ));
                setModalMessage("Assigned video updated successfully!");
            } catch (error) {
                setModalMessage(`Error assigning video: ${error.message}`);
            }
        }
    };
    
    const handleAutoGroupConfirm = (options) => {
        const {
            creationsPerGroup,
            groupBy,
            forbiddenRankCombinations,
            ignoreForbiddenRule,
            ranksToConsiderForGrouping,
        } = options;
    
        const unassignedSubmissions = submissions.filter(s => !groupAssignments[s.id]);
        if (unassignedSubmissions.length === 0) {
            setModalMessage("There are no unassigned creations to group.");
            setIsAutoGroupModalOpen(false);
            return;
        }
    
        const creatorRanksMap = new Map();
        members.forEach(m => creatorRanksMap.set(m.id, m.roles || []));
    
        let sortedSubs = [...unassignedSubmissions];
    
        if (groupBy === 'random') {
            sortedSubs.sort(() => Math.random() - 0.5);
        } else if (groupBy === 'votes') {
            sortedSubs.sort((a, b) => (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0));
        } else if (groupBy === 'reactions') {
            sortedSubs.sort((a, b) => (reactionCounts[b.id] || 0) - (reactionCounts[a.id] || 0));
        } else if (groupBy === 'ranks') {
            const getHighestRankWeight = (roles) => {
                if (!roles || roles.length === 0) return 99;
                const weights = roles.map(role => {
                    const rank = community.ranks.find(r => r.name.toLowerCase() === role.toLowerCase());
                    return rank ? rank.weight : 99;
                });
                return Math.min(...weights);
            };
            const ranksToConsiderLower = ranksToConsiderForGrouping.map(r => r.toLowerCase());
            sortedSubs = sortedSubs.filter(s => {
                const creatorRanks = creatorRanksMap.get(s.userId) || [];
                return creatorRanks.some(r => ranksToConsiderLower.includes(r.toLowerCase()));
            });
            sortedSubs.sort((a, b) => {
                const aRanks = creatorRanksMap.get(a.userId) || [];
                const bRanks = creatorRanksMap.get(b.userId) || [];
                return getHighestRankWeight(aRanks) - getHighestRankWeight(bRanks);
            });
        }
    
        const newGroups = [];
        const newAssignments = {};
        let groupCounter = groups.length + 1;
    
        while (sortedSubs.length > 0) {
            const currentGroupSubmissions = [];
            const newGroup = { id: `auto-group-${Date.now()}-${groupCounter}`, name: `Group ${groupCounter}` };
            
    
            for (let i = 0; i < creationsPerGroup; i++) {
                 if (sortedSubs.length === 0) break;

                let foundSubmission = false;
                for (let j = 0; j < sortedSubs.length; j++) {
                    const potentialSub = sortedSubs[j];
                    const potentialRanks = creatorRanksMap.get(potentialSub.userId) || [];
                    
                    const isForbidden = forbiddenRankCombinations.some(pair => {
                        const lowerPair = pair.map(p => p.toLowerCase());
                        const groupRanks = currentGroupSubmissions.flatMap(sub => creatorRanksMap.get(sub.userId) || []);
                        const combinedRanks = [...groupRanks, ...potentialRanks];
                        return combinedRanks.includes(lowerPair[0]) && combinedRanks.includes(lowerPair[1]);
                    });
    
                    if (!isForbidden) {
                        currentGroupSubmissions.push(potentialSub);
                        newAssignments[potentialSub.id] = newGroup.id;
                        sortedSubs.splice(j, 1);
                        foundSubmission = true;
                        break;
                    }
                }
    
                if (!foundSubmission) {
                    if (ignoreForbiddenRule && sortedSubs.length > 0) {
                        const fallbackSub = sortedSubs.shift();
                        currentGroupSubmissions.push(fallbackSub);
                        newAssignments[fallbackSub.id] = newGroup.id;
                    } else {
                        break; 
                    }
                }
            }
            if(currentGroupSubmissions.length > 0) {
                newGroups.push(newGroup);
                groupCounter++;
            }
        }
    
        setGroups(prev => [...prev, ...newGroups]);
        setGroupAssignments(prev => ({ ...prev, ...newAssignments }));
        setModalMessage(`${newGroups.length} group(s) created automatically. ${sortedSubs.length} creation(s) remain unassigned.`);
        setIsAutoGroupModalOpen(false);
    };

    if (loading || !eventData || !community) return <Spinner />;

    const color = getGameColor(eventData.game);

    const renderTabContent = () => {
        switch (activeTab) {
            case 'Submissionlist':
                return (
                    <div>
                        <div className="flex flex-col md:flex-row gap-4 mb-6 p-4 bg-gray-50 rounded-lg border items-center">
                            <input
                                type="text"
                                placeholder="Search by title or user..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full md:flex-grow p-2 border rounded-lg"
                            />
                            <select
                                value={rankFilter}
                                onChange={(e) => setRankFilter(e.target.value)}
                                className="w-full md:w-auto p-2 border rounded-lg bg-white"
                            >
                                <option value="all">Filter by Rank...</option>
                                {community?.ranks?.map(rank => (
                                    <option key={rank.name} value={rank.name.toLowerCase()}>{rank.name}</option>
                                ))}
                            </select>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="w-full md:w-auto p-2 border rounded-lg bg-white"
                            >
                                <option value="time">Sort by Time</option>
                                <option value="name">Sort by Name</option>
                                <option value="votes">Sort by Votes</option>
                                <option value="reactions">Sort by Reactions</option>
                            </select>
                            <button onClick={syncReactionCounts} disabled={isSyncingReactions} className="w-full md:w-auto bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2 px-4 rounded-lg disabled:opacity-50">
                                {isSyncingReactions ? 'Syncing...' : 'Sync Discord Reactions'}
                            </button>
                        </div>

                        {filteredAndSortedSubmissions.length === 0 ? (
                            <div className="bg-white p-8 rounded-lg shadow-md text-center"><p className="text-gray-500">No submissions match your current filters.</p></div>
                        ) : (
                            <div className="space-y-4">
                                {filteredAndSortedSubmissions.map(submission => (
                                    <SubmissionItem
                                        key={submission.id}
                                        submission={submission}
                                        members={members}
                                        community={community}
                                        eventData={eventData}
                                        eventId={eventId}
                                        isDone={doneSubmissions.includes(submission.id)}
                                        onDoneToggle={handleDoneToggle}
                                        groupAssignments={groupAssignments}
                                        groups={groups}
                                        onGroupChange={handleGroupChange}
                                        onAssignVideo={handleAssignVideo}
                                        onCopyToClipboard={handleCopyToClipboard}
                                        onShowCreation={setPopoverView}
                                        color={color}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            case 'Groups':
                return (
                    <div className="bg-white p-8 rounded-lg shadow-md">
                        <h2 className="text-2xl font-bold mb-4 text-center">Manage Groups</h2>
                        <div className="flex space-x-2 mb-6 max-w-lg mx-auto">
                            <input 
                                type="text"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                placeholder="New group name..."
                                className="flex-grow p-2 border rounded-lg"
                            />
                            <button onClick={handleAddGroup} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-4 rounded-lg`}>Add Group</button>
                            <button 
                                type="button" 
                                onClick={() => setIsAutoGroupModalOpen(true)} 
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg"
                            >
                                Auto Group
                            </button>
                        </div>
                        <div className="space-y-4">
                            {groups.length > 0 ? groups.map(group => {
                                const isGroupDone = doneGroups.includes(group.id);
                                const isExpanded = expandedGroups.includes(group.id);
                                const submissionsInGroup = submissions.filter(s => groupAssignments[s.id] === group.id);

                                return (
                                    <div key={group.id} className={`p-4 rounded-lg ${isGroupDone ? 'bg-gray-100' : 'bg-blue-50'}`}>
                                        <div className="flex items-center gap-4">
                                            <button onClick={() => handleToggleGroup(group.id)}>
                                                <Icon path={ICONS.chevronDown} className={`w-6 h-6 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                            </button>
                                            <span className="font-bold text-xl flex-grow">{group.name} ({submissionsInGroup.length})</span>
                                            <button onClick={() => handleAssignVideoToGroup(group.id)} className="p-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg" title="Assign Video to Group">
                                                <Icon path={ICONS.video} className="w-5 h-5" />
                                            </button>
                                            <input type="checkbox" className="h-5 w-5 rounded" checked={isGroupDone} onChange={() => handleDoneGroupToggle(group.id)} />
                                            <button onClick={() => handleRemoveGroup(group.id)} className="text-red-500 hover:text-red-700">
                                                <Icon path={ICONS.trash} className="w-5 h-5" />
                                            </button>
                                        </div>
                                        {isExpanded && (
                                            <div className="mt-4 pt-4 border-t space-y-4">
                                                {submissionsInGroup.length > 0 ? submissionsInGroup.map(submission => (
                                                    <SubmissionItem
                                                        key={submission.id}
                                                        submission={submission}
                                                        members={members}
                                                        community={community}
                                                        eventData={eventData}
                                                        eventId={eventId}
                                                        isDone={doneSubmissions.includes(submission.id) || isGroupDone}
                                                        onDoneToggle={handleDoneToggle}
                                                        groupAssignments={groupAssignments}
                                                        groups={groups}
                                                        onGroupChange={handleGroupChange}
                                                        onAssignVideo={handleAssignVideo}
                                                        onCopyToClipboard={handleCopyToClipboard}
                                                        onShowCreation={setPopoverView}
                                                        color={color}
                                                    />
                                                )) : <p className="text-gray-500 text-center">No creations assigned to this group yet.</p>}
                                            </div>
                                        )}
                                    </div>
                                )
                            }) : (
                                <p className="text-gray-500 text-center py-4">No groups created yet.</p>
                            )}
                        </div>
                    </div>
                );
            case 'Stats':
                return (
                    <div className="bg-white p-8 rounded-lg shadow-md text-center">
                        <h2 className="text-2xl font-bold">Stats</h2>
                        <p className="mt-4 text-gray-600">Statistics and voting results for the event will be displayed here.</p>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="container mx-auto p-4 sm:p-8">
            <div className="flex justify-between items-center mb-6">
                <button onClick={() => navigate(`/event/${eventId}`)} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-4 rounded-lg flex items-center`}>
                    <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2" />
                    Back to Event
                </button>
            </div>
            <h1 className="text-4xl font-bold text-center">Manage "{eventData.title}"</h1>
            
            <div className="relative flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                    <div ref={gliderRef} className={`absolute h-full ${color.bg} rounded-full transition-all duration-300 ease-in-out`} />
                    {TABS.map((tab, index) => (
                        <button
                            key={tab}
                            ref={el => tabRefs.current[index] = el}
                            onClick={() => setActiveTab(tab)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${ activeTab === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="mt-8">
                {renderTabContent()}
            </div>

            {isAutoGroupModalOpen && (
                <AutoGroupSubmissionsModal
                    onClose={() => setIsAutoGroupModalOpen(false)}
                    onConfirm={handleAutoGroupConfirm}
                    communityRanks={community.ranks || []}
                    color={color}
                />
            )}
        </div>
    );
};

export default EventManager;