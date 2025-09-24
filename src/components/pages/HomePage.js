import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '../../firebase/config';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs, limit, orderBy, startAfter } from 'firebase/firestore';
import { getGameColor, ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import UserSearchResultCard from '../cards/UserSearchResultCard';
import Icon from '../ui/Icon';

const HomePage = ({ user, userProfile, activeTab, setActiveTab, homeState, setHomeState }) => {
    const TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;

    const [categories, setCategories] = useState(['All']);
    const [creations, setCreations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastVisible, setLastVisible] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    
    const [isFilterVisible, setIsFilterVisible] = useState(false);
    const [isDlcFilterVisible, setIsDlcFilterVisible] = useState(false);
    const [userSearchResults, setUserSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    
    const [gameDlcs, setGameDlcs] = useState([]);
    const [selectedDlcs, setSelectedDlcs] = useState([]);
    const [dlcFilterMode, setDlcFilterMode] = useState('all');

    const [searchParams, setSearchParams] = useSearchParams();

    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const categoryTabRefs = useRef([]);
    const categoryGliderRef = useRef(null);
    const filterMenuRef = useRef(null);
    const dlcMenuRef = useRef(null);
    const color = getGameColor(activeTab);

    useEffect(() => {
        const tagFromUrl = searchParams.get('tag');
        if (tagFromUrl) {
            const currentTags = homeState.filterTags || [];
            const currentTagsLower = currentTags.map(t => t.toLowerCase());
            if (!currentTagsLower.includes(tagFromUrl.toLowerCase())) {
                setHomeState(prevState => ({
                    ...prevState,
                    filterTags: [...currentTags, tagFromUrl]
                }));
            }
            // Clean the URL by removing the tag parameter after it's been processed
            searchParams.delete('tag');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams, homeState.filterTags, setHomeState]);


    const handleAddTag = (tagToAdd) => {
        const trimmedTag = tagToAdd.trim();
        const currentTags = homeState.filterTags || [];
        if (trimmedTag && !currentTags.map(t => t.toLowerCase()).includes(trimmedTag.toLowerCase())) {
            setHomeState(prevState => ({
                ...prevState,
                filterTags: [...currentTags, trimmedTag],
                filterTagInput: ''
            }));
        }
    };

    const handleRemoveTag = (tagToRemove) => {
        setHomeState(prevState => ({
            ...prevState,
            filterTags: prevState.filterTags.filter(tag => tag.toLowerCase() !== tagToRemove.toLowerCase())
        }));
    };

    const isFilterActive = useMemo(() => {
        const isPlatformGame = activeTab === 'planet-coaster' || activeTab === 'planet-zoo';
        const platformFilterActive = isPlatformGame && homeState.platformFilter === 'console';
        const modsFilterActive = isPlatformGame && homeState.showModsOnly;

        return (
            (homeState.filterTags && homeState.filterTags.length > 0) ||
            dlcFilterMode !== 'all' ||
            modsFilterActive ||
            platformFilterActive
        );
    }, [homeState, dlcFilterMode, activeTab]);

    useEffect(() => {
        const fetchInitialCreations = async () => {
            setLoading(true);
            setHasMore(true);
            const creationsQuery = query(
                collection(db, 'creations'), 
                where('game', '==', activeTab),
                orderBy('createdAt', 'desc'),
                limit(24)
            );
            const documentSnapshots = await getDocs(creationsQuery);
            const initialCreations = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setCreations(initialCreations);
            setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length-1]);
            setLoading(false);
            if (documentSnapshots.docs.length < 24) {
                setHasMore(false);
            }
        };
        fetchInitialCreations();
    }, [activeTab]);

    const fetchMoreCreations = useCallback(async () => {
        if (loading || loadingMore || !hasMore) return;
        setLoadingMore(true);

        const nextQuery = query(
            collection(db, 'creations'), 
            where('game', '==', activeTab),
            orderBy('createdAt', 'desc'),
            startAfter(lastVisible),
            limit(24)
        );
        
        const documentSnapshots = await getDocs(nextQuery);
        const newCreations = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (newCreations.length > 0) {
            setCreations(prevCreations => [...prevCreations, ...newCreations]);
            setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length-1]);
        }
        
        if (newCreations.length < 24) {
            setHasMore(false);
        }
        
        setLoadingMore(false);
    }, [loading, loadingMore, hasMore, activeTab, lastVisible]);
    
    useEffect(() => {
        const handleScroll = () => {
            const isBottom = window.innerHeight + document.documentElement.scrollTop + 1 >= document.documentElement.offsetHeight;
            if (isBottom) {
                fetchMoreCreations();
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [fetchMoreCreations]);


    useEffect(() => {
        const docRef = doc(db, 'categories', activeTab);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setCategories(['All', ...docSnap.data().names]);
            } else {
                setCategories(['All']);
            }
        });
        return () => unsubscribe();
    }, [activeTab]);
    
    useEffect(() => {
        const dlcRef = doc(db, 'dlcs', activeTab);
        const unsubscribe = onSnapshot(dlcRef, (docSnap) => {
            const dlcs = docSnap.exists() ? docSnap.data().names || [] : [];
            setGameDlcs(dlcs);
            setSelectedDlcs([]); 
            setDlcFilterMode('all');
        });
        return () => unsubscribe();
    }, [activeTab]);

    useEffect(() => {
        if (!categories.includes(homeState.activeCategory)) {
            setHomeState(prevState => ({ ...prevState, activeCategory: 'All' }));
        }
    }, [categories, homeState.activeCategory, setHomeState]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
                setIsFilterVisible(false);
            }
            if (dlcMenuRef.current && !dlcMenuRef.current.contains(event.target)) {
                setIsDlcFilterVisible(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const activeTabIndex = TABS.findIndex(tab => tab.id === activeTab);
        const activeTabNode = tabRefs.current[activeTabIndex];
        if (activeTabNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [activeTab, TABS]);

    useEffect(() => {
        if (loading) return;
        const activeCatIndex = categories.findIndex(cat => cat === homeState.activeCategory);
        const activeCatNode = categoryTabRefs.current[activeCatIndex];
        if (activeCatNode && categoryGliderRef.current) {
            categoryGliderRef.current.style.left = `${activeCatNode.offsetLeft}px`;
            categoryGliderRef.current.style.width = `${activeCatNode.offsetWidth}px`;
        }
    }, [homeState.activeCategory, categories, loading]);

    useEffect(() => {
        const searchUsers = async () => {
            if (homeState.searchTerm.trim() === '') {
                setUserSearchResults([]);
                setIsSearching(false);
                return;
            }
            setIsSearching(true);
            try {
                const searchTermLower = homeState.searchTerm.toLowerCase();
                const usersQuery = query(
                    collection(db, 'profiles'),
                    where('username_lowercase', '>=', searchTermLower),
                    where('username_lowercase', '<=', searchTermLower + '\uf8ff'),
                    limit(10)
                );
                const userSnapshot = await getDocs(usersQuery);
                const users = userSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setUserSearchResults(users);
            } catch (error) {
                console.error("Error searching users:", error);
            } finally {
                setIsSearching(false);
            }
        };
        const debounceTimer = setTimeout(() => {
            searchUsers();
        }, 300);
        return () => clearTimeout(debounceTimer);
    }, [homeState.searchTerm]);

    const filteredCreations = useMemo(() => {
        let filtered = [...creations];
        
        if (dlcFilterMode === 'owned') {
            const ownedDlcs = userProfile?.ownedDlcs?.[activeTab] || [];
            filtered = filtered.filter(creation => 
                !creation.requiredDlcs || creation.requiredDlcs.length === 0 || creation.requiredDlcs.every(dlc => ownedDlcs.includes(dlc))
            );
        } else if (dlcFilterMode === 'custom' && selectedDlcs.length > 0) {
            filtered = filtered.filter(creation => 
                !creation.requiredDlcs || creation.requiredDlcs.length === 0 || creation.requiredDlcs.every(dlc => selectedDlcs.includes(dlc))
            );
        }

        if (activeTab === 'planet-coaster' || activeTab === 'planet-zoo') {
            filtered = filtered.filter(c => (c.platform || 'pc') === homeState.platformFilter);
        }
        if (!homeState.showModsOnly) {
            filtered = filtered.filter(c => c.modStatus !== 'UsingMods');
        }
        if (homeState.activeCategory !== 'All') {
            filtered = filtered.filter(c => c.category === homeState.activeCategory);
        }
        if (homeState.searchTerm.trim()) {
            const searchTermLower = homeState.searchTerm.toLowerCase();
            filtered = filtered.filter(c =>
                c.title.toLowerCase().includes(searchTermLower) ||
                (c.tags && c.tags.some(tag => tag.toLowerCase().includes(searchTermLower)))
            );
        }
        // Updated logic for multiple tags
        if (homeState.filterTags && homeState.filterTags.length > 0) {
            filtered = filtered.filter(c => 
                c.tags && homeState.filterTags.every(filterTag => 
                    c.tags.some(creationTag => creationTag.toLowerCase() === filterTag.toLowerCase())
                )
            );
        }

        switch (homeState.sortBy) {
            case 'likes':
                filtered.sort((a, b) => (b.likes || 0) - (a.likes || 0));
                break;
            case 'likes_asc':
                filtered.sort((a, b) => (a.likes || 0) - (b.likes || 0));
                break;
            case 'createdAt_asc':
                filtered.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
                break;
            case 'createdAt':
            default:
                // The default fetch is already sorted by createdAt desc, so we don't need to re-sort unless another sort is active.
                break;
        }

        return filtered;
    }, [homeState, creations, activeTab, selectedDlcs, dlcFilterMode, userProfile]);



    useEffect(() => {
        const savedPreference = userProfile?.platformPreferences?.[activeTab];
        if (savedPreference) {
            setHomeState(prev => ({ ...prev, platformFilter: savedPreference }));
        } else {
            setHomeState(prev => ({ ...prev, platformFilter: 'pc' }));
        }
    }, [activeTab, userProfile, setHomeState]);

    const handleDlcChange = (dlcName) => {
        setDlcFilterMode('custom');
        setSelectedDlcs(prev => prev.includes(dlcName) ? prev.filter(d => d !== dlcName) : [...prev, dlcName]);
    };

    const handleSelectOwned = () => {
        setDlcFilterMode('owned');
        setSelectedDlcs(userProfile?.ownedDlcs?.[activeTab] || []);
    };
    
    const handleSelectAll = () => {
        setDlcFilterMode('all');
        setSelectedDlcs([]);
    };

    return (
        <div className="container mx-auto p-4">
            <div className="flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                    <div ref={gliderRef} className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} />
                    {TABS.map((tab, index) => (
                        <button
                            key={tab.id}
                            ref={el => tabRefs.current[index] = el}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium ${activeTab === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex justify-center mb-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                    <div ref={categoryGliderRef} className="absolute h-full rounded-full bg-white transition-all duration-500 ease-in-out shadow" />
                    {categories.map((cat, index) => (
                        <button
                            key={cat}
                            ref={el => categoryTabRefs.current[index] = el}
                            onClick={() => setHomeState({ ...homeState, activeCategory: cat })}
                            className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium text-sm whitespace-nowrap ${homeState.activeCategory === cat ? color.text : 'text-gray-500 hover:text-gray-800'}`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col md:flex-row justify-center items-center mb-6 gap-4">
                <div className="flex w-full md:w-auto flex-grow max-w-xl items-center gap-2">
                    <div className="relative flex-grow">
                        <input
                            type="text"
                            placeholder="Search for creations or users"
                            value={homeState.searchTerm}
                            onChange={(e) => setHomeState({ ...homeState, searchTerm: e.target.value })}
                            className={`w-full p-3 pl-10 pr-10 bg-gray-200 rounded-full focus:outline-none focus:ring-2 ${color.ring}`}
                        />
                        <Icon path={ICONS.search} className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        {homeState.searchTerm && (
                            <button
                                onClick={() => setHomeState({ ...homeState, searchTerm: '' })}
                                className="absolute z-10 right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-300/50 transition-colors"
                                aria-label="Clear search"
                            >
                                <span className={`text-2xl font-bold ${color.text} pb-1`}>×</span>
                            </button>
                        )}
                    </div>
                    
                    <div className="relative" ref={filterMenuRef}>
                        <button
                            onClick={() => setIsFilterVisible(!isFilterVisible)}
                            className={`p-3 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors duration-300 ${isFilterActive ? `${color.bg} text-white` : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                        >
                            <Icon path={ICONS.filter} className="w-6 h-6" />
                        </button>
                        {isFilterVisible && (
                            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl p-4 z-20">
                                <h4 className="font-bold mb-2">Sort & Filter</h4>
                                <label className="block text-sm font-medium text-gray-700">Sort by</label>
                                <select
                                    value={homeState.sortBy}
                                    onChange={(e) => setHomeState({ ...homeState, sortBy: e.target.value })}
                                    className={`mt-1 block w-full p-2 border-gray-300 rounded-md shadow-sm focus:ring-2 ${color.ring} focus:border-blue-500`}
                                >
                                    <option value="createdAt">Newest First</option>
                                    <option value="likes">Most Popular</option>
                                    <option value="createdAt_asc">Oldest First</option>
                                    <option value="likes_asc">Least Popular</option>
                                </select>
                                <label className="block text-sm font-medium text-gray-700 mt-4">Filter by Tag</label>
                                <div className="relative mt-1">
                                    <input
                                        type="text"
                                        placeholder="Type a tag and press Enter"
                                        value={homeState.filterTagInput || ''}
                                        onChange={(e) => setHomeState({ ...homeState, filterTagInput: e.target.value })}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleAddTag(homeState.filterTagInput);
                                            }
                                        }}
                                        className={`block w-full p-2 pr-8 border-gray-300 rounded-md shadow-sm focus:ring-2 ${color.ring} focus:border-blue-500`}
                                    />
                                    {(homeState.filterTagInput || '').trim() && (
                                        <button
                                            onClick={() => setHomeState({ ...homeState, filterTagInput: '' })}
                                            className="absolute z-10 right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors"
                                            aria-label="Clear tag filter"
                                        >
                                            <span className={`text-xl font-bold ${color.text} pb-1`}>×</span>
                                        </button>
                                    )}
                                </div>
                                
                                {homeState.filterTags && homeState.filterTags.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {homeState.filterTags.map(tag => (
                                            <span key={tag} className="flex items-center bg-gray-200 text-gray-700 text-sm font-medium pl-3 pr-2 py-1 rounded-full">
                                                {tag}
                                                <button
                                                    onClick={() => handleRemoveTag(tag)}
                                                    className="ml-2 -mr-1 text-gray-400 hover:text-gray-700 rounded-full"
                                                    aria-label={`Remove ${tag} filter`}
                                                >
                                                    <span className="text-md font-bold">×</span>
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="relative" ref={dlcMenuRef}>
                        <button
                            onClick={() => setIsDlcFilterVisible(!isDlcFilterVisible)}
                            className="bg-gray-200 p-3 rounded-full hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 font-semibold"
                        >
                           DLC
                        </button>
                        {isDlcFilterVisible && (
                            <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl p-4 z-20">
                                <h4 className="font-bold mb-3 border-b pb-2">Filter by DLC</h4>
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    <label className="flex items-center text-gray-800 font-semibold">
                                        <input type="radio" name="dlcFilter" checked={dlcFilterMode === 'all'} onChange={handleSelectAll} className="h-4 w-4 text-blue-600 focus:ring-blue-500"/>
                                        <span className="ml-2">Show All (Default)</span>
                                    </label>
                                    {user && (
                                        <label className="flex items-center text-gray-800 font-semibold">
                                            <input type="radio" name="dlcFilter" checked={dlcFilterMode === 'owned'} onChange={handleSelectOwned} className="h-4 w-4 text-blue-600 focus:ring-blue-500"/>
                                            <span className="ml-2">Creations I Can Use</span>
                                        </label>
                                    )}
                                    <hr className="my-2"/>
                                    {gameDlcs.map(dlc => (
                                        <label key={dlc} className="flex items-center text-gray-700">
                                            <input type="checkbox" checked={selectedDlcs.includes(dlc)} onChange={() => handleDlcChange(dlc)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                            <span className="ml-2">{dlc}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {(activeTab === 'planet-coaster' || activeTab === 'planet-zoo') && (
                    <div className="flex items-center justify-center gap-4 md:mt-0">
                        <div className="flex items-center space-x-2">
                            <span className={`text-sm font-medium transition-colors ${homeState.platformFilter === 'console' ? 'text-gray-400' : 'text-blue-600'}`}>
                                PC
                            </span>
                            <div
                                onClick={() => setHomeState({ ...homeState, platformFilter: homeState.platformFilter === 'pc' ? 'console' : 'pc' })}
                                className={`relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 ${homeState.platformFilter === 'pc' ? 'bg-blue-500' : 'bg-green-500'}`}
                            >
                                <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${homeState.platformFilter === 'pc' ? 'translate-x-0' : 'translate-x-6'}`}></div>
                            </div>
                            <span className={`text-sm font-medium transition-colors ${homeState.platformFilter === 'pc' ? 'text-gray-400' : 'text-green-600'}`}>
                                Console
                            </span>
                        </div>
                        <div className="flex items-center space-x-2">
                            <span className={`text-sm font-medium transition-colors ${homeState.showModsOnly ? 'text-green-600' : 'text-gray-500'}`}>
                                Show Modded
                            </span>
                            <div
                                onClick={() => setHomeState({ ...homeState, showModsOnly: !homeState.showModsOnly })}
                                className={`relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 ${homeState.showModsOnly ? 'bg-green-500' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${homeState.showModsOnly ? 'translate-x-6' : 'translate-x-0'}`}></div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {loading ? <Spinner gameId={activeTab} /> : (
                <>
                    {isSearching && (
                        <div className="mb-8 text-center">
                            <Spinner />
                        </div>
                    )}

                    {!isSearching && userSearchResults.length > 0 && (
                        <div className="mb-8">
                            <h2 className="text-2xl font-bold mb-4 text-gray-800">Users Found</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                                {userSearchResults.map(userResult => (
                                    <UserSearchResultCard
                                        key={userResult.id}
                                        user={userResult}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mb-8">
                        {homeState.searchTerm.trim() && <h2 className="text-2xl font-bold mb-4 text-gray-800">Creations Found</h2>}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {filteredCreations.map(creation => (
                                <CreationCard 
                                    key={creation.id} 
                                    creation={creation}
                                    onTagClick={handleAddTag}
                                />
                            ))}
                        </div>
                        {loadingMore && <div className="text-center p-8 col-span-full"><Spinner/></div>}
                        {!hasMore && creations.length > 0 && (
                            <p className="text-center text-gray-500 mt-10 text-xl col-span-full">You've reached the end!</p>
                        )}
                        {!loading && filteredCreations.length === 0 && (
                            <p className="text-center text-gray-500 mt-10 text-xl">No creations found. Try a different search!</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default HomePage;