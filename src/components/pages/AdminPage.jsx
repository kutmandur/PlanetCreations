import React, { useState, useEffect, useMemo, useRef, useTransition } from 'react';
import { useLocation } from 'react-router-dom';
import { db, auth } from '../../firebase/config';
import { doc, getDoc, updateDoc, onSnapshot, collection, getDocs, writeBatch, arrayUnion, setDoc, arrayRemove, query, where, getCountFromServer, orderBy, serverTimestamp, deleteField, FieldPath } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAppCheckTokenIfAvailable } from '../../firebase/appCheck';
import { getGameColor } from '../../utils/helpers';
import { getGames, getDefaultGameId, saveGamesRegistry } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import { DEFAULT_WEIGHTS, WEIGHT_KEYS } from '../../utils/feedRanking';
import FeedWeightSliders from '../ui/FeedWeightSliders';
import GamesManager from '../management/GamesManager';
import Spinner from '../ui/Spinner';
import ApplicationCard from '../cards/ApplicationCard';
import PillTabs from '../ui/PillTabs';

const DLC_SEED_DATA = Object.freeze({
    'planet-coaster': [
        'Adventure Pack', 'Classic Rides Collection', 'Magnificent Rides Collection',
        'World\'s Fair Pack', 'Vintage Pack', 'Studios Pack', 'Spooky Pack',
        'Ghostbusters™', 'Knight Rider™ K.I.T.T. Construction Kit',
        'Back to the Future™ Time Machine Construction Kit',
        'The Munsters® Munster Koach Construction Kit',
    ].map(name => ({ name, bit: null, identifiers: [] })),
    'planet-coaster-2': [
        ['Bonus Ride Collection', 1, ['PDLC_1']],
        ['Vintage Funfair Ride Pack', 2, ['PDLC_2']],
        ['Thrill-Seekers Ride Pack', 3, ['ContentPDLC1', 'Filter_PDLC_ThrillSeekersRidePack']],
        ['Sorcery Pack', 4, ['ContentPDLC2', 'Filter_PDLC_Sorcery']],
        ['Toybox Pack', 5, ['ContentPDLC3', 'Filter_PDLC_Toybox']],
        ['Parades Pack', 6, ['ContentPDLC4', 'Filter_PDLC_ParadesArcades']],
        ['Silver Screen Pack', 7, ['ContentPDLC5']],
    ].map(([name, bit, identifiers]) => ({ name, bit, identifiers })),
    'planet-zoo': [
        ['Deluxe Upgrade Pack', 0, 'Deluxe'],
        ['Arctic Pack', 1, 'Content1'],
        ['South America Pack', 2, 'Content2'],
        ['Australia Pack', 3, 'Content3'],
        ['Aquatic Pack', 4, 'Content4'],
        ['Southeast Asia Animal Pack', 5, 'Content5'],
        ['Africa Pack', 6, 'Content6'],
        ['North America Animal Pack', 7, 'Content7'],
        ['Europe Pack', 8, 'Content8'],
        ['Wetlands Animal Pack', 9, 'Content9'],
        ['Conservation Pack', 10, 'Content10'],
        ['Twilight Pack', 11, 'Content11'],
        ['Grasslands Animal Pack', 12, 'Content12'],
        ['Tropical Pack', 13, 'Content13'],
        ['Arid Animal Pack', 14, 'Content14'],
        ['Oceania Pack', 15, 'Content15'],
        ['Eurasia Animal Pack', 16, 'Content16'],
        ['Barnyard Animal Pack', 17, 'Content17'],
        ['Zookeepers Animal Pack', 18, 'Content18'],
        ['Americas Animal Pack', 19, 'Content19'],
        ['Asia Animal Pack', 20, 'Content20'],
    ].map(([name, bit, identifier]) => ({ name, bit, identifiers: [identifier] })),
});

const defaultDlcMapping = (gameId, name) => {
    const entry = (DLC_SEED_DATA[gameId] || []).find(item => item.name === name);
    return entry ? { bit: entry.bit, identifiers: entry.identifiers } :
        { bit: null, identifiers: [] };
};

const mappingDraft = mapping => ({
    bit: Number.isSafeInteger(mapping?.bit) ? String(mapping.bit) : '',
    identifiers: Array.isArray(mapping?.identifiers) ? mapping.identifiers.join(', ') : '',
});

const StatCard = ({ title, value, colorClass = 'bg-blue-500', style }) => (
    <div className={`p-6 rounded-lg shadow-lg text-white ${colorClass}`} style={style}>
        <h4 className="text-lg font-semibold text-blue-100">{title}</h4>
        <p className="text-4xl font-bold mt-2">{value}</p>
    </div>
);

const ADMIN_TABS = ['User Management', 'Games & Data', 'Startpage', 'Bug Reports', 'Site Statistics'];
const USER_MANAGEMENT_TABS = ['All Users', 'Applications', 'Influencers', 'Email Export'];
const STARTPAGE_TABS = ['Search Indexes', 'Feed'];

const ADMIN_ROUTE_TARGETS = Object.freeze({
    'user-management': { tab: 'User Management', section: 'All Users' },
    users: { tab: 'User Management', section: 'All Users' },
    influencer: { tab: 'User Management', section: 'Applications' },
    'email-users': { tab: 'User Management', section: 'Email Export' },
    games: { tab: 'Games & Data' },
    'data-management': { tab: 'Games & Data' },
    'games-data': { tab: 'Games & Data' },
    indexes: { tab: 'Startpage', section: 'Search Indexes' },
    feed: { tab: 'Startpage', section: 'Feed' },
    startpage: { tab: 'Startpage', section: 'Search Indexes' },
    'bug-reports': { tab: 'Bug Reports' },
    'site-statistics': { tab: 'Site Statistics' },
    statistics: { tab: 'Site Statistics' },
});

const ADMIN_SECTION_TARGETS = Object.freeze({
    'User Management': {
        users: 'All Users',
        applications: 'Applications',
        influencers: 'Influencers',
        email: 'Email Export',
    },
    Startpage: {
        indexes: 'Search Indexes',
        feed: 'Feed',
    },
});

const AdminPage = ({ setPopoverView, setModalMessage, setPasswordConfirm }) => {
    const TABS = ADMIN_TABS;
    const [activeTab, setActiveTab] = useState(TABS[0]);
    const [feedWeights, setFeedWeights] = useState(null);
    const [feedWeightsDirty, setFeedWeightsDirty] = useState(false);
    const [savingFeedWeights, setSavingFeedWeights] = useState(false);
    const location = useLocation();

    const [userSubTab, setUserSubTab] = useState('All Users');
    const [startpageSubTab, setStartpageSubTab] = useState('Search Indexes');
    const [addGameOpen, setAddGameOpen] = useState(false);
    const [reorderingGames, setReorderingGames] = useState(false);

    // Keep both the consolidated routes and the previous tab links working.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tabSlug = params.get('tab');
        if (!tabSlug) return;
        const target = ADMIN_ROUTE_TARGETS[tabSlug];
        if (!target) return;

        setActiveTab(target.tab);
        const requestedSection = ADMIN_SECTION_TARGETS[target.tab]?.[params.get('section')];
        const section = requestedSection || target.section;
        if (target.tab === 'User Management' && section) setUserSubTab(section);
        if (target.tab === 'Startpage' && section) setStartpageSubTab(section);
    }, [location.search]);

    const [selectedGame, setSelectedGame] = useState(() => getGames({ includeDisabled: true })[0]?.id || getDefaultGameId());
    const [newCategory, setNewCategory] = useState('');
    const [categories, setCategories] = useState([]);
    const [loadingCategories, setLoadingCategories] = useState(false);
    
    const [newDlc, setNewDlc] = useState('');
    const [dlcs, setDlcs] = useState([]);
    const [dlcMappingDrafts, setDlcMappingDrafts] = useState({});
    const [savingDlcName, setSavingDlcName] = useState(null);
    const [loadingDlcs, setLoadingDlcs] = useState(false);
    const [seedingDlcs, setSeedingDlcs] = useState(false);

    // Indexes-Tab
    const [rebuildingIndex, setRebuildingIndex] = useState(null); // 'general' | communityId | null
    const [indexSubTab, setIndexSubTab] = useState('General');
    const [gameIndexes, setGameIndexes] = useState([]);
    const [communityIndexes, setCommunityIndexes] = useState([]);
    const [otherIndexes, setOtherIndexes] = useState([]);
    const [loadingIndexes, setLoadingIndexes] = useState(false);

    // Bug-Reports-Tab
    const [bugReports, setBugReports] = useState([]);
    const [bugSubTab, setBugSubTab] = useState('Open');
    const [loadingBugs, setLoadingBugs] = useState(true);

    // Influencer management inside User Management
    const [influencers, setInfluencers] = useState([]);
    const [loadingInfluencers, setLoadingInfluencers] = useState(true);

    const gameTabRefs = useRef([]);
    const gameGliderRef = useRef(null);
    const color = getGameColor(selectedGame);

    const [users, setUsers] = useState([]);
    const [applications, setApplications] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    
    const [stats, setStats] = useState(null);
    const [loadingStats, setLoadingStats] = useState(true);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isPending, startTransition] = useTransition();

    // Datenpflege auch für deaktivierte Spiele möglich
    const GAME_TABS = useGames({ includeDisabled: true });
    const selectedGameIndex = GAME_TABS.findIndex(game => game.id === selectedGame);

    const handleMoveSelectedGame = async direction => {
        const targetIndex = selectedGameIndex + direction;
        if (selectedGameIndex < 0 || targetIndex < 0 || targetIndex >= GAME_TABS.length) return;

        const reorderedGames = [...GAME_TABS];
        [reorderedGames[selectedGameIndex], reorderedGames[targetIndex]] = [
            reorderedGames[targetIndex],
            reorderedGames[selectedGameIndex],
        ];

        setReorderingGames(true);
        try {
            await saveGamesRegistry({
                games: reorderedGames.map((game, index) => ({ ...game, order: index })),
                defaultGameId: getDefaultGameId(),
            });
        } catch (error) {
            setModalMessage(`Error reordering games: ${error.message}`);
        } finally {
            setReorderingGames(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'Games & Data') {
            const gameTabIndex = GAME_TABS.findIndex(tab => tab.id === selectedGame);
            const gameTabNode = gameTabRefs.current[gameTabIndex];
            if (gameTabNode && gameGliderRef.current) {
                gameGliderRef.current.style.left = `${gameTabNode.offsetLeft}px`;
                gameGliderRef.current.style.width = `${gameTabNode.offsetWidth}px`;
            }
        }
    }, [selectedGame, activeTab, GAME_TABS]);

    useEffect(() => {
        if (GAME_TABS.length > 0 && !GAME_TABS.some(game => game.id === selectedGame)) {
            setSelectedGame(GAME_TABS[0].id);
        }
    }, [GAME_TABS, selectedGame]);

    useEffect(() => {
        if (activeTab !== 'User Management' || userSubTab !== 'All Users') return;
        let isMounted = true;
        setLoadingUsers(true);
        const usersQuery = collection(db, 'users');
        const profilesQuery = collection(db, 'profiles');
        const unsubUsers = onSnapshot(usersQuery, async (usersSnapshot) => {
            const profilesSnapshot = await getDocs(profilesQuery);
            const profilesMap = new Map(profilesSnapshot.docs.map(doc => [doc.id, doc.data()]));
            const usersData = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), ...profilesMap.get(doc.id) }));
            if (isMounted) { setUsers(usersData); setLoadingUsers(false); }
        });
        return () => { isMounted = false; unsubUsers(); };
    }, [activeTab, userSubTab]);

    // Influencer-Tab: offene Bewerbungen + Liste aller Influencer
    useEffect(() => {
        if (activeTab !== 'User Management') return;
        let isMounted = true;
        setLoadingInfluencers(true);
        const unsubApps = onSnapshot(collection(db, 'applications'), (snapshot) => {
            if (isMounted) setApplications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        const influencersQuery = query(collection(db, 'users'), where('role', '==', 'influencer'));
        const unsubInfluencers = onSnapshot(influencersQuery, async (snapshot) => {
            const withProfiles = await Promise.all(snapshot.docs.map(async (userDoc) => {
                const profileSnap = await getDoc(doc(db, 'profiles', userDoc.id));
                return { id: userDoc.id, ...userDoc.data(), ...(profileSnap.exists() ? profileSnap.data() : {}) };
            }));
            if (isMounted) { setInfluencers(withProfiles); setLoadingInfluencers(false); }
        });
        return () => { isMounted = false; unsubApps(); unsubInfluencers(); };
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'Games & Data') return;
        let isMounted = true;
        setLoadingCategories(true);
        const catRef = doc(db, 'categories', selectedGame);
        const unsubscribe = onSnapshot(catRef, (docSnap) => {
            if (isMounted) {
                setCategories(docSnap.exists() ? docSnap.data().names || [] : []);
                setLoadingCategories(false);
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [selectedGame, activeTab]);

    useEffect(() => {
        if (activeTab !== 'Games & Data') return;
        let isMounted = true;
        setLoadingDlcs(true);
        const dlcRef = doc(db, 'dlcs', selectedGame);
        const unsubscribe = onSnapshot(dlcRef, (docSnap) => {
            if (isMounted) {
                const data = docSnap.exists() ? docSnap.data() : {};
                const names = Array.isArray(data.names) ? data.names : [];
                const mappings = data.saveMappings && typeof data.saveMappings === 'object' ?
                    data.saveMappings : {};
                setDlcs(names);
                setDlcMappingDrafts(Object.fromEntries(names.map(name => [
                    name,
                    mappingDraft(mappings[name] || defaultDlcMapping(selectedGame, name)),
                ])));
                setLoadingDlcs(false);
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [selectedGame, activeTab]);

    useEffect(() => {
        if (activeTab !== 'Site Statistics') return;
        let isMounted = true;
        const fetchStats = async () => {
            setLoadingStats(true);
            try {
                const usersCol = collection(db, 'users');
                const creationsCol = collection(db, 'creations');
                const communitiesCol = collection(db, 'communitys');
                const statGames = getGames({ includeDisabled: true });
                const [usersSnapshot, creationsSnapshot, communitiesSnapshot, ...gameSnapshots] = await Promise.all([
                    getCountFromServer(usersCol), getCountFromServer(creationsCol), getCountFromServer(communitiesCol),
                    ...statGames.map(g => getCountFromServer(query(creationsCol, where('game', '==', g.id)))),
                ]);
                if (isMounted) {
                    const creationsByGame = {};
                    statGames.forEach((g, i) => { creationsByGame[g.id] = gameSnapshots[i].data().count; });
                    setStats({
                        totalUsers: usersSnapshot.data().count,
                        totalCreations: creationsSnapshot.data().count,
                        totalCommunities: communitiesSnapshot.data().count,
                        creationsByGame,
                    });
                }
            } catch (error) {
                if(isMounted) setModalMessage("Could not load site statistics.");
            } finally {
                if(isMounted) setLoadingStats(false);
            }
        };
        fetchStats();
        return () => { isMounted = false; };
    }, [activeTab, setModalMessage]);

    const handleProfileClick = (userId) => {
        startTransition(() => {
            setPopoverView({ name: 'profile', userId: userId });
        });
    };

    const handleCopy = (text, label = 'Value') => {
        navigator.clipboard.writeText(text)
            .then(() => setModalMessage(`${label} copied to clipboard!`))
            .catch(() => setModalMessage('Could not copy to clipboard.'));
    };

    const handleRoleChange = async (userId, newRole) => {
        // Rollenänderung ist ein Privileg-Wechsel → Passwort-Bestätigung + Feedback
        // (vorher: stiller, ungeprüfter Write ohne Fehlerbehandlung).
        setPasswordConfirm({
            message: `Change this user's role to "${newRole}"? Please confirm with your password.`,
            onConfirm: async (password) => {
                try {
                    const u = auth.currentUser;
                    const credential = EmailAuthProvider.credential(u.email, password);
                    await reauthenticateWithCredential(u, credential);
                    const batch = writeBatch(db);
                    batch.update(doc(db, 'users', userId), { role: newRole });
                    batch.update(doc(db, 'profiles', userId), { role: newRole });
                    await batch.commit();
                    setModalMessage(`Role updated to "${newRole}".`);
                } catch (error) {
                    setModalMessage(`Error updating role: ${error.message}`);
                }
            }
        });
    };

    const handleApplication = async (applicationId, accepted) => {
        setPasswordConfirm({
            message: `To ${accepted ? 'accept' : 'deny'} this application, please confirm with your password.`,
            onConfirm: async (password) => {
                const user = auth.currentUser;
                try {
                    const credential = EmailAuthProvider.credential(user.email, password);
                    await reauthenticateWithCredential(user, credential);
                    const batch = writeBatch(db);
                    if (accepted) {
                        // Bewerbungsdaten am User-Doc sichern, damit der
                        // Users-Untertab sie nach dem Löschen der Bewerbung noch hat
                        const application = applications.find(a => a.id === applicationId);
                        const { id, appliedAt, ...applicationInfo } = application || {};
                        batch.update(doc(db, 'users', applicationId), {
                            role: 'influencer',
                            influencerInfo: { ...applicationInfo, acceptedAt: serverTimestamp() },
                        });
                        batch.update(doc(db, 'profiles', applicationId), { role: 'influencer' });
                    }
                    batch.delete(doc(db, 'applications', applicationId));
                    await batch.commit();
                    setModalMessage(`Application ${accepted ? 'accepted' : 'denied'} successfully.`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const handleAddCategory = async () => {
        if (!newCategory.trim()) return;
        setLoadingCategories(true);
        try {
            await setDoc(doc(db, 'categories', selectedGame), { names: arrayUnion(newCategory.trim()) }, { merge: true });
            setNewCategory('');
        } catch (error) {
            setModalMessage(`Error adding category: ${error.message}`);
        } finally {
            setLoadingCategories(false);
        }
    };

    const handleDeleteCategory = async (categoryToDelete) => {
        setLoadingCategories(true);
        try {
            await updateDoc(doc(db, 'categories', selectedGame), { names: arrayRemove(categoryToDelete) });
        } catch (error) {
            setModalMessage(`Error deleting category: ${error.message}`);
        } finally {
            setLoadingCategories(false);
        }
    };

    const handleAddDlc = async () => {
        const name = newDlc.trim();
        if (!name) return;
        setLoadingDlcs(true);
        try {
            await setDoc(doc(db, 'dlcs', selectedGame), {
                names: arrayUnion(name),
                saveMappings: {
                    [name]: { bit: null, identifiers: [] },
                },
                catalogVersion: Date.now(),
            }, { merge: true });
            setNewDlc('');
        } catch (error) {
            setModalMessage(`Error adding DLC: ${error.message}`);
        } finally {
            setLoadingDlcs(false);
        }
    };

    const handleDeleteDlc = async (dlcToDelete) => {
        setLoadingDlcs(true);
        try {
            await updateDoc(
                doc(db, 'dlcs', selectedGame),
                'names', arrayRemove(dlcToDelete),
                new FieldPath('saveMappings', dlcToDelete), deleteField(),
                'catalogVersion', Date.now(),
            );
        } catch (error) {
            setModalMessage(`Error deleting DLC: ${error.message}`);
        } finally {
            setLoadingDlcs(false);
        }
    };

    const handleDlcMappingDraftChange = (dlcName, field, value) => {
        setDlcMappingDrafts(current => ({
            ...current,
            [dlcName]: { ...(current[dlcName] || mappingDraft()), [field]: value },
        }));
    };

    const handleSaveDlcMapping = async dlcName => {
        const draft = dlcMappingDrafts[dlcName] || mappingDraft();
        const bitText = draft.bit.trim();
        const bit = bitText === '' ? null : Number(bitText);
        if (bit !== null && (!Number.isSafeInteger(bit) || bit < 0 || bit > 52)) {
            setModalMessage('The save bit must be a whole number between 0 and 52.');
            return;
        }
        const identifiers = [...new Set(draft.identifiers.split(/[,\n]/)
            .map(value => value.trim())
            .filter(Boolean))].slice(0, 20);
        setSavingDlcName(dlcName);
        try {
            await updateDoc(
                doc(db, 'dlcs', selectedGame),
                new FieldPath('saveMappings', dlcName), { bit, identifiers },
                'catalogVersion', Date.now(),
            );
        } catch (error) {
            setModalMessage(`Error saving DLC mapping: ${error.message}`);
        } finally {
            setSavingDlcName(null);
        }
    };

    const handleSeedDlcs = async () => {
        setSeedingDlcs(true);
        try {
            const games = Object.keys(DLC_SEED_DATA);
            const snapshots = await Promise.all(games.map(game => getDoc(doc(db, 'dlcs', game))));
            const batch = writeBatch(db);
            games.forEach((game, index) => {
                const existing = snapshots[index].exists() ? snapshots[index].data() : {};
                const defaults = DLC_SEED_DATA[game];
                const names = [...new Set([...(existing.names || []), ...defaults.map(entry => entry.name)])];
                const defaultMappings = Object.fromEntries(defaults.map(entry => [
                    entry.name,
                    { bit: entry.bit, identifiers: entry.identifiers },
                ]));
                const docRef = doc(db, 'dlcs', game);
                batch.set(docRef, {
                    names,
                    saveMappings: { ...defaultMappings, ...(existing.saveMappings || {}) },
                    catalogVersion: Date.now(),
                }, { merge: true });
            });
            await batch.commit();
            setModalMessage('Missing DLC defaults and save mappings were added. Existing entries were preserved.');
        } catch (error) {
            setModalMessage(`Error seeding DLCs: ${error.message}`);
        } finally {
            setSeedingDlcs(false);
        }
    };

    // Übersicht aller skalierbaren Inhaltsindexe und des Migrationsstatus laden.
    const loadIndexOverview = React.useCallback(async () => {
        setLoadingIndexes(true);
        try {
            const [
                gameSnap,
                communitySnap,
                communityIndexSnap,
                userIndexSnap,
                showcaseIndexSnap,
                youtubeIndexSnap,
            ] = await Promise.all([
                getDocs(collection(db, 'searchIndexState')),
                getDocs(collection(db, 'communitys')),
                getDocs(collection(db, 'communitySearchIndexState')),
                getDocs(collection(db, 'userSearchIndexState')),
                getDocs(collection(db, 'showcaseIndexState')),
                getDoc(doc(db, 'youtubeVideoIndexState', 'current')),
            ]);
            setGameIndexes(gameSnap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    count: data.count ?? 0,
                    shardCount: data.shardIds?.length || 0,
                    updatedAt: data.updatedAt || null,
                };
            }));
            const idxMap = new Map(communityIndexSnap.docs.map(d => {
                const data = d.data();
                return [d.id, {
                    count: data.count ?? 0,
                    shardCount: data.shardIds?.length || 0,
                    updatedAt: data.updatedAt || null,
                }];
            }));
            setCommunityIndexes(communitySnap.docs.map(d => {
                const c = d.data();
                const idx = idxMap.get(d.id);
                return {
                    id: d.id,
                    name: c.name || d.id,
                    bannerImageUrl: c.bannerImageUrl || null,
                    themeColor: c.themeColor || '#A855F7',
                    memberCount: c.memberCount || 0,
                    count: idx ? idx.count : null,
                    shardCount: idx ? idx.shardCount : 0,
                    updatedAt: idx ? idx.updatedAt : null,
                };
            }));
            const userState = userIndexSnap.docs.find(d => d.id === 'all')?.data();
            const showcaseStates = showcaseIndexSnap.docs.map(d => d.data());
            const youtubeState = youtubeIndexSnap.exists() ? youtubeIndexSnap.data() : null;
            setOtherIndexes([
                {
                    id: 'users',
                    label: 'User search',
                    count: userState?.count ?? null,
                    scopeCount: userState ? 1 : 0,
                    shardCount: userState?.shardIds?.length || 0,
                },
                {
                    id: 'showcases',
                    label: 'Showcases',
                    count: showcaseStates.reduce((sum, state) => sum + (state.count || 0), 0),
                    scopeCount: showcaseStates.length,
                    shardCount: showcaseStates.reduce((sum, state) =>
                        sum + (state.shardIds?.length || 0), 0),
                },
                {
                    id: 'youtube',
                    label: 'YouTube videos',
                    count: null,
                    scopeCount: youtubeState ? 1 : 0,
                    shardCount: youtubeState?.headNumber || 0,
                },
            ]);
        } catch (error) {
            setModalMessage(`Error loading index overview: ${error.message}`);
        } finally {
            setLoadingIndexes(false);
        }
    }, [setModalMessage]);

    useEffect(() => {
        if (activeTab === 'Startpage' && startpageSubTab === 'Search Indexes') loadIndexOverview();
    }, [activeTab, startpageSubTab, loadIndexOverview]);

    // Feed-Tab: globale Feed-Gewichte (meta/feedWeights) laden
    useEffect(() => {
        if (activeTab !== 'Startpage' || startpageSubTab !== 'Feed') return;
        let mounted = true;
        getDoc(doc(db, 'meta', 'feedWeights')).then((snap) => {
            if (mounted) setFeedWeights(snap.exists() ? { ...DEFAULT_WEIGHTS, ...snap.data() } : { ...DEFAULT_WEIGHTS });
        }).catch((e) => setModalMessage(`Error loading feed weights: ${e.message}`));
        return () => { mounted = false; };
    }, [activeTab, startpageSubTab, setModalMessage]);

    const handleSaveFeedWeights = async (weightsToSave) => {
        setSavingFeedWeights(true);
        try {
            const payload = {};
            WEIGHT_KEYS.forEach((key) => { payload[key] = Number(weightsToSave[key]) || 0; });
            await setDoc(doc(db, 'meta', 'feedWeights'), payload);
            setFeedWeights(payload);
            setFeedWeightsDirty(false);
            setModalMessage('Feed weights saved. Clients pick them up within ~30 minutes (cache).');
        } catch (e) {
            setModalMessage(`Error saving feed weights: ${e.message}`);
        } finally {
            setSavingFeedWeights(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'Bug Reports') return;
        setLoadingBugs(true);
        const bugsQuery = query(collection(db, 'bugReports'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(bugsQuery, (snapshot) => {
            setBugReports(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoadingBugs(false);
        }, (error) => {
            setModalMessage(`Error loading bug reports: ${error.message}`);
            setLoadingBugs(false);
        });
        return () => unsubscribe();
    }, [activeTab, setModalMessage]);

    const handleToggleBugStatus = async (report) => {
        const newStatus = report.status === 'open' ? 'closed' : 'open';
        try {
            await updateDoc(doc(db, 'bugReports', report.id), {
                status: newStatus,
                closedAt: newStatus === 'closed' ? serverTimestamp() : null,
            });
        } catch (error) {
            setModalMessage(`Error updating bug report: ${error.message}`);
        }
    };

    // scope: 'general' (Spiel-Indexe) | 'community' (einzelne Community) | 'all'
    const handleRebuildSearchIndex = async (scope = 'all', communityId = null) => {
        setRebuildingIndex(communityId || scope);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not logged in.");
            const [idToken, appCheckToken] = await Promise.all([
                user.getIdToken(true),
                getAppCheckTokenIfAvailable(),
            ]);
            const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ||
                'https://us-central1-planetcreationsdotnet.cloudfunctions.net/api';
            const params = new URLSearchParams({ scope });
            if (communityId) params.set('communityId', communityId);
            const response = await fetch(`${apiBaseUrl}/rebuildSearchIndex?${params}`, {
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    ...(appCheckToken ? {
                        'X-Firebase-AppCheck': appCheckToken,
                    } : {}),
                }
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            const parts = [
                ...Object.entries(result.counts || {}).map(([game, n]) => `${game}: ${n}`),
                ...Object.entries(result.communityCounts || {}).map(([id, n]) => `${n} entries`),
            ];
            setModalMessage(`Index rebuilt successfully. ${parts.join(', ')}${result.skipped ? ` (${result.skipped} skipped)` : ''}`);
            await loadIndexOverview();
        } catch (error) {
            setModalMessage(`Error rebuilding index: ${error.message}`);
        } finally {
            setRebuildingIndex(null);
        }
    };

    const handleGenerateEmailList = () => {
        setPasswordConfirm({
            message: "To generate the user email list, please confirm with your password.",
            onConfirm: async (password) => {
                const user = auth.currentUser;
                if (!user) return;
                
                try {
                    setIsGenerating(true);
                    const credential = EmailAuthProvider.credential(user.email, password);
                    await reauthenticateWithCredential(user, credential);
                    await auth.currentUser.getIdToken(true);

                    const functions = getFunctions();
                    const getAllUserEmails = httpsCallable(functions, 'getAllUserEmails');
                    const result = await getAllUserEmails();
                    
                    const emails = result.data.emails;
                    if (emails && emails.length > 0) {
                        const emailList = emails.join(', ');
                        await navigator.clipboard.writeText(emailList);
                        setModalMessage(`Successfully copied ${emails.length} email addresses to your clipboard.`);
                    } else {
                        setModalMessage("No user emails found.");
                    }

                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                } finally {
                    setIsGenerating(false);
                }
            }
        });
    };
    
    const filteredUsers = useMemo(() => users.filter(user => user.username?.toLowerCase().includes(searchTerm.toLowerCase())), [users, searchTerm]);
  
    const renderContent = () => {
        let selectedPanel = activeTab;
        if (activeTab === 'User Management') {
            selectedPanel = {
                'All Users': 'User Management',
                Applications: 'Influencer',
                Influencers: 'Influencer',
                'Email Export': 'Email Users',
            }[userSubTab];
        } else if (activeTab === 'Games & Data') {
            selectedPanel = 'Data Management';
        } else if (activeTab === 'Startpage') {
            selectedPanel = startpageSubTab === 'Search Indexes' ? 'Indexes' : 'Feed';
        }

        switch (selectedPanel) {
            case 'User Management':
                return (
                    <div className={`transition-opacity ${isPending ? 'opacity-50' : 'opacity-100'}`}>
                        <div>
                            <h2 className="text-2xl font-bold mb-4 text-center">All Users</h2>
                            <input type="text" placeholder="Search by username..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full max-w-md p-2 border rounded-lg mb-4 block mx-auto"/>
                            {loadingUsers ? <Spinner /> : (
                                <div className="overflow-x-auto bg-white rounded-lg shadow">
                                    <table className="min-w-full text-left text-sm">
                                        <thead className="border-b bg-gray-50">
                                            <tr>
                                                <th className="p-2 font-semibold">Username</th>
                                                <th className="p-2 font-semibold">Role</th>
                                                <th className="p-2 font-semibold">Joined</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUsers.map(user => (
                                                <tr key={user.id} className="border-b hover:bg-gray-50">
                                                    <td className="p-2">
                                                        <button onClick={() => handleProfileClick(user.id)} className="text-blue-500 hover:underline focus:outline-none font-semibold">{user.username || 'N/A'}</button>
                                                    </td>
                                                    <td className="p-2">
                                                        <select value={user.role} onChange={(e) => handleRoleChange(user.id, e.target.value)} className="p-1 border rounded-md bg-white">
                                                            <option value="user">User</option>
                                                            <option value="influencer">Influencer</option>
                                                            <option value="moderator">Moderator</option>
                                                            <option value="admin">Admin</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-2 text-gray-500">
                                                        {user.createdAt ? new Date(user.createdAt.seconds * 1000).toLocaleDateString() : 'N/A'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                );
            case 'Influencer':
                return (
                    <div className={`transition-opacity ${isPending ? 'opacity-50' : 'opacity-100'}`}>
                        {userSubTab === 'Applications' && (
                            applications.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {applications.map(app => <ApplicationCard key={app.id} application={app} onAccept={() => handleApplication(app.id, true)} onDeny={() => handleApplication(app.id, false)} onCopy={handleCopy} />)}
                                </div>
                            ) : <p className="text-center text-gray-500 py-10 bg-white rounded-lg shadow-md">No pending applications.</p>
                        )}

                        {userSubTab === 'Influencers' && (
                            loadingInfluencers ? <Spinner /> : influencers.length === 0 ? (
                                <p className="text-center text-gray-500 py-10 bg-white rounded-lg shadow-md">No influencers yet.</p>
                            ) : (
                                <div className="overflow-x-auto bg-white rounded-lg shadow">
                                    <table className="min-w-full text-left text-sm">
                                        <thead className="border-b bg-gray-50">
                                            <tr>
                                                <th className="p-3 font-semibold">Username</th>
                                                <th className="p-3 font-semibold">Platform</th>
                                                <th className="p-3 font-semibold">Channel</th>
                                                <th className="p-3 font-semibold">Community Size</th>
                                                <th className="p-3 font-semibold">Contact</th>
                                                <th className="p-3 font-semibold">Influencer since</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {influencers.map(inf => {
                                                const info = inf.influencerInfo || {};
                                                return (
                                                    <tr key={inf.id} className="border-b hover:bg-gray-50 align-top">
                                                        <td className="p-3">
                                                            <button onClick={() => handleProfileClick(inf.id)} className="text-blue-500 hover:underline focus:outline-none font-semibold">{inf.username || 'N/A'}</button>
                                                        </td>
                                                        <td className="p-3">{info.platform || '—'}</td>
                                                        <td className="p-3 max-w-[220px]">
                                                            {info.channelUrl ? (
                                                                <a href={info.channelUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block truncate" title={info.channelUrl}>
                                                                    {info.channelUrl.replace(/^https?:\/\/(www\.)?/, '')}
                                                                </a>
                                                            ) : '—'}
                                                        </td>
                                                        <td className="p-3">{typeof info.communitySize === 'number' ? info.communitySize.toLocaleString() : (info.communitySize || '—')}</td>
                                                        <td className="p-3">
                                                            {info.contactEmail && (
                                                                <button
                                                                    onClick={() => handleCopy(info.contactEmail, 'Email')}
                                                                    title={`Copy: ${info.contactEmail}`}
                                                                    className="block truncate max-w-[200px] text-left text-blue-600 hover:underline"
                                                                >
                                                                    {info.contactEmail}
                                                                </button>
                                                            )}
                                                            {info.discordContact && (
                                                                <button
                                                                    onClick={() => handleCopy(info.discordContact, 'Discord')}
                                                                    title={`Copy: ${info.discordContact}`}
                                                                    className="block truncate max-w-[200px] text-left text-gray-500 hover:text-blue-600 hover:underline"
                                                                >
                                                                    Discord: {info.discordContact}
                                                                </button>
                                                            )}
                                                            {!info.contactEmail && !info.discordContact && '—'}
                                                        </td>
                                                        <td className="p-3 text-gray-500 whitespace-nowrap">
                                                            {info.acceptedAt?.seconds ? new Date(info.acceptedAt.seconds * 1000).toLocaleDateString() : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}
                    </div>
                );
            case 'Data Management':
                return (
                    <div style={color.style}>
                        <div className="relative flex justify-center my-6">
                            <div className="flex max-w-full items-center gap-2">
                                <div className="relative flex max-w-full items-center overflow-x-auto rounded-full bg-gray-200 p-1 shadow-inner">
                                    <div ref={gameGliderRef} className={`absolute inset-y-1 rounded-full ${color.bg} transition-all duration-500 ease-in-out`} />
                                    {GAME_TABS.map((tab, index) => (
                                        <button key={tab.id} ref={el => gameTabRefs.current[index] = el} onClick={() => setSelectedGame(tab.id)} className={`relative z-10 whitespace-nowrap rounded-full px-4 py-2 font-medium transition-colors duration-300 sm:px-6 ${selectedGame === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}>{tab.name}</button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleMoveSelectedGame(-1)}
                                    disabled={reorderingGames || selectedGameIndex <= 0}
                                    aria-label="Move selected game left"
                                    title="Move selected game left"
                                    className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-bold text-gray-600 shadow-sm transition hover:bg-gray-100 hover:text-black disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                    ←
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleMoveSelectedGame(1)}
                                    disabled={reorderingGames || selectedGameIndex < 0 || selectedGameIndex >= GAME_TABS.length - 1}
                                    aria-label="Move selected game right"
                                    title="Move selected game right"
                                    className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-bold text-gray-600 shadow-sm transition hover:bg-gray-100 hover:text-black disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                    →
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAddGameOpen(true)}
                                    aria-label="Add game"
                                    title="Add game"
                                    className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-2xl font-semibold leading-none text-white shadow-md transition hover:scale-105 hover:brightness-90 ${color.bg}`}
                                >
                                    +
                                </button>
                            </div>
                        </div>
                        <GamesManager
                            setModalMessage={setModalMessage}
                            selectedGameId={selectedGame}
                            onSelectedGameChange={setSelectedGame}
                            addGameOpen={addGameOpen}
                            onAddGameOpenChange={setAddGameOpen}
                        />
                        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
                            <div className="bg-white p-6 rounded-lg shadow-md">
                                <h3 className="text-xl font-bold mb-4">Manage Categories</h3>
                                <div className="flex space-x-2 mb-4">
                                    <input type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" className="flex-grow p-2 border rounded-lg" />
                                    <button onClick={handleAddCategory} disabled={loadingCategories} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-4 rounded-lg`}>Add</button>
                                </div>
                                <div className="max-h-96 overflow-y-auto">
                                    {loadingCategories ? <Spinner /> : categories.length > 0 ? categories.map(cat => (
                                        <div key={cat} className="flex justify-between items-center p-2 border-b"><span className="truncate">{cat}</span><button onClick={() => handleDeleteCategory(cat)} className="text-red-500 hover:text-red-700 ml-2">Delete</button></div>
                                    )) : <p className="text-sm text-gray-500">No categories found.</p>}
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-lg shadow-md lg:col-span-2">
                                <h3 className="text-xl font-bold mb-4">Manage DLCs</h3>
                                <p className="mb-4 text-sm text-gray-500">The workshop name is matched to Frontier save metadata through its numeric bit and optional internal identifiers. Changes are mirrored into the game index automatically.</p>
                                <div className="flex space-x-2 mb-4">
                                    <input type="text" value={newDlc} onChange={(e) => setNewDlc(e.target.value)} placeholder="New DLC name" className="flex-grow p-2 border rounded-lg" />
                                    <button onClick={handleAddDlc} disabled={loadingDlcs} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-4 rounded-lg`}>Add</button>
                                </div>
                                <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                                    {loadingDlcs ? <Spinner /> : dlcs.length > 0 ? dlcs.map(dlc => (
                                        <div key={dlc} className="rounded-xl border border-gray-200 p-3">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <span className="font-semibold text-gray-800">{dlc}</span>
                                                <button onClick={() => handleDeleteDlc(dlc)} className="text-sm text-red-500 hover:text-red-700">Delete</button>
                                            </div>
                                            <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-end">
                                                <label className="block text-xs font-medium text-gray-600">
                                                    Save bit
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="52"
                                                        value={dlcMappingDrafts[dlc]?.bit || ''}
                                                        onChange={event => handleDlcMappingDraftChange(dlc, 'bit', event.target.value)}
                                                        placeholder="e.g. 7"
                                                        className="mt-1 w-full rounded-lg border p-2 text-sm"
                                                    />
                                                </label>
                                                <label className="block text-xs font-medium text-gray-600">
                                                    Internal names
                                                    <input
                                                        type="text"
                                                        value={dlcMappingDrafts[dlc]?.identifiers || ''}
                                                        onChange={event => handleDlcMappingDraftChange(dlc, 'identifiers', event.target.value)}
                                                        placeholder="Content7, Filter_PDLC_Name"
                                                        className="mt-1 w-full rounded-lg border p-2 text-sm"
                                                    />
                                                </label>
                                                <button
                                                    onClick={() => handleSaveDlcMapping(dlc)}
                                                    disabled={savingDlcName === dlc}
                                                    className={`${color.bg} ${color.hoverBg} rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50`}
                                                >
                                                    {savingDlcName === dlc ? 'Saving…' : 'Save mapping'}
                                                </button>
                                            </div>
                                        </div>
                                    )) : <p className="text-sm text-gray-500">No DLCs found.</p>}
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-center gap-4">
                            <button onClick={handleSeedDlcs} disabled={seedingDlcs} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50">
                                {seedingDlcs ? <Spinner size="small" /> : 'Add Missing DLC Defaults'}
                            </button>
                        </div>
                    </div>
                );
            case 'Indexes': {
                const formatUpdatedAt = (ts) => ts?.toDate ? ts.toDate().toLocaleString() : '—';
                return (
                    <div>
                        <div className="flex justify-center mb-8">
                            <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                                {['General', 'Communities'].map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setIndexSubTab(tab)}
                                        className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${indexSubTab === tab ? 'bg-blue-500 text-white' : 'text-gray-600 hover:text-black'}`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {loadingIndexes ? <Spinner /> : indexSubTab === 'General' ? (
                            <div className="max-w-3xl mx-auto">
                                <div className="text-center mb-6">
                                    <button
                                        onClick={() => handleRebuildSearchIndex('general')}
                                        disabled={rebuildingIndex !== null}
                                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-8 rounded-lg disabled:opacity-50"
                                    >
                                        {rebuildingIndex === 'general' ? <Spinner size="small" /> : 'Rebuild General Index'}
                                    </button>
                                    <p className="text-sm text-gray-500 mt-2">Rebuilds the per-game search indexes used by the homepage search.</p>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    {gameIndexes.length === 0 && (
                                        <p className="col-span-full text-center text-gray-500 py-8 bg-gray-50 rounded-lg border">No index documents found yet. Run a rebuild.</p>
                                    )}
                                    {gameIndexes.map(idx => (
                                        <div key={idx.id} className="bg-white p-4 rounded-lg shadow border text-center">
                                            <h4 className="font-bold text-gray-800 capitalize">{idx.id.replace(/-/g, ' ')}</h4>
                                            <p className="text-3xl font-bold text-blue-500 my-2">{idx.count}</p>
                                            <p className="text-xs text-gray-500">entries</p>
                                            <p className="text-xs text-gray-500">{idx.shardCount} shard{idx.shardCount === 1 ? '' : 's'}</p>
                                            <p className="text-xs text-gray-400 mt-2">Updated: {formatUpdatedAt(idx.updatedAt)}</p>
                                        </div>
                                    ))}
                                </div>
                                <h3 className="mb-3 mt-8 text-center text-lg font-bold text-gray-800">Other scalable indexes</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    {otherIndexes.map(idx => (
                                        <div key={idx.id} className="bg-white p-4 rounded-lg shadow border text-center">
                                            <h4 className="font-bold text-gray-800">{idx.label}</h4>
                                            <p className="text-3xl font-bold text-purple-500 my-2">
                                                {idx.count === null ? '—' : idx.count}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {idx.scopeCount} scope{idx.scopeCount === 1 ? '' : 's'}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {idx.shardCount} shard{idx.shardCount === 1 ? '' : 's'}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-5xl mx-auto">
                                {communityIndexes.length === 0 && (
                                    <p className="text-center text-gray-500 py-8 bg-gray-50 rounded-lg border">No communities found.</p>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {communityIndexes.map(c => (
                                        <div key={c.id} className="bg-white rounded-lg shadow border overflow-hidden flex flex-col">
                                            <div className="h-20 w-full" style={{ backgroundColor: c.themeColor }}>
                                                {c.bannerImageUrl && (
                                                    <img src={c.bannerImageUrl} alt="" className="w-full h-full object-cover" />
                                                )}
                                            </div>
                                            <div className="p-4 flex flex-col flex-grow">
                                                <h4 className="font-bold text-gray-800 truncate" title={c.name}>{c.name}</h4>
                                                <p className="text-sm text-gray-500">{c.memberCount} members</p>
                                                <p className="text-sm text-gray-600 mt-2">
                                                    Index: {c.count === null ? <span className="text-orange-500 font-semibold">not built yet</span> : <span className="font-semibold">{c.count} entries</span>}
                                                </p>
                                                {c.count !== null && (
                                                    <p className="text-xs text-gray-500">{c.shardCount} shard{c.shardCount === 1 ? '' : 's'}</p>
                                                )}
                                                <p className="text-xs text-gray-400">Updated: {formatUpdatedAt(c.updatedAt)}</p>
                                                <button
                                                    onClick={() => handleRebuildSearchIndex('community', c.id)}
                                                    disabled={rebuildingIndex !== null}
                                                    className="mt-3 w-full text-white font-semibold py-2 px-3 rounded-lg disabled:opacity-50 hover:brightness-90"
                                                    style={{ backgroundColor: c.themeColor }}
                                                >
                                                    {rebuildingIndex === c.id ? <Spinner size="small" /> : 'Rebuild Community Index'}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            }
            case 'Bug Reports': {
                const openBugs = bugReports.filter(b => b.status === 'open');
                const closedBugs = bugReports.filter(b => b.status !== 'open');
                const shownBugs = bugSubTab === 'Open' ? openBugs : closedBugs;
                const formatTs = (ts) => ts?.toDate ? ts.toDate().toLocaleString() : '—';
                return (
                    <div className="max-w-4xl mx-auto">
                        <div className="flex justify-center mb-8">
                            <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                                {['Open', 'Closed'].map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setBugSubTab(tab)}
                                        className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${bugSubTab === tab ? (tab === 'Open' ? 'bg-red-500 text-white' : 'bg-green-600 text-white') : 'text-gray-600 hover:text-black'}`}
                                    >
                                        {tab}
                                        <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${bugSubTab === tab ? 'bg-white text-gray-800' : 'bg-gray-300 text-gray-700'}`}>
                                            {tab === 'Open' ? openBugs.length : closedBugs.length}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {loadingBugs ? <Spinner /> : shownBugs.length === 0 ? (
                            <p className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border">
                                {bugSubTab === 'Open' ? 'No open bug reports. 🎉' : 'No closed bug reports yet.'}
                            </p>
                        ) : (
                            <div className="space-y-4">
                                {shownBugs.map(report => (
                                    <div key={report.id} className="bg-white rounded-lg shadow border p-4">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="min-w-0 flex-grow">
                                                <p className="text-gray-800 whitespace-pre-wrap break-words">{report.description}</p>
                                                <div className="mt-3 pt-3 border-t flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                                                    <span><span className="font-semibold">From:</span> {report.username} ({report.userId})</span>
                                                    <span><span className="font-semibold">Page:</span> {report.page}</span>
                                                    <span><span className="font-semibold">Screen:</span> {report.screen}</span>
                                                    <span><span className="font-semibold">Reported:</span> {formatTs(report.createdAt)}</span>
                                                    {report.closedAt && <span><span className="font-semibold">Closed:</span> {formatTs(report.closedAt)}</span>}
                                                </div>
                                                <p className="mt-1 text-xs text-gray-400 truncate" title={report.userAgent}>{report.userAgent}</p>
                                            </div>
                                            <button
                                                onClick={() => handleToggleBugStatus(report)}
                                                className={`flex-shrink-0 text-sm font-semibold py-2 px-4 rounded-lg text-white ${report.status === 'open' ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'}`}
                                            >
                                                {report.status === 'open' ? 'Mark as Closed' : 'Reopen'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            }
            case 'Feed':
                if (!feedWeights) return <Spinner />;
                return (
                    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto">
                        <h2 className="text-2xl font-bold mb-2">Recommended-Feed Mix</h2>
                        <p className="text-gray-600 mb-6">
                            Global default weighting of the "Recommended" home feed. Applies to
                            logged-out visitors and everyone without personal sliders. Values are
                            relative shares. "Matches my interests" has no effect for logged-out
                            users (no interest signal) — the remaining shares fill the gap.
                        </p>
                        <FeedWeightSliders
                            weights={feedWeights}
                            onChange={(next) => { setFeedWeights(next); setFeedWeightsDirty(true); }}
                            labelOverrides={{ affinity: 'Personalized (user interests)' }}
                        />
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => handleSaveFeedWeights(feedWeights)}
                                disabled={savingFeedWeights || !feedWeightsDirty}
                                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                            >
                                {savingFeedWeights ? 'Saving...' : 'Save'}
                            </button>
                            <button
                                onClick={() => handleSaveFeedWeights(DEFAULT_WEIGHTS)}
                                disabled={savingFeedWeights}
                                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                            >
                                Reset to defaults
                            </button>
                        </div>
                    </div>
                );
            case 'Email Users':
                return (
                    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto text-center">
                        <h2 className="text-2xl font-bold mb-4">Generate User Email List</h2>
                        <p className="text-gray-600 mb-6">Click the button below to generate a comma-separated list of all user emails. The list will be automatically copied to your clipboard.</p>
                        <button
                            onClick={handleGenerateEmailList}
                            disabled={isGenerating}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-lg disabled:opacity-50"
                        >
                            {isGenerating ? 'Generating...' : 'Generate & Copy Email List'}
                        </button>
                    </div>
                );
            case 'Site Statistics':
                if (loadingStats || !stats) return <Spinner />;
                return (
                    <div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <StatCard title="Total Users" value={stats.totalUsers} colorClass="bg-indigo-500" />
                            <StatCard title="Total Creations" value={stats.totalCreations} colorClass="bg-purple-500" />
                            <StatCard title="Total Communities" value={stats.totalCommunities} colorClass="bg-pink-500" />
                        </div>
                        <div className="mt-8 bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-2xl font-bold mb-4 text-gray-800">Creations by Game</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {getGames({ includeDisabled: true }).map(g => (
                                    <StatCard key={g.id} title={g.name} value={stats.creationsByGame[g.id] ?? 0} colorClass={getGameColor(g.id).bg} style={getGameColor(g.id).style} />
                                ))}
                            </div>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="container mx-auto p-4 sm:p-8">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">Admin Management</h1>
            <PillTabs
                tabs={TABS}
                value={activeTab}
                onChange={setActiveTab}
                accentClass="bg-red-500"
                ariaLabel="Admin sections"
                className="my-6"
            />
            <div className="py-6">
                {activeTab === 'User Management' && (
                    <PillTabs
                        tabs={USER_MANAGEMENT_TABS}
                        value={userSubTab}
                        onChange={setUserSubTab}
                        counts={{ Applications: applications.length, Influencers: influencers.length }}
                        ariaLabel="User management sections"
                        className="mb-8"
                    />
                )}
                {activeTab === 'Startpage' && (
                    <PillTabs
                        tabs={STARTPAGE_TABS}
                        value={startpageSubTab}
                        onChange={setStartpageSubTab}
                        ariaLabel="Startpage sections"
                        className="mb-8"
                    />
                )}
                {renderContent()}
            </div>
        </div>
    );
};

export default AdminPage;
