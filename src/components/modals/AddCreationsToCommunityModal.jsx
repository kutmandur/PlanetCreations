import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../../firebase/config';
import {
    collection, query, where, orderBy, getDocs, doc,
    writeBatch, updateDoc, arrayUnion, arrayRemove, serverTimestamp
} from 'firebase/firestore';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

// Popup zum Verwalten der eigenen Creations in einer Community:
// hinzufügen, entfernen und einmalig für das Showcase bewerben.
const AddCreationsToCommunityModal = ({ user, community, canApplyShowcase = true, onClose, setModalMessage }) => {
    const queryClient = useQueryClient();
    const [myCreations, setMyCreations] = useState([]);
    // creationId -> Link-Doc-Daten (existiert = ist in der Community)
    const [links, setLinks] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [membershipFilter, setMembershipFilter] = useState('all');

    const themeColor = community?.themeColor || '#F97316';

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            try {
                const [creationsSnap, linksSnap] = await Promise.all([
                    getDocs(query(
                        collection(db, 'creations'),
                        where('userId', '==', user.uid),
                        orderBy('createdAt', 'desc')
                    )),
                    getDocs(query(
                        collection(db, 'communitys', community.id, 'creations'),
                        where('userId', '==', user.uid)
                    )),
                ]);
                if (!isMounted) return;
                setMyCreations(creationsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLinks(Object.fromEntries(linksSnap.docs.map(d => [d.id, d.data()])));
            } catch (error) {
                console.error('Error loading creations for community modal:', error);
                if (isMounted) {
                    setModalMessage(`Error loading your creations: ${error.message}`);
                    setLinks({});
                }
            }
        };
        load();
        return () => { isMounted = false; };
    }, [user.uid, community.id, setModalMessage]);

    // Der Community-Index wird vom Cloud-Function-Trigger mit leichter
    // Verzögerung aktualisiert — verzögert invalidieren.
    const invalidateIndex = useCallback(() => {
        setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['communityIndex', community.id] });
        }, 2500);
    }, [queryClient, community.id]);

    const handleAdd = async (creation) => {
        setBusyId(creation.id);
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'creations', creation.id), {
                communityIds: arrayUnion(community.id),
                communityAssignments: arrayUnion({ communityId: community.id, communityName: community.name }),
            });
            batch.set(doc(db, 'communitys', community.id, 'creations', creation.id), {
                creationId: creation.id,
                linkedAt: serverTimestamp(),
                userId: user.uid,
            });
            await batch.commit();
            setLinks(prev => ({ ...prev, [creation.id]: { userId: user.uid } }));
            setMyCreations(prev => prev.map(c => c.id === creation.id
                ? { ...c, communityIds: [...(c.communityIds || []), community.id] }
                : c));
            invalidateIndex();
        } catch (error) {
            setModalMessage(`Error adding creation: ${error.message}`);
        } finally {
            setBusyId(null);
        }
    };

    const handleRemove = async (creation) => {
        setBusyId(creation.id);
        try {
            const assignment = (creation.communityAssignments || [])
                .find(a => a.communityId === community.id);
            const batch = writeBatch(db);
            batch.update(doc(db, 'creations', creation.id), {
                communityIds: arrayRemove(community.id),
                ...(assignment ? { communityAssignments: arrayRemove(assignment) } : {}),
            });
            batch.delete(doc(db, 'communitys', community.id, 'creations', creation.id));
            await batch.commit();
            setLinks(prev => {
                const next = { ...prev };
                delete next[creation.id];
                return next;
            });
            setMyCreations(prev => prev.map(c => c.id === creation.id
                ? {
                    ...c,
                    communityIds: (c.communityIds || []).filter(id => id !== community.id),
                    communityAssignments: (c.communityAssignments || []).filter(a => a.communityId !== community.id),
                }
                : c));
            invalidateIndex();
        } catch (error) {
            setModalMessage(`Error removing creation: ${error.message}`);
        } finally {
            setBusyId(null);
        }
    };

    const handleApply = async (creation) => {
        if (links?.[creation.id]?.showcaseVideoUrl) {
            setModalMessage('This creation has already been showcased in this community.');
            return;
        }
        setBusyId(creation.id);
        try {
            await updateDoc(doc(db, 'communitys', community.id, 'creations', creation.id), {
                appliedForShowcase: true,
                appliedAt: serverTimestamp(),
            });
            setLinks(prev => ({ ...prev, [creation.id]: { ...prev[creation.id], appliedForShowcase: true } }));
            invalidateIndex();
            setModalMessage('Your creation has been submitted for showcase consideration!');
        } catch (error) {
            setModalMessage(`Error applying for showcase: ${error.message}`);
        } finally {
            setBusyId(null);
        }
    };

    const filteredCreations = useMemo(() => {
        let list = myCreations;
        if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
        if (membershipFilter !== 'all') {
            const inCommunity = membershipFilter === 'added';
            list = list.filter(c => !!links?.[c.id] === inCommunity);
        }
        const term = searchTerm.trim().toLowerCase();
        if (term) {
            list = list.filter(c =>
                c.title?.toLowerCase().includes(term) ||
                (c.tags || []).some(t => t.toLowerCase().includes(term))
            );
        }
        return list;
    }, [myCreations, links, searchTerm, statusFilter, membershipFilter]);

    const getThumbnail = (creation) => {
        if (creation.imageUrls?.[0]) return creation.imageUrls[0];
        const videoUrl = creation.videoUrls?.[0];
        if (videoUrl) {
            const match = videoUrl.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
            if (match) return `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
        }
        return 'https://placehold.co/160x90/e2e8f0/64748b?text=No+Image';
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
                style={{ '--theme-color': themeColor }}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Your Creations in {community.name}</h2>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100" aria-label="Close">
                        <span className="text-2xl font-bold leading-none">×</span>
                    </button>
                </div>

                <div className="px-6 py-3 border-b flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-grow">
                        <input
                            type="text"
                            placeholder="Search by title or tag..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full p-2 pl-9 bg-gray-100 border rounded-lg focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': themeColor }}
                        />
                        <Icon path={ICONS.search} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="p-2 border rounded-lg bg-white text-sm">
                        <option value="all">All Statuses</option>
                        <option value="finished">Finished</option>
                        <option value="wip">Work in Progress</option>
                    </select>
                    <select value={membershipFilter} onChange={(e) => setMembershipFilter(e.target.value)} className="p-2 border rounded-lg bg-white text-sm">
                        <option value="all">All Creations</option>
                        <option value="added">In this Community</option>
                        <option value="not-added">Not added yet</option>
                    </select>
                </div>

                <div className="flex-grow overflow-y-auto p-6">
                    {links === null ? (
                        <div className="py-16"><Spinner /></div>
                    ) : filteredCreations.length === 0 ? (
                        <p className="text-center text-gray-500 py-16">
                            {myCreations.length === 0 ? "You haven't uploaded any creations yet." : 'No creations match your filters.'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {filteredCreations.map(creation => {
                                const link = links[creation.id];
                                const isAdded = !!link;
                                const hasApplied = link?.appliedForShowcase === true;
                                const isShowcased = !!link?.showcaseVideoUrl;
                                const isBusy = busyId === creation.id;
                                return (
                                    <div key={creation.id} className="border rounded-lg overflow-hidden bg-gray-50 flex flex-col">
                                        <div className="flex gap-3 p-3">
                                            <img src={getThumbnail(creation)} alt={creation.title} className="w-24 h-16 object-cover rounded flex-shrink-0" />
                                            <div className="min-w-0">
                                                <p className="font-semibold text-gray-800 truncate" title={creation.title}>{creation.title}</p>
                                                <p className="text-xs text-gray-500 capitalize">{(creation.game || '').replace(/-/g, ' ')}</p>
                                                <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${creation.status === 'finished' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                    {creation.status === 'finished' ? 'Finished' : 'WIP'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="mt-auto flex items-center gap-2 px-3 pb-3">
                                            {isAdded ? (
                                                <>
                                                    <button
                                                        onClick={() => handleRemove(creation)}
                                                        disabled={isBusy}
                                                        className="flex-1 text-sm font-semibold py-1.5 px-3 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                                                    >
                                                        Remove
                                                    </button>
                                                    {isShowcased ? (
                                                        <span className="flex-1 text-center text-sm font-semibold py-1.5 px-3 rounded-lg bg-purple-100 text-purple-700" title="This creation has already been showcased in this community.">
                                                            Showcased ✓
                                                        </span>
                                                    ) : hasApplied ? (
                                                        <span className="flex-1 text-center text-sm font-semibold py-1.5 px-3 rounded-lg bg-gray-200 text-gray-500" title="Each creation can only apply once.">
                                                            Applied ✓
                                                        </span>
                                                    ) : canApplyShowcase ? (
                                                        <button
                                                            onClick={() => handleApply(creation)}
                                                            disabled={isBusy}
                                                            className="flex-1 text-sm font-semibold py-1.5 px-3 rounded-lg text-white community-bg hover:brightness-90 disabled:opacity-50"
                                                        >
                                                            Apply for Showcase
                                                        </button>
                                                    ) : null}
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => handleAdd(creation)}
                                                    disabled={isBusy}
                                                    className="flex-1 text-sm font-semibold py-1.5 px-3 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                                                >
                                                    Add to Community
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddCreationsToCommunityModal;
