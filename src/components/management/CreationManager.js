import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { db, auth } from '../../firebase/config';
import { doc, getDoc, setDoc, writeBatch, arrayRemove, collection, serverTimestamp, increment, onSnapshot } from 'firebase/firestore';
import ManagedCreationCard from './ManagedCreationCard';
import { getGameColor } from '../../utils/helpers';
import ShowcaseNoteModal from '../modals/ShowcaseNoteModal';
import CommunityFilterBar from './CommunityFilterBar';

const CreationManager = ({ creations, setCreations, communityId, setModalMessage, ranks, setPopoverView, blacklist }) => {
    const [managerState, setManagerState] = useState({
        searchTerm: '',
        filter: 'all',
        rankFilter: 'all',
        filterTag: '',
        dlcFilter: 'all',
        sortBy: 'pinned_first',
        activeGame: 'planet-coaster-2',
        activeCategory: 'All',
    });

    const [showcaseModal, setShowcaseModal] = useState(null);

    const [categories, setCategories] = useState(['All']);
    const TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const categoryTabRefs = useRef([]);
    const categoryGliderRef = useRef(null);
    const color = getGameColor(managerState.activeGame);

    const handleStateChange = useCallback((field, value) => {
        setManagerState(prev => ({ ...prev, [field]: value }));
    }, []);

    useEffect(() => {
        const docRef = doc(db, 'categories', managerState.activeGame);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            const categoryNames = docSnap.exists() ? docSnap.data().names : [];
            setCategories(['All', ...categoryNames]);
            if (!['All', ...categoryNames].includes(managerState.activeCategory)) {
                handleStateChange('activeCategory', 'All');
            }
        });
        return () => unsubscribe();
    }, [managerState.activeGame, managerState.activeCategory, handleStateChange]);

    useEffect(() => {
        const activeTabIndex = TABS.findIndex(tab => tab.id === managerState.activeGame);
        const activeTabNode = tabRefs.current[activeTabIndex];
        if (activeTabNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [managerState.activeGame, TABS]);

    useEffect(() => {
        const activeCatIndex = categories.findIndex(cat => cat === managerState.activeCategory);
        const activeCatNode = categoryTabRefs.current[activeCatIndex];
        if (activeCatNode && categoryGliderRef.current) {
            categoryGliderRef.current.style.left = `${activeCatNode.offsetLeft}px`;
            categoryGliderRef.current.style.width = `${activeCatNode.offsetWidth}px`;
        }
    }, [managerState.activeCategory, categories]);

    const handlePinToggle = async (creationId, isCurrentlyPinned) => {
        const pinnedCount = creations.filter(c => c.pinned).length;
        if (!isCurrentlyPinned && pinnedCount >= 20) {
            setModalMessage("You can only pin a maximum of 20 creations.");
            return;
        }
        const linkRef = doc(db, 'communitys', communityId, 'creations', creationId);
        try {
            await setDoc(linkRef, { pinned: !isCurrentlyPinned }, { merge: true });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, pinned: !isCurrentlyPinned } : c));
            setModalMessage(`Creation ${!isCurrentlyPinned ? 'pinned' : 'unpinned'} successfully.`);
        } catch (error) {
            setModalMessage(`Error updating pin status: ${error.message}`);
        }
    };

    const handleMarkForShowcase = (creationId) => {
        setShowcaseModal({ creationId });
    };

    const handleConfirmShowcase = async (note) => {
        if (!showcaseModal) return;
        const { creationId } = showcaseModal;
        const linkRef = doc(db, 'communitys', communityId, 'creations', creationId);
        try {
            await setDoc(linkRef, {
                markedForShowcase: true,
                showcaseNote: note
            }, { merge: true });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, markedForShowcase: true, showcaseNote: note } : c));
            setModalMessage("Creation marked for showcase successfully.");
        } catch (error) {
            setModalMessage(`Error marking for showcase: ${error.message}`);
        } finally {
            setShowcaseModal(null);
        }
    };

    const handleUnlink = async (creation) => {
        const batch = writeBatch(db);
        const creationRef = doc(db, 'creations', creation.id);
        try {
            // communityAssignments frisch aus dem Dokument lesen — die Manager-Liste
            // kommt aus dem Kompakt-Index, der dieses Feld nicht enthält
            const creationSnap = await getDoc(creationRef);
            const assignments = creationSnap.exists() ? (creationSnap.data().communityAssignments || []) : [];
            const communityAssignment = assignments.find(ca => ca.communityId === communityId);
            batch.update(creationRef, {
                communityIds: arrayRemove(communityId),
                ...(communityAssignment ? { communityAssignments: arrayRemove(communityAssignment) } : {})
            });
            const linkRef = doc(db, 'communitys', communityId, 'creations', creation.id);
            batch.delete(linkRef);
            const reportRef = doc(collection(db, 'reports'));
            batch.set(reportRef, {
                targetId: creation.id,
                targetType: 'creation',
                targetTitle: creation.title,
                reason: `Removed from community by moderator/owner.`,
                reporterId: auth.currentUser.uid,
                timestamp: serverTimestamp(),
            });
            batch.update(creationRef, { reportCount: increment(1) });
            await batch.commit();
            setModalMessage("Creation has been unlinked from the community and a report has been filed.");
        } catch (error) {
            setModalMessage(`Error unlinking creation: ${error.message}`);
        }
    };

    const availableDlcs = useMemo(() => {
        const dlcs = new Set();
        creations.forEach(c => (c.requiredDlcs || []).forEach(dlc => dlcs.add(dlc)));
        return [...dlcs].sort();
    }, [creations]);

    const filteredAndSortedCreations = useMemo(() => {
        let filtered = [...creations];

        filtered = filtered.filter(creation => {
            const { filter, rankFilter, searchTerm, filterTag, dlcFilter, activeGame, activeCategory } = managerState;

            if (creation.game !== activeGame) return false;
            if (activeCategory !== 'All' && creation.category !== activeCategory) return false;

            if (filter !== 'all') {
                if (filter === 'pinned' && !creation.pinned) return false;
                if (filter === 'unpinned' && creation.pinned) return false;
                if (filter === 'showcased' && !creation.showcaseVideoUrl) return false;
                if (filter === 'not-showcased' && creation.showcaseVideoUrl) return false;
                if (filter === 'finished' && creation.status !== 'finished') return false;
                if (filter === 'wip' && creation.status !== 'wip') return false;
            }

            if (rankFilter !== 'all') {
                if (!creation.creatorRanks.some(rank => rank.name.toLowerCase() === rankFilter)) return false;
            }

            if (dlcFilter !== 'all') {
                if (!(creation.requiredDlcs || []).includes(dlcFilter)) return false;
            }

            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase();
                if (!creation.title.toLowerCase().includes(term) &&
                    !creation.username.toLowerCase().includes(term) &&
                    !(creation.tags || []).some(tag => tag.toLowerCase().includes(term))) return false;
            }

            if (filterTag.trim()) {
                const tagTerm = filterTag.toLowerCase().trim();
                if (!creation.tags || !creation.tags.some(tag => tag.toLowerCase().includes(tagTerm))) return false;
            }

            return true;
        });

        const pinned = filtered.filter(c => c.pinned);
        const unpinned = filtered.filter(c => !c.pinned);

        unpinned.sort((a, b) => {
            switch (managerState.sortBy) {
                case 'title': return a.title.localeCompare(b.title);
                case 'newest': return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
                case 'oldest': return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
                case 'likes': return (b.likes || 0) - (a.likes || 0);
                case 'pinned_first':
                default: return a.title.localeCompare(b.title);
            }
        });
        
        return [...pinned, ...unpinned];
    }, [creations, managerState]);

    return (
        <div>
            {showcaseModal && (
                <ShowcaseNoteModal
                    onConfirm={handleConfirmShowcase}
                    onCancel={() => setShowcaseModal(null)}
                    blacklist={blacklist}
                />
            )}

            <h2 className="text-2xl font-bold mb-4 text-center">Manage Community Creations</h2>
            
            <div className="flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                    <div ref={gliderRef} className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} />
                    {TABS.map((tab, index) => (
                        <button key={tab.id} ref={el => tabRefs.current[index] = el} onClick={() => handleStateChange('activeGame', tab.id)} className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium ${ managerState.activeGame === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}>
                            {tab.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex justify-center mb-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                    <div ref={categoryGliderRef} className="absolute h-full rounded-full bg-white transition-all duration-500 ease-in-out shadow" />
                    {categories.map((cat, index) => (
                        <button key={cat} ref={el => categoryTabRefs.current[index] = el} onClick={() => handleStateChange('activeCategory', cat)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium text-sm whitespace-nowrap ${managerState.activeCategory === cat ? color.text : 'text-gray-500 hover:text-gray-800'}`}>
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            <CommunityFilterBar
                searchTerm={managerState.searchTerm}
                onSearchChange={(value) => handleStateChange('searchTerm', value)}
                filters={{
                    status: managerState.filter,
                    rank: managerState.rankFilter,
                    tag: managerState.filterTag,
                    dlc: managerState.dlcFilter,
                    sort: managerState.sortBy,
                }}
                onFilterChange={(field, value) => {
                    const fieldMap = { status: 'filter', rank: 'rankFilter', tag: 'filterTag', dlc: 'dlcFilter', sort: 'sortBy' };
                    handleStateChange(fieldMap[field], value);
                }}
                ranks={ranks}
                availableDlcs={availableDlcs}
                sortOptions={[
                    { value: 'pinned_first', label: 'Pinned First' },
                    { value: 'newest', label: 'Newest' },
                    { value: 'oldest', label: 'Oldest' },
                    { value: 'title', label: 'Alphabetical' },
                    { value: 'likes', label: 'Most Popular' },
                ]}
                statusOptions={[
                    { value: 'all', label: 'All Statuses' },
                    { value: 'pinned', label: 'Pinned' },
                    { value: 'unpinned', label: 'Unpinned' },
                    { value: 'showcased', label: 'Showcased' },
                    { value: 'not-showcased', label: 'Not Showcased' },
                    { value: 'finished', label: 'Finished' },
                    { value: 'wip', label: 'Work in Progress' },
                ]}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredAndSortedCreations.map(creation => (
                    <ManagedCreationCard 
                        key={creation.id}
                        creation={creation}
                        onPinToggle={() => handlePinToggle(creation.id, creation.pinned)}
                        onUnlink={() => handleUnlink(creation)}
                        onClick={() => setPopoverView({ name: 'detail', id: creation.id })}
                        onMarkForShowcase={() => handleMarkForShowcase(creation.id)}
                    />
                ))}
            </div>
             {filteredAndSortedCreations.length === 0 && (
                <p className="text-center text-gray-500 mt-10">No creations found matching your criteria.</p>
            )}
        </div>
    );
};

export default CreationManager;