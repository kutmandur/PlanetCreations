import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { onSnapshot, collection, query, where, doc, getDoc, orderBy, limit, getDocs, startAfter, writeBatch, serverTimestamp, arrayUnion, arrayRemove } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import {
    getGameColor,
    getTextColorForBackground,
    ICONS,
    isSafeHttpUrl,
    SOCIAL_PLATFORMS,
    getYoutubeThumbnailUrl,
} from '../../utils/helpers';
import {
    getProfileAppearance,
    isValidProfileColor,
} from '../../utils/profileAppearance';
import useGames from '../../hooks/useGames';
import { fetchCommunityIndex } from '../../firebase/communityIndexService';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import Icon from '../ui/Icon';
import ProfileImage from '../ui/ProfileImage';
import CommunityMembershipCard from '../cards/CommunityMembershipCard';
import CommunityFilterBar, { creationMatchesFilters } from '../management/CommunityFilterBar';

// Steam ist kein Community-Social-Link, daher nicht in SOCIAL_PLATFORMS.
const STEAM_ICON = "M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z";

const getPlatform = (id) => SOCIAL_PLATFORMS.find(p => p.id === id);

// Profilfeld → Icon + Link-Auflösung (Discord speichert nur die User-ID).
const PROFILE_SOCIALS = [
    { field: 'youtube', title: 'YouTube', platform: getPlatform('youtube'), href: p => p.youtube },
    { field: 'twitch', title: 'Twitch', platform: getPlatform('twitch'), href: p => p.twitch },
    { field: 'instagram', title: 'Instagram', platform: getPlatform('instagram'), href: p => p.instagram },
    { field: 'tiktok', title: 'TikTok', platform: getPlatform('tiktok'), href: p => p.tiktok },
    { field: 'x', title: 'X (Twitter)', platform: getPlatform('x'), href: p => p.x },
    { field: 'discord', title: 'Discord', platform: getPlatform('discord'), href: p => `https://discord.com/users/${p.discord}` },
    { field: 'steam', title: 'Steam', platform: { icon: STEAM_ICON, solid: true }, href: p => p.steam },
    { field: 'website', title: 'Website', platform: getPlatform('website'), href: p => p.website },
];

