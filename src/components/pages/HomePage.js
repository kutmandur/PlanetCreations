import React, { useRef, useState, useEffect, useMemo, useCallback, useTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import { db } from '../../firebase/config';
import { doc, collection, query, where, onSnapshot, getDoc, getDocs, limit, orderBy, startAfter } from 'firebase/firestore';
import { getGameColor, ICONS } from '../../utils/helpers';
import { cacheCreations, getCachedHomePageList, cacheHomePageList } from '../../utils/creationCache';
import { fetchSearchIndex } from '../../firebase/searchIndexService';
import { rankCreations, getDayKey, DEFAULT_WEIGHTS } from '../../utils/feedRanking';
import { getInterestMap, getLocalFeedWeights, recordTagClick, recordSearch } from '../../utils/interestTracker';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import UserSearchResultCard from '../cards/UserSearchResultCard';
import Icon from '../ui/Icon';

const HomePage = ({ user, userProfile, activeTab, setActiveTab, homeState, setHomeState }) => {
    const queryClient = useQueryClient();

    const TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;

    const [categories, setCategories] = useState(['All']);
    const [creations, setCreations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastTimestamp, setLastTimestamp] = useState(null); // Timestamp statt DocumentSnapshot
    const [hasMore, setHasMore] = useState(true);
    
    const [isFilterVisible, setIsFilterVisible] = useState(false);
    const [isDlcFilterVisible, setIsDlcFilterVisible] = useState(false);
    const [userSearchResults, setUserSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    const [gameDlcs, setGameDlcs] = useState([]);
    const [selectedDlcs, setSelectedDlcs] = useState([]);
    const [dlcFilterMode, setDlcFilterMode] = useState('all');

    // Tag suggestions from loaded creations
    const [availableTags, setAvailableTags] = useState([]);

    // Client-seitige Pagination im Suchmodus (Index-Suche)
    const [visibleCount, setVisibleCount] = useState(24);

    const [searchParams, setSearchParams] = useSearchParams();
    
    const [isPending, startTransition] = useTransition();

    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const categoryTabRefs = useRef([]);
    const categoryGliderRef = useRef(null);
    const filterMenuRef = useRef(null);
    const dlcMenuRef = useRef(null);
    const color = getGameColor(activeTab);

    // Suche über den Kompakt-Index wenn: Textsuche aktiv ODER Tag-Filter aktiv.
    // Auch einzelne Tags laufen über den Index: der Firestore-array-contains-Pfad
    // bräuchte eigene Composite-Indexe und wäre case-sensitiv.
    const shouldUseIndexSearch = useMemo(() => {
        const hasSearchTerm = homeState.searchTerm.trim() !== '';
        const tagCount = homeState.filterTags?.length || 0;
        // DLC-/Mods-/Plattform-Filter müssen über den kompletten Spiel-Index laufen.
        // Sonst werden sie nur auf die ersten 24 nach Datum geladenen Creations
        // angewendet und zeigen falsche/leere Ergebnisse (der paginierte Firestore-
        // Pfad kann diese Felder nicht serverseitig filtern).
        const isPlatformGame = activeTab === 'planet-coaster' || activeTab === 'planet-zoo';
        const modsFilterActive = isPlatformGame && homeState.showModsOnly;
        const platformFilterActive = isPlatformGame && homeState.platformFilter === 'console';
        const dlcActive = dlcFilterMode !== 'all';
        // "Recommended" (Default) rankt übers ganze Spiel und läuft daher
        // ebenfalls über den Index — billiger als der paginierte Pfad (1 Read).
        const recommendedActive = homeState.sortBy === 'recommended';
        return hasSearchTerm || tagCount > 0 || modsFilterActive || platformFilterActive || dlcActive || recommendedActive;
    }, [homeState.searchTerm, homeState.filterTags, homeState.showModsOnly, homeState.platformFilter, homeState.sortBy, dlcFilterMode, activeTab]);

    // Suchindex des aktiven Spiels: 1 Firestore-Read, 15 Minuten gecacht,
    // wird für den Recommended-Feed und im Suchmodus geladen.
    const { data: indexCreations, isLoading: indexLoading } = useQuery({
        queryKey: ['searchIndex', activeTab],
        queryFn: () => fetchSearchIndex(activeTab),
        staleTime: 15 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        enabled: shouldUseIndexSearch,
    });

    // Globale Feed-Gewichte (Admin-Slider, meta/feedWeights) — 1 günstiger Read,
    // lange gecacht. User-Slider (localStorage-Spiegel) überschreiben sie.
    const { data: globalFeedWeights } = useQuery({
        queryKey: ['feedWeights'],
        queryFn: async () => {
            const snap = await getDoc(doc(db, 'meta', 'feedWeights'));
            return snap.exists() ? snap.data() : null;
        },
        staleTime: 30 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        enabled: homeState.sortBy === 'recommended',
    });

    // Interessen-Map fürs personalisierte Ranking ({} ohne Opt-in) — bewusst nur
    // pro Tab-Wechsel neu gelesen; der Feed ist ohnehin tagesstabil.
    const interestMap = useMemo(() => getInterestMap(), [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    const fuse = useMemo(() => {
        if (!indexCreations || indexCreations.length === 0) return null;
        return new Fuse(indexCreations, {
            keys: [
                { name: 'title', weight: 0.6 },
                { name: 'tags', weight: 0.3 },
                { name: 'description', weight: 0.1 },
            ],
            threshold: 0.35,
            ignoreLocation: true,
            minMatchCharLength: 2,
        });
    }, [indexCreations]);

    // Hilfsfunktion: Creations aus Cache anhand IDs holen
    const getCreationsFromCacheByIds = useCallback((ids) => {
        return ids
            .map(id => queryClient.getQueryData(['creation', id]))
            .filter(Boolean);
    }, [queryClient]);

    // Try to get creations from a broader cached query (e.g., "All" category)
    // Returns filtered creations if found, null otherwise
    // (Tag-Filter laufen über die Index-Suche und landen nie in diesem Pfad)
    const getFromBroaderCache = useCallback(() => {
        if (homeState.activeCategory === 'All') return null;

        const platform = (activeTab === 'planet-coaster' || activeTab === 'planet-zoo')
            ? homeState.platformFilter
            : 'all';

        const broadCache = getCachedHomePageList(queryClient, `${activeTab}_All_${platform}_`);
        if (!broadCache || !broadCache.creationIds.length) return null;

        const allCreations = getCreationsFromCacheByIds(broadCache.creationIds);
        if (allCreations.length === 0) return null;

        // Category filter
        const filteredCreations = allCreations.filter(c => c.category === homeState.activeCategory);

        // Only use if we have enough results (at least 6)
        return filteredCreations.length >= 6 ? filteredCreations : null;
    }, [activeTab, homeState.activeCategory, homeState.platformFilter, queryClient, getCreationsFromCacheByIds]);

    const handleTabClick = (tabId) => {
        startTransition(() => {
            setActiveTab(tabId);
            setHomeState(prev => ({...prev, activeCategory: 'All' }));
        });
    };

    useEffect(() => {
        const gameFromUrl = searchParams.get('game');
        const tagFromUrl = searchParams.get('tag');
        let shouldUpdateParams = false;

        // Game-Tab wechseln wenn in URL angegeben
        if (gameFromUrl && ['planet-coaster', 'planet-coaster-2', 'planet-zoo'].includes(gameFromUrl)) {
            if (activeTab !== gameFromUrl) {
                setActiveTab(gameFromUrl);
            }
            shouldUpdateParams = true;
        }

        // Tag-Filter hinzufügen
        if (tagFromUrl) {
            const currentTags = homeState.filterTags || [];
            const currentTagsLower = currentTags.map(t => t.toLowerCase());
            if (!currentTagsLower.includes(tagFromUrl.toLowerCase())) {
                setHomeState(prevState => ({
                    ...prevState,
                    filterTags: [...currentTags, tagFromUrl]
                }));
            }
            shouldUpdateParams = true;
        }

        // URL-Parameter entfernen
        if (shouldUpdateParams) {
            searchParams.delete('game');
            searchParams.delete('tag');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams, homeState.filterTags, setHomeState, activeTab, setActiveTab]);


    const handleAddTag = (tagToAdd) => {
        const trimmedTag = tagToAdd.trim();
        const currentTags = homeState.filterTags || [];
        if (trimmedTag && !currentTags.map(t => t.toLowerCase()).includes(trimmedTag.toLowerCase())) {
            recordTagClick(trimmedTag); // Interessen-Signal (No-op ohne Opt-in)
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

    // Build optimized Firestore query using available indexes
    const buildFirestoreQuery = useCallback((isLoadMore = false, lastTs = null) => {
        const constraints = [
            collection(db, 'creations'),
            where('game', '==', activeTab)
        ];

        // Category filter - Index: category + game + createdAt (or + platform)
        if (homeState.activeCategory !== 'All') {
            constraints.push(where('category', '==', homeState.activeCategory));
        }

        // Platform filter for PC1/PZ - Index: game + platform + createdAt
        if (activeTab === 'planet-coaster' || activeTab === 'planet-zoo') {
            constraints.push(where('platform', '==', homeState.platformFilter));
        }

        // Order and pagination
        // (Tag-Filter laufen komplett über die Index-Suche, nie über diesen Query)
        constraints.push(orderBy('createdAt', 'desc'));

        if (isLoadMore && lastTs) {
            constraints.push(startAfter(lastTs));
        }

        constraints.push(limit(24));

        return query(...constraints);
    }, [activeTab, homeState.activeCategory, homeState.platformFilter]);

    // Cache key that includes filters
    const cacheKey = useMemo(() => {
        const platform = (activeTab === 'planet-coaster' || activeTab === 'planet-zoo')
            ? homeState.platformFilter
            : 'all';
        return `${activeTab}_${homeState.activeCategory}_${platform}_`;
    }, [activeTab, homeState.activeCategory, homeState.platformFilter]);

    useEffect(() => {
        // Skip Firestore fetch when using the search index
        if (shouldUseIndexSearch) {
            // Sonst bliebe der initiale Lade-Spinner hängen, wenn die Seite
            // direkt mit aktivem Suchbegriff geöffnet wird
            setLoading(false);
            return;
        }

        const fetchInitialCreations = async () => {
            // 1. Prüfe ob gecachte Liste für diese exakte Filterkombi vorhanden ist
            const cached = getCachedHomePageList(queryClient, cacheKey);
            if (cached && cached.creationIds.length > 0) {
                const cachedCreations = getCreationsFromCacheByIds(cached.creationIds);
                if (cachedCreations.length > 0) {
                    setCreations(cachedCreations);
                    setLastTimestamp(cached.lastTimestamp);
                    setHasMore(cached.hasMore);
                    setLoading(false);
                    return;
                }
            }

            // 2. Versuche aus breiterem Cache (z.B. "All" Kategorie) zu filtern
            const fromBroaderCache = getFromBroaderCache();
            if (fromBroaderCache && fromBroaderCache.length > 0) {
                setCreations(fromBroaderCache);
                // Bei gefiltertem Cache: Load More deaktivieren (keine Pagination)
                setLastTimestamp(null);
                setHasMore(false);
                setLoading(false);
                return;
            }

            setLoading(true);
            setHasMore(true);

            try {
                const creationsQuery = buildFirestoreQuery(false, null);
                const documentSnapshots = await getDocs(creationsQuery);
                const initialCreations = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1];
                const lastTs = lastDoc?.data()?.createdAt || null;
                const hasMoreItems = documentSnapshots.docs.length >= 24;

                setCreations(initialCreations);
                setLastTimestamp(lastTs);
                setHasMore(hasMoreItems);

                // Creations im zentralen Cache speichern
                cacheCreations(queryClient, initialCreations);
                // Listen-Cache speichert nur IDs
                const creationIds = initialCreations.map(c => c.id);
                cacheHomePageList(queryClient, cacheKey, creationIds, lastTs, hasMoreItems);
            } catch (err) {
                // Ohne catch bleibt der Spinner bei jedem Query-Fehler (offline,
                // fehlender Composite-Index, Rules) für immer stehen.
                console.error('Failed to load creations:', err);
                setHasMore(false);
            } finally {
                setLoading(false);
            }
        };
        fetchInitialCreations();
    }, [cacheKey, queryClient, getCreationsFromCacheByIds, buildFirestoreQuery, shouldUseIndexSearch, getFromBroaderCache]);

    const fetchMoreCreations = useCallback(async () => {
        if (loading || loadingMore || !hasMore || !lastTimestamp || shouldUseIndexSearch) return;
        setLoadingMore(true);

        try {
            const nextQuery = buildFirestoreQuery(true, lastTimestamp);

            const documentSnapshots = await getDocs(nextQuery);
            const newCreations = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            if (newCreations.length > 0) {
                const updatedCreations = [...creations, ...newCreations];
                const newLastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1];
                const newLastTs = newLastDoc?.data()?.createdAt || null;
                const hasMoreItems = newCreations.length >= 24;

                setCreations(updatedCreations);
                setLastTimestamp(newLastTs);
                setHasMore(hasMoreItems);

                // Neue Creations im zentralen Cache speichern
                cacheCreations(queryClient, newCreations);
                // Listen-Cache mit allen IDs aktualisieren
                const allIds = updatedCreations.map(c => c.id);
                cacheHomePageList(queryClient, cacheKey, allIds, newLastTs, hasMoreItems);
            } else {
                setHasMore(false);
                // Cache mit hasMore=false aktualisieren
                const currentIds = creations.map(c => c.id);
                cacheHomePageList(queryClient, cacheKey, currentIds, lastTimestamp, false);
            }
        } catch (err) {
            console.error('Failed to load more creations:', err);
            setHasMore(false);
        } finally {
            setLoadingMore(false);
        }
    }, [loading, loadingMore, hasMore, cacheKey, lastTimestamp, creations, queryClient, buildFirestoreQuery, shouldUseIndexSearch]);

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

    // Extract unique tags from loaded creations for suggestions
    // (aus dem Suchindex, wenn geladen — der deckt alle Creations des Spiels ab)
    useEffect(() => {
        const source = (indexCreations && indexCreations.length > 0) ? indexCreations : creations;
        const tagCounts = {};
        source.forEach(creation => {
            if (creation.tags && Array.isArray(creation.tags)) {
                creation.tags.forEach(tag => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
        });
        // Sort by frequency and take top tags
        const sortedTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag);
        setAvailableTags(sortedTags);
    }, [creations, indexCreations]);

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

    // Interessen-Signal für "gesettelte" Suchen (zählt nur, wenn der Begriff
    // exakt ein bekannter Tag ist; No-op ohne Opt-in)
    useEffect(() => {
        const term = homeState.searchTerm.trim();
        if (!term) return undefined;
        const timer = setTimeout(() => recordSearch(term, availableTags), 1500);
        return () => clearTimeout(timer);
    }, [homeState.searchTerm, availableTags]);

    // Pagination zurücksetzen, wenn sich Suche, Sortierung oder Filter ändern
    useEffect(() => {
        setVisibleCount(24);
    }, [shouldUseIndexSearch, activeTab, homeState.searchTerm, homeState.filterTags, homeState.activeCategory, homeState.platformFilter, homeState.showModsOnly, homeState.sortBy, dlcFilterMode, selectedDlcs]);

    // Suche über den Kompakt-Index — komplett client-seitig, kein Server-Roundtrip.
    // Erst strukturelle Filter, dann Fuse.js-Textsuche über die vorgefilterte Menge.
    const indexSearchResults = useMemo(() => {
        if (!shouldUseIndexSearch || !indexCreations) return [];

        let filtered = indexCreations;

        if (homeState.activeCategory !== 'All') {
            filtered = filtered.filter(c => c.category === homeState.activeCategory);
        }

        if (activeTab === 'planet-coaster' || activeTab === 'planet-zoo') {
            filtered = filtered.filter(c => (c.platform || 'pc') === homeState.platformFilter);
        }

        if (!homeState.showModsOnly) {
            filtered = filtered.filter(c => c.modStatus !== 'UsingMods');
        }

        if (homeState.filterTags?.length > 0) {
            filtered = filtered.filter(c =>
                c.tags && homeState.filterTags.every(filterTag =>
                    c.tags.some(creationTag => creationTag.toLowerCase() === filterTag.toLowerCase())
                )
            );
        }

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

        const term = homeState.searchTerm.trim();
        let results;
        if (term && fuse) {
            // Fuse liefert relevanz-sortierte Treffer über den ganzen Index;
            // hier auf die vorgefilterte Menge einschränken, Ranking beibehalten
            const allowed = new Map(filtered.map(c => [c.id, c]));
            results = fuse.search(term)
                .filter(r => allowed.has(r.item.id))
                .map(r => allowed.get(r.item.id));
        } else {
            results = [...filtered];
        }

        switch (homeState.sortBy) {
            case 'likes':
                results.sort((a, b) => (b.likes || 0) - (a.likes || 0));
                break;
            case 'likes_asc':
                results.sort((a, b) => (a.likes || 0) - (b.likes || 0));
                break;
            case 'createdAt_asc':
                results.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
                break;
            case 'recommended':
                // Mit Suchbegriff die Fuse-Relevanz beibehalten (wie bei 'createdAt')
                if (!term) {
                    results = rankCreations(results, {
                        dayKey: getDayKey(),
                        uid: user?.uid || null,
                        interestMap,
                        weights: getLocalFeedWeights() || globalFeedWeights || DEFAULT_WEIGHTS,
                        // Admin-Debug: Badge auf jeder Karte zeigt Pool + Score
                        debug: userProfile?.role === 'admin',
                    });
                }
                break;
            case 'createdAt':
            default:
                // Mit Suchbegriff die Fuse-Relevanz beibehalten, sonst neueste zuerst
                if (!term) {
                    results.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
                }
                break;
        }

        return results;
    }, [shouldUseIndexSearch, indexCreations, fuse, homeState.searchTerm, homeState.filterTags, homeState.activeCategory, homeState.platformFilter, homeState.showModsOnly, homeState.sortBy, activeTab, dlcFilterMode, selectedDlcs, userProfile, user, interestMap, globalFeedWeights]);

    const indexHasMore = shouldUseIndexSearch && visibleCount < indexSearchResults.length;

    const showMoreIndexResults = useCallback(() => {
        setVisibleCount(prev => (prev < indexSearchResults.length ? prev + 24 : prev));
    }, [indexSearchResults.length]);

    // Scroll handler for infinite loading
    useEffect(() => {
        const handleScroll = () => {
            const isBottom = window.innerHeight + document.documentElement.scrollTop + 1 >= document.documentElement.offsetHeight;
            if (isBottom) {
                // Client-seitige Pagination im Suchmodus, sonst Firestore
                if (shouldUseIndexSearch) {
                    showMoreIndexResults();
                } else {
                    fetchMoreCreations();
                }
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [fetchMoreCreations, showMoreIndexResults, shouldUseIndexSearch]);

    const filteredCreations = useMemo(() => {
        // Suchmodus: Ergebnisse kommen fertig gefiltert/sortiert aus dem Index,
        // hier nur noch die client-seitige Pagination anwenden
        if (shouldUseIndexSearch) {
            return indexSearchResults.slice(0, visibleCount);
        }

        // Standard Firestore mode - some filters still client-side
        // Note: game, category, platform, and single tag are now server-side
        let filtered = [...creations];

        // DLC filter - still client-side
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

        // Mod filter - still client-side
        // (Textsuche und Mehrfach-Tags landen nie hier — die laufen über den Suchindex)
        if (!homeState.showModsOnly) {
            filtered = filtered.filter(c => c.modStatus !== 'UsingMods');
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
            case 'recommended': // läuft über den Index-Pfad; hier nur defensiv
            case 'createdAt':
            default:
                break;
        }

        return filtered;
    }, [homeState, creations, activeTab, selectedDlcs, dlcFilterMode, userProfile, shouldUseIndexSearch, indexSearchResults, visibleCount]);



    useEffect(() => {
        const savedPreference = userProfile?.platformPreferences?.[activeTab];
        if (savedPreference) {
            setHomeState(prev => ({ ...prev, platformFilter: savedPreference }));
        } else {
            setHomeState(prev => ({ ...prev, platformFilter: 'pc' }));
        }
    }, [activeTab, userProfile, setHomeState]);

    const handleDlcChange = useCallback((dlcName) => {
        setDlcFilterMode('custom');
        setSelectedDlcs(prev => prev.includes(dlcName) ? prev.filter(d => d !== dlcName) : [...prev, dlcName]);
    }, []);

    const handleSelectOwned = useCallback(() => {
        setDlcFilterMode('owned');
        setSelectedDlcs(userProfile?.ownedDlcs?.[activeTab] || []);
    }, [userProfile?.ownedDlcs, activeTab]);

    const handleSelectAll = useCallback(() => {
        setDlcFilterMode('all');
        setSelectedDlcs([]);
    }, []);

    // Filter tag suggestions based on input and exclude already selected tags
    const filteredTagSuggestions = useMemo(() => {
        const input = (homeState.filterTagInput || '').toLowerCase().trim();
        const selectedTagsLower = (homeState.filterTags || []).map(t => t.toLowerCase());

        return availableTags
            .filter(tag => {
                const tagLower = tag.toLowerCase();
                // Exclude already selected tags
                if (selectedTagsLower.includes(tagLower)) return false;
                // If no input, show top suggestions
                if (!input) return true;
                // Filter by input
                return tagLower.includes(input);
            })
            .slice(0, 9); // Limit to 9 suggestions (max 3 rows)
    }, [availableTags, homeState.filterTagInput, homeState.filterTags]);

    // Optimierte Handler für UI-Interaktionen
    const handleCategoryClick = useCallback((cat) => {
        setHomeState(prev => ({ ...prev, activeCategory: cat }));
    }, [setHomeState]);

    const handleSearchChange = useCallback((e) => {
        setHomeState(prev => ({ ...prev, searchTerm: e.target.value }));
    }, [setHomeState]);

    const handleClearSearch = useCallback(() => {
        setHomeState(prev => ({ ...prev, searchTerm: '' }));
    }, [setHomeState]);

    const handleSortChange = useCallback((e) => {
        setHomeState(prev => ({ ...prev, sortBy: e.target.value }));
    }, [setHomeState]);

    const handleTagInputChange = useCallback((e) => {
        setHomeState(prev => ({ ...prev, filterTagInput: e.target.value }));
    }, [setHomeState]);

    const handleClearTagInput = useCallback(() => {
        setHomeState(prev => ({ ...prev, filterTagInput: '' }));
    }, [setHomeState]);

    const handlePlatformToggle = useCallback(() => {
        setHomeState(prev => ({
            ...prev,
            platformFilter: prev.platformFilter === 'pc' ? 'console' : 'pc'
        }));
    }, [setHomeState]);

    const handleModsToggle = useCallback(() => {
        setHomeState(prev => ({ ...prev, showModsOnly: !prev.showModsOnly }));
    }, [setHomeState]);

    const handleFilterToggle = useCallback(() => {
        setIsFilterVisible(prev => !prev);
    }, []);

    const handleDlcFilterToggle = useCallback(() => {
        setIsDlcFilterVisible(prev => !prev);
    }, []);

    return (
        <div className="container mx-auto p-4">
            <div className="flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                    <div ref={gliderRef} className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} />
                    {TABS.map((tab, index) => (
                        <button
                            key={tab.id}
                            ref={el => tabRefs.current[index] = el}
                            onClick={() => handleTabClick(tab.id)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium ${activeTab === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className={`transition-opacity duration-300 ${isPending ? 'opacity-50' : 'opacity-100'}`}>
                <div className="flex justify-center mb-6">
                    <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                        <div ref={categoryGliderRef} className="absolute h-full rounded-full bg-white transition-all duration-500 ease-in-out shadow" />
                        {categories.map((cat, index) => (
                            <button
                                key={cat}
                                ref={el => categoryTabRefs.current[index] = el}
                                onClick={() => handleCategoryClick(cat)}
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
                            <input type="text" placeholder="Search for creations or users" value={homeState.searchTerm} onChange={handleSearchChange} className={`w-full p-3 pl-10 pr-10 bg-gray-200 rounded-full focus:outline-none focus:ring-2 ${color.ring}`} />
                            <Icon path={ICONS.search} className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            {homeState.searchTerm && (<button onClick={handleClearSearch} className="absolute z-10 right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-300/50 transition-colors" aria-label="Clear search"><span className={`text-2xl font-bold ${color.text} pb-1`}>×</span></button>)}
                        </div>
                        <div className="relative" ref={filterMenuRef}>
                            <button onClick={handleFilterToggle} className={`p-3 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors duration-300 ${isFilterActive ? `${color.bg} text-white` : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}><Icon path={ICONS.filter} className="w-6 h-6" /></button>
                            {isFilterVisible && (
                                <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl p-4 z-20">
                                    <h4 className="font-bold mb-2">Sort & Filter</h4>
                                    <label className="block text-sm font-medium text-gray-700">Sort by</label>
                                    <select value={homeState.sortBy} onChange={handleSortChange} className={`mt-1 block w-full p-2 border-gray-300 rounded-md shadow-sm focus:ring-2 ${color.ring} focus:border-blue-500`}><option value="recommended">Recommended</option><option value="createdAt">Newest First</option><option value="likes">Most Popular</option><option value="createdAt_asc">Oldest First</option><option value="likes_asc">Least Popular</option></select>
                                    <label className="block text-sm font-medium text-gray-700 mt-4">Filter by Tag</label>
                                    <div className="relative mt-1">
                                        <input type="text" placeholder="Type a tag and press Enter" value={homeState.filterTagInput || ''} onChange={handleTagInputChange} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(homeState.filterTagInput); } }} className={`block w-full p-2 pr-8 border-gray-300 rounded-md shadow-sm focus:ring-2 ${color.ring} focus:border-blue-500`} />
                                        {(homeState.filterTagInput || '').trim() && (<button onClick={handleClearTagInput} className="absolute z-10 right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors" aria-label="Clear tag filter"><span className={`text-xl font-bold ${color.text} pb-1`}>×</span></button>)}
                                    </div>
                                    {filteredTagSuggestions.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2 max-h-[5.25rem] overflow-hidden">
                                            {filteredTagSuggestions.map(tag => (
                                                <button
                                                    key={tag}
                                                    onClick={() => handleAddTag(tag)}
                                                    className="text-xs bg-gray-200 px-2 py-1 rounded-full hover:bg-gray-300 transition-colors cursor-pointer"
                                                >
                                                    {tag}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {homeState.filterTags && homeState.filterTags.length > 0 && (<div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200">{homeState.filterTags.map(tag => (<span key={tag} className="flex items-center bg-gray-200 text-gray-700 text-sm font-medium pl-3 pr-2 py-1 rounded-full">{tag}<button onClick={() => handleRemoveTag(tag)} className="ml-2 -mr-1 text-gray-400 hover:text-gray-700 rounded-full" aria-label={`Remove ${tag} filter`}><span className="text-md font-bold">×</span></button></span>))}</div>)}
                                </div>
                            )}
                        </div>
                        <div className="relative" ref={dlcMenuRef}>
                            <button onClick={handleDlcFilterToggle} className="bg-gray-200 p-3 rounded-full hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 font-semibold">DLC</button>
                            {isDlcFilterVisible && (
                                <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl p-4 z-20">
                                    <h4 className="font-bold mb-3 border-b pb-2">Filter by DLC</h4>
                                    <div className="space-y-2 max-h-64 overflow-y-auto">
                                        <label className="flex items-center text-gray-800 font-semibold"><input type="radio" name="dlcFilter" checked={dlcFilterMode === 'all'} onChange={handleSelectAll} className="h-4 w-4 text-blue-600 focus:ring-blue-500"/><span className="ml-2">Show All (Default)</span></label>
                                        {user && (<label className="flex items-center text-gray-800 font-semibold"><input type="radio" name="dlcFilter" checked={dlcFilterMode === 'owned'} onChange={handleSelectOwned} className="h-4 w-4 text-blue-600 focus:ring-blue-500"/><span className="ml-2">Creations I Can Use</span></label>)}
                                        <hr className="my-2"/>
                                        {gameDlcs.map(dlc => (<label key={dlc} className="flex items-center text-gray-700"><input type="checkbox" checked={selectedDlcs.includes(dlc)} onChange={() => handleDlcChange(dlc)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/><span className="ml-2">{dlc}</span></label>))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    {(activeTab === 'planet-coaster' || activeTab === 'planet-zoo') && (
                        <div className="flex items-center justify-center gap-4 md:mt-0">
                            <div className="flex items-center space-x-2"><span className={`text-sm font-medium transition-colors ${homeState.platformFilter === 'console' ? 'text-gray-400' : 'text-blue-600'}`}>PC</span><div onClick={handlePlatformToggle} className={`relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 ${homeState.platformFilter === 'pc' ? 'bg-blue-500' : 'bg-green-500'}`}><div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${homeState.platformFilter === 'pc' ? 'translate-x-0' : 'translate-x-6'}`}></div></div><span className={`text-sm font-medium transition-colors ${homeState.platformFilter === 'pc' ? 'text-gray-400' : 'text-green-600'}`}>Console</span></div>
                            <div className="flex items-center space-x-2"><span className={`text-sm font-medium transition-colors ${homeState.showModsOnly ? 'text-green-600' : 'text-gray-500'}`}>Show Modded</span><div onClick={handleModsToggle} className={`relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 ${homeState.showModsOnly ? 'bg-green-500' : 'bg-gray-300'}`}><div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${homeState.showModsOnly ? 'translate-x-6' : 'translate-x-0'}`}></div></div></div>
                        </div>
                    )}
                </div>

                {loading ? <Spinner gameId={activeTab} /> : (
                    <>
                        {(isSearching || (shouldUseIndexSearch && indexLoading)) && (<div className="mb-8 text-center"><Spinner /></div>)}
                        {!isSearching && userSearchResults.length > 0 && (
                            <div className="mb-8">
                                <h2 className="text-2xl font-bold mb-4 text-gray-800">Users Found</h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">{userSearchResults.map(userResult => (<UserSearchResultCard key={userResult.id} user={userResult} />))}</div>
                            </div>
                        )}
                        <div className="mb-8">
                            {(homeState.searchTerm.trim() || (homeState.filterTags?.length > 0)) && <h2 className="text-2xl font-bold mb-4 text-gray-800">Creations Found</h2>}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">{filteredCreations.map(creation => (<CreationCard key={creation.id} creation={creation} onTagClick={handleAddTag}/>))}</div>
                            {loadingMore && <div className="text-center p-8 col-span-full"><Spinner/></div>}
                            {shouldUseIndexSearch && !indexHasMore && indexSearchResults.length > 0 && (<p className="text-center text-gray-500 mt-10 text-xl col-span-full">You've reached the end!</p>)}
                            {!shouldUseIndexSearch && !hasMore && creations.length > 0 && (<p className="text-center text-gray-500 mt-10 text-xl col-span-full">You've reached the end!</p>)}
                            {!loading && !(shouldUseIndexSearch && indexLoading) && filteredCreations.length === 0 && (<p className="text-center text-gray-500 mt-10 text-xl">No creations found. Try a different search!</p>)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default HomePage;