import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot, collection, query, where, doc, getDoc, writeBatch, increment, serverTimestamp, orderBy, limit, getDocs, startAfter } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { getGameColor, ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import Icon from '../ui/Icon';
import CommunityMembershipCard from '../cards/CommunityMembershipCard';

const ProfilePage = ({ user, userProfile, setReportModal, setModalMessage, setConfirmation, userIdOverride }) => {
    const { userId: userIdFromUrl } = useParams();
    const userId = userIdOverride || userIdFromUrl;

    const [profile, setProfile] = useState({});
    const [creations, setCreations] = useState([]);
    const [filteredCreations, setFilteredCreations] = useState([]);
    const [memberships, setMemberships] = useState([]);

    const [loadingProfile, setLoadingProfile] = useState(true);
    const [loadingMemberships, setLoadingMemberships] = useState(true);
    
    const [loadingInitialCreations, setLoadingInitialCreations] = useState(true);
    const [loadingMoreCreations, setLoadingMoreCreations] = useState(false);
    const [lastVisibleCreation, setLastVisibleCreation] = useState(null);
    const [hasMoreCreations, setHasMoreCreations] = useState(true);

    const [selectedGame, setSelectedGame] = useState('all');
    const [hasAlreadyReported, setHasAlreadyReported] = useState(false);
    const tabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const color = getGameColor(selectedGame);
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

    useEffect(() => {
        if (selectedGame === 'all') {
            setFilteredCreations(creations);
        } else {
            setFilteredCreations(creations.filter(c => c.game === selectedGame));
        }
    }, [selectedGame, creations]);

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
    }, [selectedGame, TABS_WITH_ALL, loading]);

    const handleShare = async () => { /* ... unchanged ... */ };
    const handleReportUser = () => { /* ... unchanged ... */ };
    const handleDeleteUser = () => { /* ... unchanged ... */ };
    
    if (loading) return <Spinner gameId={selectedGame} />;

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
                        <div className="flex justify-center flex-wrap items-center gap-x-4 gap-y-2 mb-4 text-sm font-medium">
                            {profile?.youtube && (
                                <a href={profile.youtube} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">YouTube</a>
                            )}
                            {profile?.twitch && (
                                <a href={profile.twitch} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Twitch</a>
                            )}
                            {profile?.instagram && (
                                <a href={profile.instagram} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Instagram</a>
                            )}
                            {profile?.tiktok && (
                                <a href={profile.tiktok} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">TikTok</a>
                            )}
                            {profile?.twitter && (
                                <a href={profile.twitter} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">X</a>
                            )}
                            {profile?.discord && (
                                <a href={`https://discord.com/users/${profile.discord}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Discord</a>
                            )}
                            {profile?.steam && (
                                <a href={profile.steam} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Steam</a>
                            )}
                             {profile?.website && (
                                <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Website</a>
                            )}
                        </div>
                        {profile?.bio && <p className="text-gray-700 whitespace-pre-wrap">{profile.bio}</p>}
                    </div>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                <div className="w-full lg:w-3/4">
                    <div className="flex justify-center my-6">
                        <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                            <div className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} style={gliderStyle} />
                            {TABS_WITH_ALL.map((tab, index) => (
                                <button key={tab.id} ref={el => tabRefs.current[index] = el} onClick={() => setSelectedGame(tab.id)} className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium ${ selectedGame === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}>
                                    {tab.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <h3 className="text-2xl font-bold mb-4">Creations by {profile?.username || 'this user'}</h3>
                    {filteredCreations.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredCreations.map(creation => (
                                <CreationCard key={creation.id} creation={creation} />
                            ))}
                        </div>
                    ) : (
                        !loadingInitialCreations && <p className="text-center text-gray-500 mt-10">{creations.length > 0 ? `This user has no creations for this game.` : `This user hasn't created anything yet.`}</p>
                    )}
                    {loadingMoreCreations && <div className="text-center p-8 col-span-full"><Spinner/></div>}
                    {!hasMoreCreations && creations.length > 0 && (
                        <p className="text-center text-gray-500 mt-10 text-xl col-span-full">You've seen all their creations!</p>
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