const ProfileLinks = ({
    activeSocials,
    className,
    hasProfileBanner,
    onShare,
    profile,
    themeHex,
}) => (
    <div className={className} aria-label="Profile links">
        <button
            onClick={onShare}
            title="Share Profile"
            aria-label="Share Profile"
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition ${
                hasProfileBanner
                    ? 'border border-white/20 bg-black/30 text-white backdrop-blur-sm hover:bg-white/25'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300 hover:text-gray-900 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white'
            }`}
        >
            <Icon path={ICONS.share} className="h-5 w-5" />
        </button>
        {activeSocials.map((social) => (
            <a
                key={social.field}
                href={social.href(profile)}
                target="_blank"
                rel="noopener noreferrer"
                title={social.title}
                aria-label={social.title}
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:text-white ${
                    hasProfileBanner
                        ? 'border border-white/20 bg-black/30 text-white backdrop-blur-sm'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}
                onMouseEnter={(event) => {
                    event.currentTarget.style.backgroundColor = themeHex;
                }}
                onMouseLeave={(event) => {
                    event.currentTarget.style.backgroundColor = '';
                }}
            >
                <Icon
                    path={social.platform.icon}
                    solid={social.platform.solid}
                    className="h-5 w-5"
                />
            </a>
        ))}
    </div>
);

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
    const [activePanel, setActivePanel] = useState(0); // 0 = Creations/Showcases, 1 = Memberships (mobile swipe)
    const [filterState, setFilterState] = useState({ searchTerm: '', status: 'all', rank: 'all', tag: '', dlc: 'all' });

    const [showcases, setShowcases] = useState(null); // null = noch nicht geladen
    const [loadingShowcases, setLoadingShowcases] = useState(false);

    const [hasAlreadyReported, setHasAlreadyReported] = useState(false);
    const [isFollowing, setIsFollowing] = useState(false);
    const [followerCount, setFollowerCount] = useState(0);
    const [isFollowingBusy, setIsFollowingBusy] = useState(false);
    const [profileBannerFailed, setProfileBannerFailed] = useState(false);
    const [profileMobileBannerFailed, setProfileMobileBannerFailed] = useState(false);
    const tabRefs = useRef([]);
    const contentSwipeRef = useRef(null);
    const [gliderStyle, setGliderStyle] = useState({});
    const selectedGameColor = getGameColor(selectedGame);
    const favoriteGameColor = getGameColor(profile?.favoriteGame);
    const profileAppearance = getProfileAppearance(
        isValidProfileColor(profile?.profileColor)
            ? profile.profileColor
            : selectedGameColor.hex
    );
    const themeHex = profileAppearance.hex;
    const navigate = useNavigate();

    const games = useGames();
    const TABS_WITH_ALL = useMemo(() => [{ id: 'all', name: 'All' }, ...games], [games]);

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
        setActivePanel(0);
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
                        communityBannerImageUrl: communitySnap.data().bannerImageUrl,
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
        if (loading) return undefined;

        const swipeElement = contentSwipeRef.current;
        const isMobile = window.matchMedia('(max-width: 1023px)').matches;
        const prefersReducedMotion = window.matchMedia(
            '(prefers-reduced-motion: reduce)'
        ).matches;

        if (!swipeElement || !isMobile || prefersReducedMotion) return undefined;

        let animationFrameId;
        let startDelayId;
        let observer;
        let isStopped = false;
        let interactionListenersActive = false;

        const interactionEvents = ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'wheel'];

        const removeInteractionListeners = () => {
            if (!interactionListenersActive) return;
            interactionEvents.forEach((eventName) => {
                window.removeEventListener(eventName, stopAnimation, true);
            });
            window.removeEventListener('keydown', stopAnimation, true);
            interactionListenersActive = false;
        };

        const stopAnimation = () => {
            if (isStopped) return;
            isStopped = true;
            window.clearTimeout(startDelayId);
            window.cancelAnimationFrame(animationFrameId);
            swipeElement.style.scrollSnapType = '';
            removeInteractionListeners();
            observer?.disconnect();
        };

        const addInteractionListeners = () => {
            if (interactionListenersActive) return;
            interactionEvents.forEach((eventName) => {
                window.addEventListener(eventName, stopAnimation, {
                    capture: true,
                    passive: true,
                });
            });
            window.addEventListener('keydown', stopAnimation, true);
            interactionListenersActive = true;
        };

        const startPeekAnimation = () => {
            if (isStopped || swipeElement.scrollLeft > 2) return;

            addInteractionListeners();
            startDelayId = window.setTimeout(() => {
                if (isStopped) return;

                const peekDistance = Math.min(64, swipeElement.clientWidth * 0.18);
                const outwardDuration = 340;
                const holdDuration = 130;
                const returnDuration = 430;
                const totalDuration = outwardDuration + holdDuration + returnDuration;
                const startedAt = window.performance.now();

                swipeElement.style.scrollSnapType = 'none';

                const animate = (currentTime) => {
                    if (isStopped) return;

                    const elapsed = currentTime - startedAt;
                    let nextScrollLeft;

                    if (elapsed < outwardDuration) {
                        const progress = elapsed / outwardDuration;
                        const easedProgress = 1 - Math.pow(1 - progress, 3);
                        nextScrollLeft = peekDistance * easedProgress;
                    } else if (elapsed < outwardDuration + holdDuration) {
                        nextScrollLeft = peekDistance;
                    } else if (elapsed < totalDuration) {
                        const progress =
                            (elapsed - outwardDuration - holdDuration) / returnDuration;
                        const easedProgress =
                            progress < 0.5
                                ? 2 * progress * progress
                                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                        nextScrollLeft = peekDistance * (1 - easedProgress);
                    } else {
                        swipeElement.scrollLeft = 0;
                        swipeElement.style.scrollSnapType = '';
                        isStopped = true;
                        removeInteractionListeners();
                        return;
                    }

                    swipeElement.scrollLeft = nextScrollLeft;
                    animationFrameId = window.requestAnimationFrame(animate);
                };

                animationFrameId = window.requestAnimationFrame(animate);
            }, 220);
        };

        if ('IntersectionObserver' in window) {
            observer = new IntersectionObserver(
                (entries) => {
                    if (!entries.some((entry) => entry.isIntersecting)) return;
                    observer.disconnect();
                    startPeekAnimation();
                },
                {
                    rootMargin: '0px 0px -15% 0px',
                    threshold: 0.01,
                }
            );
            observer.observe(swipeElement);
        } else {
            startPeekAnimation();
        }

        return stopAnimation;
    }, [loading, userId]);

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

    // Mobile: die beiden Panels (Creations/Showcases ↔ Memberships) liegen in
    // einem horizontalen Snap-Container. Pfeile scrollen programmatisch, der
    // Scroll-Listener hält den Sticky-Titel mit dem sichtbaren Panel synchron.
    const scrollToPanel = useCallback((index) => {
        const element = contentSwipeRef.current;
        if (!element) return;
        element.scrollTo({ left: index * element.clientWidth, behavior: 'smooth' });
        setActivePanel(index);
    }, []);

    const handleSwipeScroll = useCallback((event) => {
        const element = event.currentTarget;
        if (!element.clientWidth) return;
        const index = Math.round(element.scrollLeft / element.clientWidth);
        setActivePanel((prev) => (prev !== index ? index : prev));
    }, []);

    useEffect(() => { setFollowerCount(profile?.followers?.length || 0); }, [profile]);
    useEffect(() => { setIsFollowing((userProfile?.following || []).includes(userId)); }, [userProfile, userId]);
    useEffect(() => { setProfileBannerFailed(false); }, [profile?.profileBannerUrl]);
    useEffect(() => {
        setProfileMobileBannerFailed(false);
    }, [profile?.profileMobileBannerUrl]);

    const handleFollow = async () => {
        if (!user || !userProfile) { setModalMessage("You must be logged in to follow."); return; }
        if (user.uid === userId || isFollowingBusy) return;
        setIsFollowingBusy(true);
        const meRef = doc(db, 'profiles', user.uid);
        const targetRef = doc(db, 'profiles', userId);
        const wasFollowing = isFollowing;
        const batch = writeBatch(db);
        if (wasFollowing) {
            batch.update(meRef, { following: arrayRemove(userId) });
            batch.update(targetRef, { followers: arrayRemove(user.uid) });
        } else {
            batch.update(meRef, { following: arrayUnion(userId) });
            batch.update(targetRef, { followers: arrayUnion(user.uid) });
        }
        try {
            await batch.commit();
            setIsFollowing(!wasFollowing);
            setFollowerCount(c => Math.max(0, c + (wasFollowing ? -1 : 1)));
        } catch (error) {
            setModalMessage(`Error updating follow: ${error.message}`);
        } finally {
            setIsFollowingBusy(false);
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

    const activeSocials = PROFILE_SOCIALS.filter((social) => {
        if (!profile?.[social.field]) return false;
        return social.field === 'discord' || isSafeHttpUrl(social.href(profile));
    });
    const profileBannerUrl =
        profile?.profileBannerUrl && isSafeHttpUrl(profile.profileBannerUrl)
            ? profile.profileBannerUrl
            : '';
    const profileMobileBannerUrl =
        profile?.profileMobileBannerUrl && isSafeHttpUrl(profile.profileMobileBannerUrl)
            ? profile.profileMobileBannerUrl
            : '';
    const hasDesktopProfileBanner = Boolean(profileBannerUrl && !profileBannerFailed);
    const hasMobileProfileBanner = Boolean(
        profileMobileBannerUrl && !profileMobileBannerFailed
    );
    const hasProfileBanner = hasDesktopProfileBanner || hasMobileProfileBanner;
    const hasBio = Boolean(profile?.bio?.trim());

    return (
        <div className="container mx-auto mt-8 p-4" style={profileAppearance.style}>
            <div
                className={`relative mb-8 min-h-[22rem] overflow-hidden rounded-2xl shadow-lg ${
                    hasProfileBanner ? '' : 'bg-white dark:bg-gray-800'
                }`}
                style={
                    hasProfileBanner
                        ? {
                            background: `linear-gradient(135deg, ${profileAppearance.hex}, ${profileAppearance.hoverHex})`,
                        }
                        : undefined
                }
            >
                {hasDesktopProfileBanner && (
                    <img
                        src={profileBannerUrl}
                        alt=""
                        onError={() => setProfileBannerFailed(true)}
                        className={`absolute inset-0 h-full w-full object-cover ${
                            hasMobileProfileBanner ? 'hidden lg:block' : 'block'
                        }`}
                    />
                )}
                {hasMobileProfileBanner && (
                    <img
                        src={profileMobileBannerUrl}
                        alt=""
                        onError={() => setProfileMobileBannerFailed(true)}
                        className="absolute inset-0 h-full w-full object-cover lg:hidden"
                    />
                )}
                {hasProfileBanner && (
                    <div className="absolute inset-0 hidden bg-gradient-to-r from-black/75 via-black/45 to-black/65 dark:block" />
                )}

                <div className="relative flex min-h-[22rem] items-start gap-3 p-5 sm:gap-6 sm:p-8">
                    <div className="hidden w-10 flex-shrink-0 sm:block" aria-hidden="true" />
                    <div className="min-w-0 flex-1 lg:self-stretch">
                        <div
                            className={
                                hasBio
                                    ? 'grid items-center gap-6 lg:h-full lg:grid-cols-3'
                                    : 'flex items-center justify-center lg:h-full'
                            }
                        >
                            <div
                                className={`relative mx-auto mt-10 flex w-full max-w-xs flex-col items-center rounded-[2rem] border-2 px-5 pb-6 pt-20 text-center shadow-xl backdrop-blur-md sm:mt-12 lg:mx-0 ${
                                    hasBio ? 'lg:col-start-1' : ''
                                } ${
                                    hasProfileBanner
                                        ? 'bg-black/35'
                                        : 'bg-gray-50/95 dark:bg-gray-900/60'
                                }`}
                                style={{ borderColor: themeHex }}
                            >
                                <ProfileImage
                                    src={profile?.profilePictureUrl}
                                    alt="Profile"
                                    className="absolute -top-14 left-1/2 h-28 w-28 -translate-x-1/2 rounded-full border-4 bg-white object-cover shadow-xl dark:bg-gray-800 sm:-top-16 sm:h-32 sm:w-32"
                                    style={{ borderColor: themeHex }}
                                />
                                <h2
                                    className={`text-3xl font-bold ${
                                        hasProfileBanner
                                            ? 'text-white drop-shadow-sm'
                                            : 'game-text'
                                    }`}
                                >
                                    {profile?.username || 'User Profile'}
                                </h2>
                                {profile?.country && (
                                    <p
                                        className={`mt-1 ${
                                            hasProfileBanner
                                                ? 'text-white/75'
                                                : 'text-gray-500 dark:text-gray-400'
                                        }`}
                                    >
                                        {profile.country}
                                    </p>
                                )}
                                {profile?.favoriteGame && (
                                    <p
                                        className="mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium capitalize shadow-sm"
                                        style={{
                                            backgroundColor: favoriteGameColor.hex,
                                            color: getTextColorForBackground(favoriteGameColor.hex),
                                        }}
                                    >
                                        {profile.favoriteGame.replace(/-/g, ' ')}
                                    </p>
                                )}

                                <div
                                    className={`mt-4 flex items-center justify-center gap-6 text-sm ${
                                        hasProfileBanner
                                            ? 'text-white'
                                            : 'text-gray-900 dark:text-gray-100'
                                    }`}
                                >
                                    <span>
                                        <span className="font-bold">{followerCount}</span>{' '}
                                        <span
                                            className={
                                                hasProfileBanner
                                                    ? 'text-white/70'
                                                    : 'text-gray-500 dark:text-gray-400'
                                            }
                                        >
                                            Followers
                                        </span>
                                    </span>
                                    <span>
                                        <span className="font-bold">
                                            {profile?.following?.length || 0}
                                        </span>{' '}
                                        <span
                                            className={
                                                hasProfileBanner
                                                    ? 'text-white/70'
                                                    : 'text-gray-500 dark:text-gray-400'
                                            }
                                        >
                                            Following
                                        </span>
                                    </span>
                                </div>

                                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                                    {user && user.uid === userId && (
                                        <button
                                            onClick={() => navigate('/profile/edit')}
                                            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                                                hasProfileBanner
                                                    ? 'border border-white/20 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25'
                                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                                            }`}
                                        >
                                            Edit Profile
                                        </button>
                                    )}
                                    {user && user.uid !== userId && (
                                        <button
                                            onClick={handleFollow}
                                            disabled={isFollowingBusy}
                                            className={`rounded-xl px-4 py-2 text-sm font-bold text-white transition disabled:opacity-50 ${
                                                isFollowing
                                                    ? hasProfileBanner
                                                        ? 'border border-white/20 bg-white/15 backdrop-blur-sm hover:bg-white/25'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                                                    : ''
                                            }`}
                                            style={
                                                isFollowing
                                                    ? {}
                                                    : { backgroundColor: themeHex }
                                            }
                                        >
                                            {isFollowing ? 'Following' : 'Follow'}
                                        </button>
                                    )}
                                    {user && user.uid !== userId && (
                                        <button
                                            onClick={handleReportUser}
                                            disabled={hasAlreadyReported}
                                            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {hasAlreadyReported ? 'Already Reported' : 'Report User'}
                                        </button>
                                    )}
                                    {userProfile?.role === 'admin' && user?.uid !== userId && (
                                        <button
                                            onClick={handleDeleteUser}
                                            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
                                        >
                                            Delete User
                                        </button>
                                    )}
                                </div>
                            </div>

                            {hasBio && (
                                <div
                                    className={`w-full max-w-sm place-self-center rounded-2xl border-2 p-5 text-left shadow-lg backdrop-blur-md sm:p-6 lg:col-span-2 lg:col-start-2 ${
                                        hasProfileBanner
                                            ? 'bg-black/35 text-white'
                                            : 'bg-gray-50/90 text-gray-700 dark:bg-gray-900/60 dark:text-gray-200'
                                    }`}
                                    style={{ borderColor: themeHex }}
                                >
                                    <p
                                        className={`mb-2 text-xs font-bold uppercase tracking-[0.18em] ${
                                            hasProfileBanner
                                                ? 'text-white/55'
                                                : 'text-gray-400 dark:text-gray-500'
                                        }`}
                                    >
                                        About
                                    </p>
                                    <p
                                        className={`whitespace-pre-wrap leading-relaxed ${
                                            hasProfileBanner ? 'text-white/90' : ''
                                        }`}
                                    >
                                        {profile.bio}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="mt-5 w-full overflow-x-auto pb-1 lg:hidden">
                            <ProfileLinks
                                activeSocials={activeSocials}
                                className="flex w-max min-w-full items-center justify-center gap-2 px-1"
                                hasProfileBanner={hasProfileBanner}
                                onShare={handleShare}
                                profile={profile}
                                themeHex={themeHex}
                            />
                        </div>
                    </div>

                    <ProfileLinks
                        activeSocials={activeSocials}
                        className="hidden flex-shrink-0 flex-col items-center gap-2 lg:flex"
                        hasProfileBanner={hasProfileBanner}
                        onShare={handleShare}
                        profile={profile}
                        themeHex={themeHex}
                    />
                </div>
            </div>

            <div style={{ '--theme-color': themeHex }}>
                <div className="my-6 flex justify-center">
                    <div className="relative flex items-center overflow-x-auto rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-700">
                        {['Creations', 'Showcases'].map((section) => (
                            <button
                                key={section}
                                onClick={() => setActiveSection(section)}
                                className={`relative z-10 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-300 sm:px-6 sm:text-base ${
                                    activeSection === section
                                        ? 'game-bg text-white'
                                        : 'text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white'
                                }`}
                            >
                                {section}
                            </button>
                        ))}
                    </div>
                </div>

                {activeSection === 'Creations' && (
                    <>
                        <div className="mb-6 flex justify-center">
                            <div className="relative flex items-center overflow-x-auto rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-700">
                                <div
                                    className="absolute h-full rounded-full transition-all duration-500 ease-in-out"
                                    style={{
                                        ...gliderStyle,
                                        backgroundColor: selectedGameColor.hex,
                                    }}
                                />
                                {TABS_WITH_ALL.map((tab, index) => (
                                    <button
                                        key={tab.id}
                                        ref={(element) => {
                                            tabRefs.current[index] = element;
                                        }}
                                        onClick={() => setSelectedGame(tab.id)}
                                        className={`relative z-10 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-300 sm:px-6 sm:text-base ${
                                            selectedGame === tab.id
                                                ? 'text-white'
                                                : 'text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white'
                                        }`}
                                    >
                                        {tab.name}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mx-auto w-full max-w-2xl">
                            <CommunityFilterBar
                                searchTerm={filterState.searchTerm}
                                onSearchChange={(value) =>
                                    handleFilterChange('searchTerm', value)
                                }
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
                        </div>
                    </>
                )}

                {/* Mobile: klebender Titel mit Pfeil zum Wechseln der beiden Panels.
                    Bewusst außerhalb des Swipe-Containers, damit position: sticky
                    relativ zum <main>-Scrollbereich klebt (der Swipe-Container ist
                    durch overflow-x selbst ein Scrollport und würde das brechen). */}
                <div className="sticky top-0 z-30 -mx-4 mb-4 flex items-center justify-center bg-gray-100 px-4 py-3 dark:bg-gray-900 lg:hidden">
                    {activePanel === 1 && (
                        <button
                            type="button"
                            onClick={() => scrollToPanel(0)}
                            aria-label="Show creations"
                            className="absolute left-4 flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                        >
                            <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                        </button>
                    )}
                    <h3 className="px-14 text-center text-2xl font-bold text-gray-800 dark:text-gray-100">
                        {activePanel === 0
                            ? activeSection === 'Showcases'
                                ? `Showcases featuring ${profile?.username || 'this user'}`
                                : `Creations by ${profile?.username || 'this user'}`
                            : 'Community Memberships'}
                    </h3>
                    {activePanel === 0 && (
                        <button
                            type="button"
                            onClick={() => scrollToPanel(1)}
                            aria-label="Show community memberships"
                            className="absolute right-4 flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                        >
                            <Icon path={ICONS.chevronRight} className="h-5 w-5" />
                        </button>
                    )}
                </div>

                <div
                    ref={contentSwipeRef}
                    onScroll={handleSwipeScroll}
                    className="profile-content-swipe -mx-4 flex snap-x snap-mandatory items-start overflow-x-auto lg:mx-0 lg:grid lg:snap-none lg:grid-cols-[minmax(0,3fr)_minmax(16rem,1fr)] lg:gap-8 lg:overflow-visible"
                >
                    <div className="w-full min-w-full flex-none snap-start px-4 lg:min-w-0 lg:flex-auto lg:px-0">
                        {activeSection === 'Creations' && (
                            <>
                                <h3 className="mb-4 hidden text-center text-2xl font-bold text-gray-800 dark:text-gray-100 lg:block">
                                    Creations by {profile?.username || 'this user'}
                                </h3>
                                {visibleCreations.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                                        {visibleCreations.map((creation) => (
                                            <CreationCard
                                                key={creation.id}
                                                creation={creation}
                                                accentBorderColor={themeHex}
                                                onTagClick={(tag) =>
                                                    handleFilterChange('tag', tag)
                                                }
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    !loadingInitialCreations && (
                                        <p className="mt-10 text-center text-gray-500">
                                            {creations.length > 0
                                                ? 'No creations match your filters.'
                                                : "This user hasn't created anything yet."}
                                        </p>
                                    )
                                )}
                                {loadingMoreCreations && (
                                    <div className="col-span-full p-8 text-center">
                                        <Spinner />
                                    </div>
                                )}
                                {!hasMoreCreations && creations.length > 0 && (
                                    <p className="col-span-full mt-10 text-center text-xl text-gray-500">
                                        You've seen all their creations!
                                    </p>
                                )}
                            </>
                        )}

                        {activeSection === 'Showcases' && (
                            <>
                                <h3 className="mb-4 hidden text-center text-2xl font-bold lg:block">
                                    Showcases featuring {profile?.username || 'this user'}
                                </h3>
                                {loadingShowcases || showcases === null ? (
                                    <div className="py-16">
                                        <Spinner />
                                    </div>
                                ) : showcases.length === 0 ? (
                                    <p className="rounded-lg bg-white py-10 text-center text-gray-500 shadow-md dark:bg-gray-800 dark:text-gray-400">
                                        This creator hasn't been featured in any showcases yet.
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                                        {showcases.map((showcase) => (
                                            <div
                                                key={showcase.key}
                                                className="overflow-hidden rounded-lg bg-white shadow-lg dark:bg-gray-800"
                                            >
                                                <a
                                                    href={showcase.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="group relative block h-44 overflow-hidden"
                                                >
                                                    <img
                                                        src={
                                                            getYoutubeThumbnailUrl(showcase.url) ||
                                                            'https://placehold.co/480x270/333333/ffffff?text=Video'
                                                        }
                                                        alt="Showcase video thumbnail"
                                                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                    />
                                                    {showcase.name && (
                                                        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-3 pb-6 pt-2">
                                                            <p
                                                                className="truncate text-center text-lg font-bold text-white"
                                                                title={showcase.name}
                                                            >
                                                                {showcase.name}
                                                            </p>
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 transition-colors group-hover:bg-red-600">
                                                            <div className="ml-1 h-0 w-0 border-y-8 border-l-[14px] border-y-transparent border-l-white" />
                                                        </div>
                                                    </div>
                                                </a>
                                                <div className="p-4">
                                                    <p className="mb-1 text-sm text-gray-500">
                                                        Showcased by
                                                    </p>
                                                    <p className="mb-2 text-lg font-bold">
                                                        {showcase.communityName}
                                                    </p>
                                                    <div className="space-y-1">
                                                        {showcase.creations.map((creation) => (
                                                            <Link
                                                                key={creation.id}
                                                                to={`/creation/${creation.id}`}
                                                                className="block truncate text-sm text-blue-600 hover:underline"
                                                                title={creation.title}
                                                            >
                                                                {creation.title}
                                                            </Link>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <aside className="w-full min-w-full flex-none snap-start px-4 lg:min-w-0 lg:flex-auto lg:px-0">
                        <div className="lg:sticky lg:top-24">
                            <h3 className="mb-4 hidden text-center text-2xl font-bold text-gray-800 dark:text-gray-100 lg:block">
                                Community Memberships
                            </h3>
                            <div className="space-y-6">
                                {memberships.length > 0 ? (
                                    memberships.map((membership) => (
                                        <CommunityMembershipCard
                                            key={membership.communityId}
                                            membership={membership}
                                        />
                                    ))
                                ) : (
                                    <p className="rounded-lg bg-white p-4 text-gray-500 shadow-md dark:bg-gray-800 dark:text-gray-400">
                                        This user is not a member of any communities.
                                    </p>
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default ProfilePage;
