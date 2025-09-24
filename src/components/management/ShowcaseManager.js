import React, { useMemo, useState, useEffect, useRef } from 'react';
import { db } from '../../firebase/config';
import { doc, updateDoc, arrayUnion, arrayRemove, writeBatch, query, collection, where, getDocs } from 'firebase/firestore';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import CreationShowcaseCard from '../cards/CreationShowcaseCard';

const ShowcaseManager = ({ creations, setCreations, community, setCommunity, setModalMessage, setPopoverView, setConfirmation }) => {
    const [newGroupName, setNewGroupName] = useState('');
    const [isSavingGroup, setIsSavingGroup] = useState(false);
    const [groupMenu, setGroupMenu] = useState(null);
    const [expandedGroups, setExpandedGroups] = useState([]);
    const [expandedMarked, setExpandedMarked] = useState([]);
    const groupMenuRef = useRef(null);

    const { markedForShowcase, alreadyShowcased } = useMemo(() => {
        const groups = community.showcaseGroups || [];
        const creationsWithGroup = creations.map(c => {
            const group = groups.find(g => g.id === c.showcaseGroupId);
            return { ...c, groupName: group ? group.name : null };
        });
        const marked = creationsWithGroup.filter(c => c.markedForShowcase && !c.showcaseVideoUrl && !c.showcaseGroupId);
        const showcased = creationsWithGroup.filter(c => !!c.showcaseVideoUrl);
        return { markedForShowcase: marked, alreadyShowcased: showcased };
    }, [creations, community.showcaseGroups]);
    
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (groupMenuRef.current && !groupMenuRef.current.contains(event.target)) {
                setGroupMenu(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleCreateGroup = async () => {
        const trimmedName = newGroupName.trim();
        if (!trimmedName) return;
        const alreadyExists = (community.showcaseGroups || []).some(g => g.name.toLowerCase() === trimmedName.toLowerCase());
        if (alreadyExists) {
            setModalMessage('A group with this name already exists.');
            return;
        }
        setIsSavingGroup(true);
        const newGroup = { id: `group_${Date.now()}`, name: trimmedName };
        const communityRef = doc(db, 'communitys', community.id);
        try {
            await updateDoc(communityRef, { showcaseGroups: arrayUnion(newGroup) });
            setNewGroupName('');
        } catch (error) {
            setModalMessage(`Error creating group: ${error.message}`);
        } finally {
            setIsSavingGroup(false);
        }
    };
    
    const handleDeleteGroup = async (groupToDelete) => {
        setConfirmation({
            message: `Are you sure you want to delete the group "${groupToDelete.name}"? This will unassign it from all creations.`,
            onConfirm: async () => {
                setIsSavingGroup(true);
                const communityRef = doc(db, 'communitys', community.id);
                try {
                    const batch = writeBatch(db);
                    batch.update(communityRef, { showcaseGroups: arrayRemove(groupToDelete) });
                    const q = query(collection(db, 'communitys', community.id, 'creations'), where('showcaseGroupId', '==', groupToDelete.id));
                    const snapshot = await getDocs(q);
                    snapshot.forEach(doc => batch.update(doc.ref, { showcaseGroupId: null }));
                    await batch.commit();
                    setModalMessage("Group deleted and unassigned from creations.");
                } catch (error) {
                    setModalMessage(`Error deleting group: ${error.message}`);
                } finally {
                    setIsSavingGroup(false);
                }
            }
        });
    };

    const handleAssignGroup = async (creationId, groupId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await updateDoc(linkRef, { showcaseGroupId: groupId || null });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseGroupId: groupId || null } : c));
        } catch (error) {
            setModalMessage(`Error assigning group: ${error.message}`);
        } finally {
            setGroupMenu(null);
        }
    };
    
    const handleRemoveFromGroup = async (creationId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await updateDoc(linkRef, { showcaseGroupId: null });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseGroupId: null } : c));
            setModalMessage("Creation removed from group.");
        } catch (error) {
            setModalMessage(`Error removing from group: ${error.message}`);
        }
    };
    
    const handleAddShowcaseVideo = async (creationId) => {
        const videoUrl = prompt("Please enter the YouTube video URL for the showcase:");
        if (!videoUrl) return;
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await updateDoc(linkRef, { showcaseVideoUrl: videoUrl });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseVideoUrl: videoUrl } : c));
            setModalMessage("Showcase video added successfully.");
        } catch (error) {
            setModalMessage(`Error adding showcase video: ${error.message}`);
        }
    };

    const handleAddVideoToGroup = async (group) => {
        const videoUrl = prompt(`Enter the YouTube video URL for all creations in the "${group.name}" group:`);
        if (!videoUrl) return;
        try {
            const batch = writeBatch(db);
            const creationsToUpdate = creations.filter(c => c.showcaseGroupId === group.id);
            if (creationsToUpdate.length === 0) {
                setModalMessage("No creations found in this group to update.");
                return;
            }
            creationsToUpdate.forEach(c => {
                const linkRef = doc(db, 'communitys', community.id, 'creations', c.id);
                batch.update(linkRef, { showcaseVideoUrl: videoUrl });
            });
            
            const communityRef = doc(db, 'communitys', community.id);
            batch.update(communityRef, { showcaseGroups: arrayRemove(group) });

            await batch.commit();

            setCreations(prev => prev.map(c => c.showcaseGroupId === group.id ? { ...c, showcaseVideoUrl: videoUrl } : c));
            setCommunity(prevCommunity => ({
                ...prevCommunity,
                showcaseGroups: (prevCommunity.showcaseGroups || []).filter(g => g.id !== group.id)
            }));
            
            setModalMessage(`Showcase video added to ${creationsToUpdate.length} creation(s) and the group has been cleared.`);
        } catch (error) {
            setModalMessage(`Error adding video to group: ${error.message}`);
        }
    };
    
    const handleRemoveFromShowcase = async (creationId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await updateDoc(linkRef, {
                markedForShowcase: false,
                showcaseNote: '',
                showcaseGroupId: null
            });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, markedForShowcase: false, showcaseNote: '', showcaseGroupId: null } : c));
            setModalMessage("Creation removed from showcase list.");
        } catch (error) {
            setModalMessage(`Error removing from showcase: ${error.message}`);
        }
    };
    
    const handleRemoveShowcaseVideo = async (creationId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await updateDoc(linkRef, { showcaseVideoUrl: null });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseVideoUrl: null } : c));
            setModalMessage("Showcase video removed successfully.");
        } catch (error) {
            setModalMessage(`Error removing showcase video: ${error.message}`);
        }
    };

    const toggleGroup = (groupId) => setExpandedGroups(prev => prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]);
    const toggleMarked = (creationId) => setExpandedMarked(prev => prev.includes(creationId) ? prev.filter(id => id !== creationId) : [...prev, creationId]);
    const creationsInGroup = (groupId) => creations.filter(c => c.showcaseGroupId === groupId);

    return (
        <div className="flex flex-col gap-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <h3 className="text-2xl font-bold mb-4 text-center">Marked for Showcase</h3>
                    <div className="space-y-3 bg-gray-50 p-4 rounded-lg border h-[32rem] overflow-y-auto">
                        {markedForShowcase.length > 0 ? (
                            markedForShowcase.map(creation => {
                                const isExpanded = expandedMarked.includes(creation.id);
                                return (
                                    <div key={creation.id} className="p-3 bg-white rounded-lg shadow border">
                                        <div className="flex items-center justify-between">
                                            <button onClick={() => toggleMarked(creation.id)} className="flex items-center gap-2 font-semibold text-blue-600 hover:underline truncate text-left w-full pr-2" title={creation.title}>
                                                <Icon path={ICONS.chevronDown} className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                {creation.title}
                                            </button>
                                            <div className="flex items-center space-x-2 flex-shrink-0">
                                                <button onClick={(e) => { e.stopPropagation(); setGroupMenu({ creationId: creation.id, x: e.clientX, y: e.clientY })}} className="p-2 text-gray-500 hover:text-blue-600" title="Assign to Group">
                                                    <Icon path={ICONS.plus} className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => handleRemoveFromShowcase(creation.id)} className="p-2 text-gray-500 hover:text-red-600" title="Remove from Showcase List">
                                                    <Icon path={ICONS.trash} className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="mt-3 pt-3 border-t">
                                                <CreationShowcaseCard
                                                    creation={creation}
                                                    community={community}
                                                    setPopoverView={setPopoverView}
                                                    setModalMessage={setModalMessage}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-center text-gray-500 pt-10">Creations marked for showcase will appear here.</p>
                        )}
                    </div>
                </div>
                <div>
                    <h3 className="text-2xl font-bold mb-4 text-center">Already Showcased</h3>
                    <div className="space-y-3 bg-gray-50 p-4 rounded-lg border h-[32rem] overflow-y-auto">
                        {alreadyShowcased.length > 0 ? (
                             alreadyShowcased.map(creation => (
                                <div key={creation.id} className="flex items-center justify-between p-3 bg-white rounded-lg shadow border">
                                    <button onClick={() => setPopoverView({ name: 'detail', id: creation.id })} className="font-semibold text-blue-600 hover:underline truncate text-left w-full pr-2" title={creation.title}>
                                        {creation.title}
                                    </button>
                                    <button onClick={() => handleRemoveShowcaseVideo(creation.id)} className="p-2 text-gray-500 hover:text-red-600" title="Remove Showcase Video">
                                        <Icon path={ICONS.xCircle} className="w-5 h-5" />
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-gray-500 pt-10">Creations with a showcase video will appear here.</p>
                        )}
                    </div>
                </div>
            </div>

            <div>
                <h3 className="text-2xl font-bold mb-4 text-center">Showcase Groups</h3>
                <div className="bg-gray-50 p-4 rounded-lg border">
                    <div className="flex gap-2 max-w-sm mx-auto mb-4">
                        <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="New group name..." className="flex-grow p-2 border rounded-lg" />
                        <button onClick={handleCreateGroup} disabled={isSavingGroup || !newGroupName.trim()} className="bg-green-500 hover:bg-green-600 text-white font-bold p-2 rounded-lg disabled:opacity-50">
                            {isSavingGroup ? <Spinner size="small" /> : 'Add Group'}
                        </button>
                    </div>
                    <div className="space-y-4 pt-4 border-t">
                        {(community.showcaseGroups || []).map(group => {
                            const isExpanded = expandedGroups.includes(group.id);
                            return (
                                <div key={group.id} className="p-4 bg-white rounded-lg shadow border">
                                    <div className="flex items-center justify-between">
                                        <button onClick={() => toggleGroup(group.id)} className="flex items-center gap-2 font-bold text-xl text-gray-800">
                                            <Icon path={ICONS.chevronDown} className={`w-6 h-6 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                            {group.name}
                                        </button>
                                        <div className="flex items-center space-x-2">
                                            <button onClick={() => handleAddVideoToGroup(group)} className="p-2 text-gray-500 hover:text-green-600" title="Add Video to Group">
                                                <Icon path={ICONS.video} className="w-5 h-5" />
                                            </button>
                                            <button onClick={() => handleDeleteGroup(group)} className="p-2 text-gray-500 hover:text-red-600" title="Delete Group">
                                                <Icon path={ICONS.trash} className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="mt-3 pt-3 border-t grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {creationsInGroup(group.id).map(creation => (
                                                <CreationShowcaseCard 
                                                    key={creation.id}
                                                    creation={creation}
                                                    community={community}
                                                    setPopoverView={setPopoverView}
                                                    setModalMessage={setModalMessage}
                                                    onRemoveFromGroup={() => handleRemoveFromGroup(creation.id)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {groupMenu && (
                <div ref={groupMenuRef} className="absolute z-30 w-48 bg-white rounded-md shadow-lg border" style={{ top: groupMenu.y, left: groupMenu.x }}>
                    <button onClick={() => handleAssignGroup(groupMenu.creationId, null)} className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Unassign</button>
                    {(community.showcaseGroups || []).map(group => (
                        <button key={group.id} onClick={() => handleAssignGroup(groupMenu.creationId, group.id)} className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            {group.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ShowcaseManager;