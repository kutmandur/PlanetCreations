import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { onSnapshot, collection, query, where, doc, getDoc, orderBy, limit, getDocs, startAfter, writeBatch, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { getGameColor, ICONS, SOCIAL_PLATFORMS, getYoutubeThumbnailUrl } from '../../utils/helpers';
import { fetchCommunityIndex } from '../../firebase/communityIndexService';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import Icon from '../ui/Icon';
import CommunityMembershipCard from '../cards/CommunityMembershipCard';
import CommunityFilterBar, { creationMatchesFilters } from '../management/CommunityFilterBar';

// Hex-Werte passend zu getGameColor — für die CSS-Variable --theme-color,
// die CommunityFilterBar für Fokus-Ring und aktiven Filter-Button nutzt.
const GAME_HEX = {
    'all': '#F97316',
    'planet-coaster': '#3B82F6',
    'planet-coaster-2': '#1E40AF',
    'planet-zoo': '#22C55E',
};

// Steam ist kein Community-Social-Link, daher nicht in SOCIAL_PLATFORMS.
const STEAM_ICON = "M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z";

const getPlatform = (id) => SOCIAL_PLATFORMS.find(p => p.id === id);

// Profilfeld → Icon + Link-Auflösung (Discord speichert nur die User-ID).
const PROFILE_SOCIALS = [
    { field: 'youtube', title: 'YouTube', platform: getPlatform('youtube'), href: p => p.youtube },
    { field: 'twitch', title: 'Twitch', platform: getPlatform('twitch'), href: p => p.twitch },
    { field: 'instagram', title: 'Instagram', platform: getPlatform('instagram'), href: p => p.instagram },
    { field: 'tiktok', title: 'TikTok', platform: getPlatform('tiktok'), href: p => p.tiktok },
    { field: 'twitter', title: 'X (Twitter)', platform: getPlatform('x'), href: p => p.twitter },
    { field: 'discord', title: 'Discord', platform: getPlatform('discord'), href: p => `https://discord.com/users/${p.discord}` },
    { field: 'steam', title: 'Steam', platform: { icon: STEAM_ICON, solid: true }, href: p => p.steam },
    { field: 'website', title: 'Website', platform: getPlatform('website'), href: p => p.website },
];

const ProfilePage = ({ user, userProfile, setReportModal, setModalMessage, setConfirmation, userIdOverride }) => {
    const { userId: userIdFromUrl } = useParams();
    const userId = userIdOverride || userIdFromUrl;

    const [profile, setProfile] = useState({});
    const [creations, setCreations] = useState([]);
    const [memberships, setMemberships] = useState([]);

    const [loadingProfile, setLoadingProfile] = useState(true);
    const [loadingMemberships, setLoadingMemberships] = useState(true);

    const [loadingInitialCreations, setLoadingInitialCreations] = useState(true);
    const [loadingMoreCreations, setLoadingMoreCreations] = useState(false);
    const [lastVisibleCreation, setLastVisibleCreation] = useState(null);
    const [hasMoreCreations, setHasMoreCreations] = useState(true);

    const [selectedGame, setSelectedGame] = useState('all');
    const [activeSection, setActiveSection] = useState('Creations');
    const [filterState, setFilterState] = useState({ searchTerm: '', status: 'all', rank: 'all', tag: '', dlc: 'all' });

    const [showcases, setShowcases] = useState(null); // null = noch nicht geladen
    const [loadingShowcases, setLoadingShowcases] = useState(false);

    const [hasAlreadyReported, setHasAlreadyReported] = useState(false);
    const tabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const color = getGameColor(selectedGame);
    const themeHex = GAME_HEX[selectedGame] || GAME_HEX['all'];
    const navigate = useNavigate();

    const TABS_WITH_ALL = useRef([
        { id: 'all', name: 'All' },
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;

    const fetchMoreCreations = useCallback(async () => {
        if (loadingMoreCreations || !hasMoreCreations || !lastVisibleCreation) return;

        setLoadingMoreCreations(true);
        try {
            const q = query(
                collection(db, 'creations'),
                where('userId', '==', userId),
                orderBy('createdAt', 'desc'),
                startAfter(lastVisibleCreation),
                limit(12)
            );
            const docSnapshots = await getDocs(q);
            const newCreations = docSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setCreations(prev => [...prev, ...newCreations]);
            setLastVisibleCreation(docSnapshots.docs[docSnapshots.docs.length - 1]);
            if (newCreations.length < 12) {
                setHasMoreCreations(false);
            }
        } catch (error) {
            console.error("Error fetching more creations:", error);
        }
        setLoadingMoreCreations(false);
    }, [userId, loadingMoreCreations, hasMoreCreations, lastVisibleCreation]);

    useEffect(() => {
        const handleScroll = () => {
            if (window.innerHeight + document.documentElement.scrollTop + 100 >= document.documentElement.offsetHeight) {
                fetchMoreCreations();
            }
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [fetchMoreCreations]);


    useEffect(() => {
        if (!userId) {
            setLoadingProfile(false);
            setLoadingMemberships(false);
            setLoadingInitialCreations(false);
            return;
        }

        let isMounted = true;
        setLoadingProfile(true);
        setLoadingMemberships(true);
        setShowcases(null);
        setActiveSection('Creations');
        setFilterState({ searchTerm: '', status: 'all', rank: 'all', tag: '', dlc: 'all' });

        const fetchInitialCreations = async () => {
            setLoadingInitialCreations(true);
            setHasMoreCreations(true);
            setCreations([]);
            try {
                const q = query(
                    collection(db, 'creations'),
                    where('userId', '==', userId),
                    orderBy('createdAt', 'desc'),
                    limit(12)
                );
                const docSnapshots = await getDocs(q);
                const newCreations = docSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (isMounted) {
                    setCreations(newCreations);
                    setLastVisibleCreation(docSnapshots.docs[docSnapshots.docs.length - 1]);
                    setHasMoreCreations(newCreations.length === 12);
                }
            } catch (error) {
                console.error("Error fetching initial creations:", error);
            }
            if (isMounted) setLoadingInitialCreations(false);
        };
        fetchInitialCreations();

        const profileDocRef = doc(db, 'profiles', userId);
        const profileUnsubscribe = onSnapshot(profileDocRef, (docSnap) => {
            if (isMounted) {
                if (docSnap.exists()) {
                    setProfile(prev => ({ ...prev, ...docSnap.data() }));
                }
                setLoadingProfile(false);
            }
        });

        const membershipsRef = collection(db, 'profiles', userId, 'communityMemberships');
        const membershipsUnsubscribe = onSnapshot(membershipsRef, async (snapshot) => {
            const memberDataPromises = snapshot.docs.map(async (mDoc) => {
                const communityId = mDoc.id;
                const communityRef = doc(db, 'communitys', communityId);
                const memberRef = doc(db, 'communitys', communityId, 'members', userId);

                const [communitySnap, memberSnap] = await Promise.all([
                    getDoc(communityRef),
                    getDoc(memberRef)
                ]);

                if (communitySnap.exists() && memberSnap.exists()) {
                    return {
                        communityId,
                        communityName: communitySnap.data().name,
                        communitySlug: communitySnap.data().slug,
                        communityProfileImageUrl: communitySnap.data().profileImageUrl,
                        roles: memberSnap.data().roles,
                        ranks: communitySnap.data().ranks
                    };
                }
                return null;
            });

            const resolvedMemberships = (await Promise.all(memberDataPromises)).filter(Boolean);
            if (isMounted) {
                setMemberships(resolvedMemberships);
                setLoadingMemberships(false);
            }
        });

        if (user) {
            const checkReportStatus = async () => {
                const reportMarkerRef = doc(db, 'users', user.uid, 'reportedItems', userId);
                const docSnap = await getDoc(reportMarkerRef);
                if (isMounted) setHasAlreadyReported(docSnap.exists());
            };
            checkReportStatus();
        }

        return () => {
            isMounted = false;
            profileUnsubscribe();
            membershipsUnsubscribe();
        };
    }, [userId, user]);

    // Showcases werden erst beim Öffnen des Tabs geladen: pro Community-
    // Mitgliedschaft ein Index-Read, gefiltert auf Creations dieses Users
    // mit Showcase-Video, gruppiert nach Community + Video-URL.
    useEffect(() => {
        if (activeSection !== 'Showcases' || showcases !== null || loadingMemberships) return;
        let isMounted = true;
        const loadShowcases = async () => {
            setLoadingShowcases(true);
            try {
                const perCommunity = await Promise.all(memberships.map(async (m) => {
                    const entries = await fetchCommunityIndex(m.communityId);
                    return entries
                        .filter(c => c.userId === userId && c.showcaseVideoUrl)
                        .map(c => ({ ...c, communityId: m.communityId, communityName: m.communityName }));
                }));
                const groups = new Map();
                perCommunity.flat().forEach(c => {
                    const key = `${c.communityId}|${c.showcaseVideoUrl}`;
                    if (!groups.has(key)) {
                        groups.set(key, { key, url: c.showcaseVideoUrl, name: null, communityId: c.communityId, communityName: c.communityName, creations: [] });
                    }
                    const group = groups.get(key);
                    group.creations.push(c);
                    if (!group.name && c.showcaseName) group.name = c.showcaseName;
                });
                if (isMounted) setShowcases(Array.from(groups.values()));
            } catch (error) {
                console.error("Error loading showcases:", error);
                if (isMounted) setShowcases([]);
            }
            if (isMounted) setLoadingShowcases(false);
        };
        loadShowcases();
        return () => { isMounted = false; };
    }, [activeSection, showcases, memberships, loadingMemberships, userId]);

    const handleFilterChange = (field, value) => {
        setFilterState(prev => ({ ...prev, [field]: value }));
    };

    const visibleCreations = useMemo(() => {
        return creations.filter(c => {
            if (selectedGame !== 'all' && c.game !== selectedGame) return false;
            if (filterState.status !== 'all' && c.status !== filterState.status) return false;
            return creationMatchesFilters(c, { searchTerm: filterState.searchTerm, rank: 'all', tag: filterState.tag, dlc: 'all' });
        });
    }, [creations, selectedGame, filterState]);

    const loading = loadingProfile || loadingInitialCreations || loadingMemberships;

    useEffect(() => {
        setTimeout(() => {
            const activeTabIndex = TABS_WITH_ALL.findIndex(tab => tab.id === selectedGame);
            const activeTabRef = tabRefs.current[activeTabIndex];
            if (activeTabRef) {
                setGliderStyle({
                    left: activeTabRef.offsetLeft,
                    width: activeTabRef.offsetWidth,
                });
            }
        }, 50);
    }, [selectedGame, TABS_WITH_ALL, loading, activeSection]);

    const handleShare = async () => {
        const shareData = {
            title: `PlanetCreations: ${profile?.username || 'Creator'}`,
            text: `Check out ${profile?.username || 'this creator'}'s creations on PlanetCreations!`,
            url: window.location.origin + `/#/profile/${userId}`,
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else {
                await navigator.clipboard.writeText(shareData.url);
                setModalMessage("Link copied to clipboard!");
            }
        } catch (error) {
            if (error.name !== 'AbortError') setModalMessage('Could not share at this time.');
        }
    };

    const handleReportUser = () => {
        if (!user) { setModalMessage("You must be logged in to report a user."); return; }
        if (hasAlreadyReported) { setModalMessage("You have already reported this user."); return; }
        setReportModal({
            type: 'user',
            targetId: userId,
            targetType: 'user',
            targetTitle: profile?.username || 'User',
            onConfirm: async (reason) => {
                try {
                    const batch = writeBatch(db);
                    const reportRef = doc(collection(db, 'reports'));
                    batch.set(reportRef, { targetId: userId, targetType: 'user', targetTitle: profile?.username || 'User', reason, reporterId: user.uid, timestamp: serverTimestamp() });
                    const reportMarkerRef = doc(db, 'users', user.uid, 'reportedItems', userId);
                    batch.set(reportMarkerRef, { reportedAt: serverTimestamp() });
                    await batch.commit();
                    setHasAlreadyReported(true);
                    setModalMessage("Thank you, the user has been reported.");
                } catch (error) {
                    console.error("Error reporting user:", error);
                    setModalMessage(`Error reporting user: ${error.message}`);
                }
            }
        });
    };

    const handleDeleteUser = () => {
        setConfirmation({
            message: `Are you sure you want to permanently delete "${profile?.username || 'this user'}" and all of their content? This cannot be undone.`,
            onConfirm: async () => {
                try {
                    const functions = getFunctions();
                    const deleteUserAndContent = httpsCallable(functions, 'deleteUserAndContent');
                    await deleteUserAndContent({ userIdToDelete: userId });
                    setModalMessage("User and all their content has been deleted.");
                    navigate('/');
                } catch (error) {
                    console.error("Error deleting user:", error);
                    setModalMessage(`Error deleting user: ${error.message}`);
                }
            }
        });
    };

    if (loading) return <Spinner gameId={selectedGame} />;

    const activeSocials = PROFILE_SOCIALS.filter(s => profile?.[s.field]);

    return (
        <div className="container mx-auto p-4 mt-8">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white p-6 sm:p-8 rounded-lg shadow-md mb-8 relative">
                    <div className="absolute top-4 right-4 flex items-center space-x-2">
                        {user && user.uid === userId && (
                            <button onClick={() => navigate('/profile/edit')} className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2 px-4 rounded-lg text-sm">
                                Edit Profile
                            </button>
                        )}
                        <button onClick={handleShare} title="Share Profile" className="p-2 rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-800">
                            <Icon path={ICONS.share} className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="flex flex-col items-center text-center">
                        <img
                            src={profile?.profilePictureUrl || 'https://placehold.co/128x128/e2e8f0/64748b?text=P'}
                            alt="Profile"
                            className={`w-32 h-32 rounded-full object-cover border-4 ${color.border} mb-4`}
                            onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/128x128/e2e8f0/64748b?text=P'; }}
                        />
                        <h2 className={`text-3xl font-bold ${color.text}`}>{profile?.username || 'User Profile'}</h2>
                        {profile?.country && <p className="text-gray-500 mt-1">{profile.country}</p>}
                        {profile?.favoriteGame && <p className="text-sm bg-gray-200 text-gray-800 px-2 py-1 rounded-full inline-block mt-2">{profile.favoriteGame.replace(/-/g, ' ')}</p>}

                        <div className="flex items-center justify-center mt-6 space-x-2">
                            {user && user.uid !== userId && (
                                <button onClick={handleReportUser} disabled={hasAlreadyReported} className="text-gray-500 hover:text-red-500 disabled:text-gray-400 disabled:cursor-not-allowed">
                                    {hasAlreadyReported ? 'Already Reported' : 'Report User'}
                                </button>
                            )}
                            {userProfile?.role === 'admin' && user?.uid !== userId && (
                                <button onClick={handleDeleteUser} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg text-sm">
                                    Delete User
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="mt-6 text-center">
                        {activeSocials.length > 0 && (
                            <div className="flex justify-center flex-wrap items-center gap-2 mb-4">
                                {activeSocials.map(social => (
                                    <a
                                        key={social.field}
                                        href={social.href(profile)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={social.title}
                                        className="w-9 h-9 rounded-full bg-gray-200 text-gray-600 hover:text-white flex items-center justify-center transition-colors"
                                        style={{ '--hover-bg': themeHex }}
                                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = themeHex; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                                    >
                                        <Icon path={social.platform.icon} solid={social.platform.solid} className="w-5 h-5" />
                                    </a>
                                ))}
                            </div>
                        )}
                        {profile?.bio && <p className="text-gray-700 whitespace-pre-wrap">{profile.bio}</p>}
                    </div>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8" style={{ '--theme-color': themeHex }}>
                <div className="w-full lg:w-3/4">
                    <div className="flex justify-center my-6">
                        <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                            {['Creations', 'Showcases'].map(section => (
                                <button
                                    key={section}
                                    onClick={() => setActiveSection(section)}
                                    className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium whitespace-nowrap ${activeSection === section ? `${color.bg} text-white` : 'text-gray-600 hover:text-black'}`}
                                >
                                    {section}
                                </button>
                            ))}
                        </div>
                    </div>

                    {activeSection === 'Creations' && (
                        <>
                            <div className="flex justify-center mb-6">
                                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                                    <div className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} style={gliderStyle} />
                                    {TABS_WITH_ALL.map((tab, index) => (
                                        <button key={tab.id} ref={el => tabRefs.current[index] = el} onClick={() => setSelectedGame(tab.id)} className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium whitespace-nowrap ${ selectedGame === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}>
                                            {tab.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <CommunityFilterBar
                                searchTerm={filterState.searchTerm}
                                onSearchChange={(value) => handleFilterChange('searchTerm', value)}
                                filters={filterState}
                                onFilterChange={handleFilterChange}
                                ranks={[]}
                                statusOptions={[
                                    { value: 'all', label: 'All Statuses' },
                                    { value: 'finished', label: 'Finished' },
                                    { value: 'wip', label: 'Work in Progress' },
                                ]}
                                placeholder="Search creations by title or tag..."
                            />

                            <h3 className="text-2xl font-bold mb-4">Creations by {profile?.username || 'this user'}</h3>
                            {visibleCreations.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {visibleCreations.map(creation => (
                                        <CreationCard key={creation.id} creation={creation} onTagClick={(tag) => handleFilterChange('tag', tag)} />
                                    ))}
                                </div>
                            ) : (
                                !loadingInitialCreations && <p className="text-center text-gray-500 mt-10">{creations.length > 0 ? `No creations match your filters.` : `This user hasn't created anything yet.`}</p>
                            )}
                            {loadingMoreCreations && <div className="text-center p-8 col-span-full"><Spinner/></div>}
                            {!hasMoreCreations && creations.length > 0 && (
                                <p className="text-center text-gray-500 mt-10 text-xl col-span-full">You've seen all their creations!</p>
                            )}
                        </>
                    )}

                    {activeSection === 'Showcases' && (
                        loadingShowcases || showcases === null ? (
                            <div className="py-16"><Spinner /></div>
                        ) : showcases.length === 0 ? (
                            <p className="text-center text-gray-500 mt-10 py-10 bg-white rounded-lg shadow-md">
                                This creator hasn't been featured in any showcases yet.
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {showcases.map(showcase => (
                                    <div key={showcase.key} className="bg-white rounded-lg shadow-lg overflow-hidden">
                                        <a href={showcase.url} target="_blank" rel="noopener noreferrer" className="relative block h-44 overflow-hidden group">
                                            <img
                                                src={getYoutubeThumbnailUrl(showcase.url) || 'https://placehold.co/480x270/333333/ffffff?text=Video'}
                                                alt="Showcase video thumbnail"
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                            {showcase.name && (
                                                <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 to-transparent px-3 pt-2 pb-6 pointer-events-none">
                                                    <p className="text-white font-bold text-lg text-center truncate" title={showcase.name}>{showcase.name}</p>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <div className="w-14 h-14 rounded-full bg-black/60 group-hover:bg-red-600 transition-colors flex items-center justify-center">
                                                    <div className="w-0 h-0 border-y-8 border-y-transparent border-l-[14px] border-l-white ml-1" />
                                                </div>
                                            </div>
                                        </a>
                                        <div className="p-4">
                                            <p className="text-sm text-gray-500 mb-1">Showcased by</p>
                                            <p className="font-bold text-lg mb-2">{showcase.communityName}</p>
                                            <div className="space-y-1">
                                                {showcase.creations.map(creation => (
                                                    <Link key={creation.id} to={`/creation/${creation.id}`} className="block text-sm text-blue-600 hover:underline truncate" title={creation.title}>
                                                        {creation.title}
                                                    </Link>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>

                <div className="w-full lg:w-1/4">
                    <div className="sticky top-24 space-y-6">
                        <h3 className={`text-2xl font-bold ${color.text}`}>Community Memberships</h3>
                        <div className="space-y-4">
                            {memberships.length > 0 ? (
                                memberships.map(membership => (
                                    <CommunityMembershipCard key={membership.communityId} membership={membership} />
                                ))
                            ) : (
                                <p className="text-gray-500 bg-white p-4 rounded-lg shadow-md">This user is not a member of any communities.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProfilePage;
