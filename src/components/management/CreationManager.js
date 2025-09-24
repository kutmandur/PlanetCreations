import React, { useState, useMemo, useRef, useEffect } from 'react';
import { db, auth } from '../../firebase/config';
import { doc, setDoc, writeBatch, arrayRemove, collection, serverTimestamp, increment, onSnapshot } from 'firebase/firestore';
import ManagedCreationCard from './ManagedCreationCard';
import Icon from '../ui/Icon';
import { ICONS, getGameColor } from '../../utils/helpers';
import ShowcaseNoteModal from '../modals/ShowcaseNoteModal';

const CreationManager = ({ creations, setCreations, communityId, setModalMessage, ranks, setPopoverView, blacklist }) => {
    const [managerState, setManagerState] = useState({
        searchTerm: '',
        filter: 'all',
        rankFilter: 'all',
        filterTag: '',
        sortBy: 'pinned_first',
        // ✅ 1. Add state for the new filters
        activeGame: 'planet-coaster-2',
        activeCategory: 'All',
    });
    
    const [isFilterVisible, setIsFilterVisible] = useState(false);
    const filterMenuRef = useRef(null);
    const [showcaseModal, setShowcaseModal] = useState(null); 

    // ✅ 2. Add state and refs for the new tab bars
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

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
                setIsFilterVisible(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // ✅ 3. Add useEffects to fetch categories and animate the tab bars
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
    }, [managerState.activeGame]);

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

    const handleStateChange = (field, value) => {
        setManagerState(prev => ({ ...prev, [field]: value }));
    };

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
            const communityAssignment = creation.communityAssignments.find(ca => ca.communityId === communityId);
            batch.update(creationRef, {
                communityIds: arrayRemove(communityId),
                communityAssignments: arrayRemove(communityAssignment)
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

    const filteredAndSortedCreations = useMemo(() => {
        let filtered = [...creations];

        // ✅ 4. Update the main filter logic to include game and category
        filtered = filtered.filter(creation => {
            const { filter, rankFilter, searchTerm, filterTag, activeGame, activeCategory } = managerState;
            
            // Game and Category Filters
            if (creation.game !== activeGame) return false;
            if (activeCategory !== 'All' && creation.category !== activeCategory) return false;

            // Status Filter
            if (filter !== 'all') {
                if (filter === 'pinned' && !creation.pinned) return false;
                if (filter === 'unpinned' && creation.pinned) return false;
                if (filter === 'showcased' && !creation.showcaseVideoUrl) return false;
                if (filter === 'not-showcased' && creation.showcaseVideoUrl) return false;
                if (filter === 'finished' && creation.status !== 'finished') return false;
                if (filter === 'wip' && creation.status !== 'wip') return false;
            }

            // Rank Filter
            if (rankFilter !== 'all') {
                if (!creation.creatorRanks.some(rank => rank.name.toLowerCase() === rankFilter)) return false;
            }

            // Search Term Filter
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase();
                if (!creation.title.toLowerCase().includes(term) && !creation.username.toLowerCase().includes(term)) return false;
            }

            // Tag Filter
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
    }, [creations, managerState, categories]);

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
            
            {/* ✅ 5. Add the game and category tab bars */}
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

            <div className="flex gap-4 mb-6 p-4 bg-gray-50 rounded-lg border">
                <div className="relative flex-grow">
                    <input 
                        type="text"
                        placeholder="Search by title or user..."
                        value={managerState.searchTerm}
                        onChange={(e) => handleStateChange('searchTerm', e.target.value)}
                        className="w-full p-3 pl-10 border rounded-lg"
                    />
                    <Icon path={ICONS.search} className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
                <div className="relative" ref={filterMenuRef}>
                    <button onClick={() => setIsFilterVisible(!isFilterVisible)} className="bg-gray-200 p-3 h-full rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400">
                        <Icon path={ICONS.filter} className="w-6 h-6 text-gray-600" />
                    </button>
                    {isFilterVisible && (
                        <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl p-4 z-20 border">
                            <h4 className="font-bold mb-3 border-b pb-2">Filter & Sort</h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Sort by</label>
                                    <select value={managerState.sortBy} onChange={(e) => handleStateChange('sortBy', e.target.value)} className="mt-1 block w-full p-2 border-gray-300 rounded-md shadow-sm">
                                        <option value="pinned_first">Pinned First</option>
                                        <option value="newest">Newest</option>
                                        <option value="oldest">Oldest</option>
                                        <option value="title">Alphabetical</option>
                                        <option value="likes">Most Popular</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Filter by Status</label>
                                    <select value={managerState.filter} onChange={(e) => handleStateChange('filter', e.target.value)} className="mt-1 block w-full p-2 border-gray-300 rounded-md shadow-sm">
                                        <option value="all">All Statuses</option>
                                        <option value="pinned">Pinned</option>
                                        <option value="unpinned">Unpinned</option>
                                        <option value="showcased">Showcased</option>
                                        <option value="not-showcased">Not Showcased</option>
                                        <option value="finished">Finished</option>
                                        <option value="wip">Work in Progress</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Filter by Rank</label>
                                    <select value={managerState.rankFilter} onChange={(e) => handleStateChange('rankFilter', e.target.value)} className="mt-1 block w-full p-2 border-gray-300 rounded-md shadow-sm">
                                        <option value="all">All Ranks</option>
                                        {ranks.map(rank => (<option key={rank.name} value={rank.name.toLowerCase()}>{rank.name}</option>))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Filter by Tag</label>
                                    <input type="text" placeholder="e.g. Coaster" value={managerState.filterTag} onChange={(e) => handleStateChange('filterTag', e.target.value)} className="mt-1 block w-full p-2 border-gray-300 rounded-md shadow-sm" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
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