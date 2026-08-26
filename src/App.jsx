import React, { useState, useEffect, useRef, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter, Navigate, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { signOut, onAuthStateChanged, sendEmailVerification } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { auth, authPersistenceReady, db, isConfigured } from './firebase/config';
import { enablePush, getPushPermission } from './firebase/push';
import { isStandalone } from './utils/pwaInstall';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PreloadLink from './components/ui/PreloadLink';
import { preloadCriticalComponents } from './utils/preload';
import lazyWithReload from './utils/lazyWithReload';
import { isSafeHttpUrl } from './utils/helpers';
import { watchSystemTheme } from './utils/theme';
import { getReportableContent } from './utils/contentReporting';
import { usesHashRouting } from './utils/routingMode';

import Navbar from './components/ui/Navbar';
import Modal from './components/ui/Modal';
import ConfirmationModal from './components/ui/ConfirmationModal';
import ExternalLinkModal from './components/ui/ExternalLinkModal';
import Spinner from './components/ui/Spinner';
import FloatingActionButton from './components/ui/FloatingActionButton';
import ToggleViewButton from './components/ui/ToggleViewButton';
import PasswordConfirmationModal from './components/ui/PasswordConfirmationModal';
import ReportModal from './components/ui/ReportModal';
import StrikeModal from './components/ui/StrikeModal';
import PopoverModal from './components/ui/PopoverModal';
import RickRollModal from './components/modals/RickRollModal';
import { GameOverlayWidget, GameOverlayChrome } from './components/ui/GameOverlay';
import StreamManagement from './components/streaming/StreamManagement';
import OverlayNotificationPopover from './components/streaming/OverlayNotificationPopover';

import ErrorBoundary from './components/ErrorBoundary';
import PrivacyPrompt from './components/modals/PrivacyPrompt';
import BugReportModal from './components/modals/BugReportModal';
import GoLiveModal from './components/modals/GoLiveModal';
import { readLiveSession, setLiveSession } from './utils/liveStream';
import { readOverlayQr, setOverlayQr, subscribeOverlayQr, buildCreationShareUrl } from './utils/overlayQr';
import { buildOverlayShowcaseEntry, isOverlayShowcaseEntry } from './utils/overlayShowcase';
import {
    generalOverlayNotificationsMuted,
    readGeneralOverlayNotificationPrefs,
    readStreamSession,
    setStreamSession,
    subscribeStreamSession,
} from './utils/streamSession';
import {
    endBuildSession,
    fetchUserCollaborationsForGame,
} from './firebase/collaboration';
import { endRememberedCollaborationBuild } from './utils/collaborationBuildSession';
import {
    findCollaborationVersionUpdates,
    readInstalledCollaborationVersions,
} from './utils/collaborationVersionUpdates';
import { dispatchCollaborationAvailable } from './utils/collaborationAvailability';
import { registerQueryClient } from './utils/appRefresh';
import ProfileSetupWizard from './components/modals/ProfileSetupWizard';
import useInterestSync from './hooks/useInterestSync';
import useMicroInteractionFeedback from './hooks/useMicroInteractionFeedback';
import { loadGamesRegistry, getDefaultGameId, getGame } from './utils/gamesRegistry';
import ClientDashboard from './components/pages/ClientDashboard';
import {
    COMMUNITY_GUIDELINES,
    MINIMUM_AGE_NOTICE,
    PRIVACY_POLICY,
    TERMS_OF_SERVICE_FALLBACK,
} from './content/legalContent';

const HomePage = lazyWithReload(() => import('./components/pages/HomePage'));
const AuthPage = lazyWithReload(() => import('./components/pages/AuthPage'));
const ProfilePage = lazyWithReload(() => import('./components/pages/ProfilePage'));
const EditProfilePage = lazyWithReload(() => import('./components/pages/EditProfilePage'));
const SettingsPage = lazyWithReload(() => import('./components/pages/SettingsPage'));
const CreationForm = lazyWithReload(() => import('./components/pages/CreationForm'));
const CreationDetail = lazyWithReload(() => import('./components/pages/CreationDetail'));
const AdminPage = lazyWithReload(() => import('./components/pages/AdminPage'));
const ModerationPage = lazyWithReload(() => import('./components/pages/ModerationPage'));
const CommunitysPage = lazyWithReload(() => import('./components/pages/CommunitysPage'));
const CreateCommunityForm = lazyWithReload(() => import('./components/pages/CreateCommunityForm'));
const CommunityDetailPage = lazyWithReload(() => import('./components/pages/CommunityDetailPage'));
const ShowcasePage = lazyWithReload(() => import('./components/pages/ShowcasePage'));
const OverlayShowcasePage = lazyWithReload(() => import('./components/pages/OverlayShowcasePage'));
const CommunityManagerPage = lazyWithReload(() => import('./components/pages/CommunityManagerPage'));
const EventDetailPage = lazyWithReload(() => import('./components/pages/EventDetailPage'));
const EventForm = lazyWithReload(() => import('./components/pages/EventForm'));
const EventManager = lazyWithReload(() => import('./components/management/EventManager'));
const LegalPage = lazyWithReload(() => import('./components/pages/LegalPage'));
const ClientInfoPage = lazyWithReload(() => import('./components/pages/ClientInfoPage'));
const CollaborationDetailPage = lazyWithReload(() => import('./components/pages/CollaborationDetailPage'));
const CreateCollaborationForm = lazyWithReload(() => import('./components/pages/CreateCollaborationForm'));
const JoinCollaborationPage = lazyWithReload(() => import('./components/pages/JoinCollaborationPage'));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Daten bleiben für die gesamte Session "fresh" (30 Minuten)
            staleTime: 1000 * 60 * 30,
            // Daten bleiben für 1 Stunde im Cache (auch wenn nicht mehr verwendet)
            gcTime: 1000 * 60 * 60,
            // Nicht automatisch neu laden beim Fensterfokus
            refetchOnWindowFocus: false,
            // Nicht automatisch neu laden bei Reconnect
            refetchOnReconnect: false,
            // Bei Fehler nicht automatisch wiederholen
            retry: 1,
        },
    },
});

// Ermöglicht scheduleDataRefresh() aus beliebigen Save-Handlern ohne Hook/Props.
registerQueryClient(queryClient);

const RouteCanonicalMetadata = () => {
    const location = useLocation();

    useEffect(() => {
        if (usesHashRouting()) return;
        const canonicalUrl = new URL(
            location.pathname,
            'https://www.planetcreations.net'
        ).toString();
        document.querySelector('link[rel="canonical"]')
            ?.setAttribute('href', canonicalUrl);
        document.querySelector('meta[property="og:url"]')
            ?.setAttribute('content', canonicalUrl);
    }, [location.pathname]);

    return null;
};

const AppContent = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const isStoreBuild = window.electronAPI?.isStoreBuild === true;
    const isGameOverlay = Boolean(window.electronAPI?.isGameOverlay);
    const isStreamManagement = Boolean(window.electronAPI?.isStreamManagement);
    const isAuxiliaryWindow = isGameOverlay || isStreamManagement;
    const [isOverlayExpanded, setIsOverlayExpanded] = useState(false);
    const [activeGameId, setActiveGameId] = useState(null);
    const [streamSessionMirror, setStreamSessionMirror] = useState(() => readStreamSession());
    const streamSessionMirrorRef = useRef(readStreamSession());
    const [streamStartContext, setStreamStartContext] = useState(null);
    const [localClientIdentity, setLocalClientIdentity] = useState(null);
    const isOfflineMode = location.pathname.startsWith('/client');
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loadingAuth, setLoadingAuth] = useState(true);
    const [modalMessage, setModalMessage] = useState(null);
    const [confirmation, setConfirmation] = useState(null);
    const [passwordConfirm, setPasswordConfirm] = useState(null);
    const [reportModal, setReportModal] = useState(null);
    const [strikeModal, setStrikeModal] = useState(null);
    const [externalLink, setExternalLink] = useState(null);
    const [popoverView, setPopoverView] = useState(null);
    const [activeTab, setActiveTab] = useState(getDefaultGameId());
    const [blacklist, setBlacklist] = useState([]);
    const [showRickRoll, setShowRickRoll] = useState(false);
    const [isBugReportOpen, setIsBugReportOpen] = useState(false);
    const [profileWizardDismissed, setProfileWizardDismissed] = useState(false);
    const [wizardLeaveSignal, setWizardLeaveSignal] = useState(0);

    // While the user follows the OS setting (no explicit theme choice), apply live
    // dark/light changes from the system.
    useEffect(() => watchSystemTheme(), []);
    useMicroInteractionFeedback();
    
    const [homeState, setHomeState] = useState({
        searchTerm: '', filterTag: '', sortBy: 'recommended', activeCategory: 'All',
        showModsOnly: false, platformFilter: 'all', dlcFilterMode: 'all', selectedDlcs: []
    });

    // Interessen-Sync (Personalisierung): hydriert bei Login, flusht beim
    // Verlassen, triggert einmalig das Opt-in-Popover.
    // needsConsentPrompt/das alte Consent-Popover entfällt: die Personalisierungs-
    // Frage ist jetzt Teil des Profil-Setup-Wizards (Feed-Schritt).
    const { answerConsent } = useInterestSync(user);

    const [communitysState, setCommunitysState] = useState({
        searchTerm: '', sortBy: 'memberCount', activeTab: 'Browser', activeGameFilter: 'all',
    });

    const [notifications, setNotifications] = useState([]);
    const knownNotificationIdsRef = useRef(new Set());
    const notificationInboxInitializedRef = useRef(false);
    const clientQueueProcessingRef = useRef(false);
    const clientQueueRetryTimerRef = useRef(null);
    const lastRemoteOverlayQrRef = useRef(null);
    const collaborationUpdateOfferRef = useRef('');
    const [goLivePrompt, setGoLivePrompt] = useState(null);
    const [showVerificationBanner, setShowVerificationBanner] = useState(false);

    useEffect(() => subscribeStreamSession((session) => {
        streamSessionMirrorRef.current = session;
        setStreamSessionMirror(session);
    }), []);

    useEffect(() => {
        if (isAuxiliaryWindow || !window.electronAPI?.syncStreamManagementSession) return;
        window.electronAPI.syncStreamManagementSession(streamSessionMirror).catch(() => {});
    }, [isAuxiliaryWindow, streamSessionMirror]);

    useEffect(() => {
        if (!isStreamManagement) return undefined;
        let cancelled = false;
        Promise.all([
            window.electronAPI?.getStreamStartContext?.(),
            window.electronAPI?.getClientIdentity?.(),
        ]).then(([context, identity]) => {
            if (cancelled) return;
            setStreamStartContext(context || null);
            setLocalClientIdentity(identity || null);
        }).catch(() => {});
        const unsubscribe = window.electronAPI?.onStreamManagementContextChanged?.((context) => {
            setStreamStartContext(context || null);
        });
        return () => {
            cancelled = true;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [isStreamManagement]);

    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateDownloaded, setUpdateDownloaded] = useState(false);

    useEffect(() => {
        if (!isAuxiliaryWindow) return undefined;
        document.documentElement.classList.add(isGameOverlay ? 'game-overlay-window' : 'stream-management-window');
        const unsubscribe = window.electronAPI?.onOverlayModeChanged?.(setIsOverlayExpanded);
        let disposed = false;
        if (isGameOverlay) {
            window.electronAPI?.getOverlayExpanded?.()
                .then((expanded) => {
                    if (!disposed) setIsOverlayExpanded(Boolean(expanded));
                })
                .catch(() => {});
        }
        return () => {
            disposed = true;
            document.documentElement.classList.remove('game-overlay-window', 'stream-management-window');
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [isAuxiliaryWindow, isGameOverlay]);

    useEffect(() => {
        if (!isAuxiliaryWindow || !window.electronAPI?.getActiveGame) return undefined;
        let cancelled = false;
        window.electronAPI.getActiveGame()
            .then((gameId) => { if (!cancelled) setActiveGameId(gameId || null); })
            .catch(() => {});
        const unsubscribe = window.electronAPI.onActiveGameChanged?.((gameId) => {
            setActiveGameId(gameId || null);
        });
        return () => {
            cancelled = true;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [isAuxiliaryWindow]);

    useEffect(() => {
        if (!isGameOverlay || !user?.uid || !activeGameId ||
            !window.electronAPI?.setOverlayExpanded) {
            if (!activeGameId) collaborationUpdateOfferRef.current = '';
            return undefined;
        }
        let cancelled = false;
        const checkForCollaborationUpdates = async () => {
            try {
                const collaborations = await fetchUserCollaborationsForGame(
                    user.uid,
                    activeGameId,
                );
                const updates = findCollaborationVersionUpdates(
                    collaborations,
                    readInstalledCollaborationVersions(user.uid),
                );
                if (cancelled || updates.length === 0) return;
                const signature = [
                    user.uid,
                    activeGameId,
                    ...updates.map((update) => (
                        `${update.collaborationId}:${update.currentVersion.versionId}`
                    )),
                ].join('|');
                if (collaborationUpdateOfferRef.current === signature) return;
                collaborationUpdateOfferRef.current = signature;
                const expanded = await window.electronAPI.setOverlayExpanded(true);
                if (!cancelled && expanded) setIsOverlayExpanded(true);
            } catch (error) {
                console.warn(
                    'Could not check collaboration versions at game start:',
                    error.message,
                );
            }
        };
        checkForCollaborationUpdates();
        window.addEventListener('online', checkForCollaborationUpdates);
        return () => {
            cancelled = true;
            window.removeEventListener('online', checkForCollaborationUpdates);
        };
    }, [activeGameId, isGameOverlay, user?.uid]);

    useEffect(() => {
        if (!isGameOverlay || !isOverlayExpanded) return undefined;
        const openActiveShowcase = (entry) => {
            if (isOverlayShowcaseEntry(entry) && location.pathname !== '/overlay/showcase') {
                navigate('/overlay/showcase');
            }
        };
        openActiveShowcase(readOverlayQr());
        return subscribeOverlayQr(openActiveShowcase);
    }, [isGameOverlay, isOverlayExpanded, location.pathname, navigate]);

    useEffect(() => {
        if (isGameOverlay || !user?.uid || !window.electronAPI?.onGameProcessStopped) return undefined;

        const endRememberedBuild = async (gameId, pendingOnly = false) => {
            try {
                const result = await endRememberedCollaborationBuild({
                    userId: user.uid,
                    gameId,
                    pendingOnly,
                    endSession: (
                        collaborationId,
                        endedAtMillis,
                        buildDraft,
                        buildSessionId,
                    ) => endBuildSession(
                        collaborationId,
                        false,
                        endedAtMillis,
                        buildDraft,
                        buildSessionId,
                    ),
                });
                if (result.ended && result.collaborationId) {
                    await window.electronAPI.showMainWindow?.();
                    navigate(`/collaboration/${result.collaborationId}`, {
                        state: {
                            openChangelog: true,
                            source: 'build-ended',
                            changelogEntryId: result.changelogEntryId || null,
                            changelogUserId: result.changelogUserId || user.uid,
                            username: result.username || null,
                            createdAtMillis: result.createdAtMillis || Date.now(),
                            changelog: result.changelog ||
                                result.buildDraft?.changelog ||
                                '',
                            completedTodos: result.completedTodos ||
                                result.buildDraft?.completedTodos ||
                                [],
                        },
                    });
                }
                return result;
            } catch (error) {
                // The local pending marker intentionally survives retryable failures.
                console.warn('Collaboration auto-logoff is pending:', error.message);
                return null;
            }
        };

        // Retry a previous offline/crash-assisted logoff at boot and whenever the
        // renderer comes back online. This is still event-driven: no heartbeat.
        endRememberedBuild(undefined, true);
        const handleOnline = () => endRememberedBuild(undefined, true);
        window.addEventListener('online', handleOnline);
        const unsubscribe = window.electronAPI.onGameProcessStopped(({ gameId } = {}) => {
            if (gameId) endRememberedBuild(gameId);
        });
        return () => {
            window.removeEventListener('online', handleOnline);
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [isGameOverlay, navigate, user?.uid]);

    useEffect(() => {
        if (!window.electronAPI?.isHostedWebView) return;
        // This is a compatibility floor, not a Workshop release counter. Keep it
        // at v1 for web-only, Functions and rules changes. Raise it only when the
        // hosted Workshop unavoidably needs a native API that older clients lack;
        // prefer capability detection and adapters such as the legacy upload path.
        const minimumBridgeVersion = 1;
        window.electronAPI.reportHostedUiReady?.({
            uiVersion: 2,
            minimumBridgeVersion,
            gameOverlay: true,
            offlineManagerVersion: 1,
            minimumOfflineManagerBridgeVersion: 3,
        }).catch(() => {});
        const availableBridgeVersion = Number(window.electronAPI.bridgeVersion ?? 1);
        if (availableBridgeVersion < minimumBridgeVersion) {
            window.electronAPI.switchDesktopMode?.('bundled-online').catch(() => {
                setModalMessage('This desktop client is too old for the current online interface. Please install the latest client update.');
            });
        }
    }, []);

    useEffect(() => {
        if (!isOfflineMode || isAuxiliaryWindow || !window.electronAPI?.isHostedWebView) return;
        if (Number(window.electronAPI.hostedOfflineManagerVersion || 0) >= 1) return;
        window.electronAPI.switchDesktopMode?.('offline').catch((error) => {
            console.error('Could not hand off to the bundled Offline Manager:', error);
        });
    }, [isAuxiliaryWindow, isOfflineMode]);

    useEffect(() => {
        if (isOfflineMode) {
            document.documentElement.style.overflow = 'hidden';
        } else {
            document.documentElement.style.overflow = 'auto';
        }
    }, [isOfflineMode]);

    // Spiele-Registry (meta/games) einmal beim Boot laden; bis dahin rendert
    // die App mit dem localStorage-Spiegel bzw. dem eingebauten Fallback.
    useEffect(() => {
        if (isConfigured) loadGamesRegistry();
    }, []);

    useEffect(() => {
        if (!isConfigured) { setLoadingAuth(false); return; }
        let authListenerDisposed = false;
        let authUnsubscribe = () => {};
        let notificationUnsubscribe = () => {};
        authPersistenceReady.then(() => {
            if (authListenerDisposed) return;
            authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            knownNotificationIdsRef.current = new Set();
            notificationInboxInitializedRef.current = false;
            if (currentUser && currentUser.isAnonymous) {
                await signOut(auth);
                setUser(null); setUserProfile(null); setNotifications([]); setActiveTab(getDefaultGameId()); setLoadingAuth(false);
                return;
            }
            setShowVerificationBanner(currentUser && !currentUser.emailVerified);
            setUser(currentUser);
            notificationUnsubscribe();
            if (currentUser) {
                try {
                    const userRef = doc(db, 'users', currentUser.uid);
                    const profileRef = doc(db, 'profiles', currentUser.uid);
                    const [userDoc, profileDoc] = await Promise.all([getDoc(userRef), getDoc(profileRef)]);
                    if (profileDoc.exists()) {
                        const combinedProfile = { uid: currentUser.uid, ...profileDoc.data(), ...(userDoc.exists() ? userDoc.data() : {}) };
                        if (combinedProfile.role === 'banned') {
                            setModalMessage("You have been banned from this platform.");
                            signOut(auth); setLoadingAuth(false); return;
                        }
                        setUserProfile(combinedProfile);
                        // Firestore rules gate on the token's custom `role` claim, which can lag
                        // behind a role change (e.g. just promoted to influencer) until the token
                        // refreshes. If the claim disagrees with the profile role, force a refresh
                        // so rule checks see the new role immediately.
                        try {
                            const tokenResult = await currentUser.getIdTokenResult();
                            if ((tokenResult.claims.role || 'user') !== (combinedProfile.role || 'user')) {
                                await currentUser.getIdToken(true);
                            }
                        } catch (e) { /* ignore token refresh errors */ }
                        // favoriteGame eines entfernten/deaktivierten Spiels fällt aufs Default zurück
                        if (combinedProfile.favoriteGame && getGame(combinedProfile.favoriteGame)?.enabled !== false && getGame(combinedProfile.favoriteGame)) {
                            setActiveTab(combinedProfile.favoriteGame);
                            const savedPreference = combinedProfile.platformPreferences?.[combinedProfile.favoriteGame];
                            if (savedPreference) { setHomeState(prev => ({ ...prev, platformFilter: savedPreference })); }
                        } else { setActiveTab(getDefaultGameId()); }
                    } else {
                        setUserProfile({ uid: currentUser.uid, role: 'user' });
                        setActiveTab(getDefaultGameId());
                    }
                    // Single capped inbox doc: 1 read loads the whole bell, and
                    // items are already stored newest-first (server prepends).
                    const inboxRef = doc(db, 'users', currentUser.uid, 'meta', 'inbox');
                    notificationUnsubscribe = onSnapshot(inboxRef, (snap) => {
                        const nextNotifications = snap.exists() ? (snap.data().items || []) : [];
                        const nextIds = new Set(nextNotifications.map(item => item?.id).filter(Boolean));
                        const incomingNotifications =
                            notificationInboxInitializedRef.current
                                ? nextNotifications.filter((item) => (
                                    item?.id &&
                                    !knownNotificationIdsRef.current.has(item.id)
                                ))
                                : [];

                        if (!isAuxiliaryWindow && notificationInboxInitializedRef.current && window.electronAPI?.showSystemNotification) {
                            incomingNotifications
                                .filter(item => !item.isRead)
                                .slice(0, 5)
                                .reverse()
                                .forEach(item => {
                                    window.electronAPI.showSystemNotification({
                                        title: item.title || 'PlanetCreations',
                                        body: item.message || '',
                                        link: item.link || (item.creationId ? `/creation/${item.creationId}` : '/'),
                                    }).catch(error => console.warn('Could not show system notification:', error));
                                    const overlayPrefs = readGeneralOverlayNotificationPrefs();
                                    if (!generalOverlayNotificationsMuted(overlayPrefs, Date.now(), streamSessionMirrorRef.current?.sessionId || null)) {
                                        window.electronAPI.showOverlayNotification?.({
                                            id: item.id,
                                            title: item.title || 'PlanetCreations',
                                            message: item.message || '',
                                            link: item.link || (item.creationId ? `/creation/${item.creationId}` : '/'),
                                        }).catch(() => {});
                                    }
                                });
                        }
                        incomingNotifications.forEach(
                            dispatchCollaborationAvailable,
                        );

                        knownNotificationIdsRef.current = nextIds;
                        notificationInboxInitializedRef.current = true;
                        setNotifications(nextNotifications);
                    });
                } catch (error) {
                    console.error('Error fetching user profile:', error);
                    setModalMessage(`Error: ${error.message}`);
                    setUserProfile(null);
                }
            } else {
                setUserProfile(null); setNotifications([]); setActiveTab(getDefaultGameId());
            }
                setLoadingAuth(false);
            });
        });
        const blacklistRef = doc(db, 'meta', 'blacklist');
        const unsubBlacklist = onSnapshot(blacklistRef, (docSnap) => {
            if (docSnap.exists()) { setBlacklist(docSnap.data().words || []); } else { setBlacklist([]); }
        });

        if (window.electronAPI) {
            window.electronAPI.onUpdateInfoAvailable?.((info) => {
                setUpdateInfo(info);
            });
            window.electronAPI.onUpdateDownloaded?.(() => {
                setUpdateInfo(null);
                setUpdateDownloaded(true);
            });
            // NEUER LISTENER FÜR URL-IMPORT
            window.electronAPI.onBackupImportStatus((status) => {
                setModalMessage(status.message);
            });
        }

        // Kritische Komponenten nach App-Start vorladen
        preloadCriticalComponents();

        return () => {
            authListenerDisposed = true;
            authUnsubscribe();
            notificationUnsubscribe();
            unsubBlacklist();
        };
    }, [isAuxiliaryWindow]);

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onNavigateToRoute?.((route) => navigate(route));
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
    }, [navigate]);

    useEffect(() => {
        if (isAuxiliaryWindow || !user || !window.electronAPI?.getClientIdentity || !window.electronAPI?.installQueuedCreation) return;
        let cancelled = false;
        let queueUnsubscribe = () => {};
        const functions = getFunctions();
        const registerDesktopClient = httpsCallable(functions, 'registerDesktopClient');
        const claimClientInstall = httpsCallable(functions, 'claimClientInstall');
        const completeClientInstall = httpsCallable(functions, 'completeClientInstall');
        const getBackupDownloadUrl = httpsCallable(functions, 'getBackupDownloadUrl');

        const scheduleQueueRetry = (processQueue, retryAt) => {
            if (!retryAt || cancelled) return;
            if (clientQueueRetryTimerRef.current) clearTimeout(clientQueueRetryTimerRef.current);
            const delay = Math.max(1000, Math.min(retryAt - Date.now(), 15 * 60 * 1000));
            clientQueueRetryTimerRef.current = setTimeout(processQueue, delay);
        };

        const start = async () => {
            try {
                const identity = await window.electronAPI.getClientIdentity();
                if (cancelled) return;
                await registerDesktopClient(identity);
                if (cancelled) return;

                const processQueue = async () => {
                    if (cancelled || clientQueueProcessingRef.current) return;
                    if (clientQueueRetryTimerRef.current) {
                        clearTimeout(clientQueueRetryTimerRef.current);
                        clientQueueRetryTimerRef.current = null;
                    }
                    clientQueueProcessingRef.current = true;
                    let installedCount = 0;
                    let failedCount = 0;
                    let nextRetryAt = null;
                    try {
                        while (!cancelled) {
                            const claimResult = await claimClientInstall({ clientId: identity.clientId });
                            if (cancelled) break;
                            const command = claimResult.data?.command;
                            if (!command) {
                                nextRetryAt = claimResult.data?.nextAttemptAt || null;
                                break;
                            }

                            let installResult;
                            try {
                                const urlResult = await getBackupDownloadUrl({ creationId: command.creationId });
                                const creationSnapshot = await getDoc(doc(db, 'creations', command.creationId));
                                const creationData = creationSnapshot.exists() ? creationSnapshot.data() : {};
                                installResult = await window.electronAPI.installQueuedCreation({
                                    creationId: command.creationId,
                                    downloadUrl: urlResult.data.downloadUrl,
                                    title: creationData.title || '',
                                    previewUrl: creationData.imageUrls?.[0] || '',
                                });
                            } catch (error) {
                                installResult = { success: false, permanent: false, message: error.message };
                            }

                            const completion = await completeClientInstall({
                                clientId: identity.clientId,
                                commandId: command.id,
                                success: installResult?.success === true,
                                permanent: installResult?.permanent === true,
                                message: installResult?.message || '',
                            });
                            if (installResult?.success) installedCount++;
                            else if (completion.data?.removed) failedCount++;
                            if (completion.data?.retryAt) {
                                nextRetryAt = !nextRetryAt ? completion.data.retryAt :
                                    Math.min(nextRetryAt, completion.data.retryAt);
                            }
                        }
                    } catch (error) {
                        console.error('Could not process the client install queue:', error);
                        nextRetryAt = Date.now() + 60 * 1000;
                    } finally {
                        clientQueueProcessingRef.current = false;
                    }

                    if (!cancelled && (installedCount > 0 || failedCount > 0)) {
                        const installedText = `${installedCount} creation${installedCount === 1 ? '' : 's'} installed`;
                        const failedText = failedCount > 0 ? `, ${failedCount} failed` : '';
                        window.electronAPI.showSystemNotification({
                            title: 'Direct install queue processed',
                            body: `${installedText}${failedText}.`,
                            link: '/client/dashboard',
                        }).catch(() => {});
                    }
                    scheduleQueueRetry(processQueue, nextRetryAt);
                };

                const queueRef = doc(db, 'clientInstallQueues', user.uid, 'clients', identity.clientId);
                queueUnsubscribe = onSnapshot(queueRef, (snapshot) => {
                    const data = snapshot.data() || {};

                    // Stream management piggybacks on the existing protected
                    // per-device queue used for QR synchronization. The local
                    // mirror/BroadcastChannel fans the compact state out to the
                    // overlay and manager windows without another Firestore listener.
                    const nextStreamSession = data.streamSession || null;
                    setStreamSession(nextStreamSession);
                    window.electronAPI?.syncStreamManagementSession?.(nextStreamSession).catch(() => {});

                    // Remote-Overlay-QR (setClientOverlayQr): das Feld auf dem
                    // Queue-Doc ist das Zustellmedium — 0 Extra-Reads, weil dieser
                    // Listener sowieso läuft. Angewendet wird nur bei Änderung,
                    // damit lokale Toggles nicht von jedem Queue-Update
                    // überschrieben werden; Feld-Abwesenheit räumt ausschließlich
                    // remote gesetzte QRs ab (manuell/goLive bleiben unberührt).
                    const remoteQr = data.overlayQr || null;
                    const remoteSetAt = remoteQr?.setAt?.toMillis?.() || 0;
                    const serialized = remoteQr ? JSON.stringify({
                        k: remoteQr.kind || '',
                        c: remoteQr.creationId,
                        t: remoteQr.title || '',
                        community: remoteQr.communityId || '',
                        showcase: remoteQr.showcaseId || '',
                        creations: remoteQr.creationIds || [],
                        active: remoteQr.activeCreationId || '',
                        setAt: remoteSetAt,
                    }) : null;
                    if (remoteQr?.creationId) {
                        if (serialized !== lastRemoteOverlayQrRef.current) {
                            if (remoteQr.kind === 'community-showcase' && Array.isArray(remoteQr.creationIds)) {
                                const current = readOverlayQr();
                                const sameStoredShowcase = isOverlayShowcaseEntry(current) &&
                                    current.communityId === remoteQr.communityId &&
                                    current.showcaseId === (remoteQr.showcaseId || '') &&
                                    current.creationIds.join('\u001f') === remoteQr.creationIds.join('\u001f') &&
                                    (!remoteSetAt || remoteSetAt <= (current.enabledAt || 0));
                                const preferredActiveId = sameStoredShowcase &&
                                    remoteQr.creationIds.includes(current.activeCreationId) ?
                                    current.activeCreationId : (remoteQr.activeCreationId || remoteQr.creationId);
                                const nextEntry = buildOverlayShowcaseEntry({
                                    communityId: remoteQr.communityId,
                                    showcaseId: remoteQr.showcaseId || '',
                                    showcaseTitle: remoteQr.showcaseTitle || '',
                                    creations: remoteQr.creationIds.map(creationId => ({
                                        id: creationId,
                                        title: creationId === preferredActiveId && sameStoredShowcase ?
                                            current.title : (creationId === remoteQr.creationId ? remoteQr.title : ''),
                                    })),
                                    activeCreationId: preferredActiveId,
                                    source: 'remote',
                                    enabledAt: remoteSetAt || Date.now(),
                                });
                                setOverlayQr(nextEntry);
                            } else {
                                setOverlayQr({
                                    creationId: remoteQr.creationId,
                                    title: remoteQr.title || '',
                                    url: buildCreationShareUrl(remoteQr.creationId),
                                    source: 'remote',
                                    enabledAt: remoteSetAt || Date.now(),
                                });
                            }
                        }
                    } else if (readOverlayQr()?.source === 'remote') {
                        setOverlayQr(null);
                    }
                    lastRemoteOverlayQrRef.current = serialized;

                    // Ein Stream kann auf einem anderen Gerät oder durch den
                    // serverseitigen Sweep beendet werden. In diesem Fall muss
                    // auch ein lokal/goLive gesetzter QR auf diesem Client zum
                    // Logo zurückwechseln. Der Zeitvergleich verhindert, dass
                    // ein alter Clear-Befehl einen später neu aktivierten QR löscht.
                    const clearCommand = data.overlayQrClear || null;
                    const clearAt = clearCommand?.setAt?.toMillis?.() || 0;
                    const currentQr = readOverlayQr();
                    if (currentQr?.creationId && clearAt >= (currentQr.enabledAt || 0) &&
                        (clearCommand.creationIds || []).includes(currentQr.creationId)) {
                        setOverlayQr(null);
                    }

                    if ((data.items || []).length > 0) processQueue();
                }, (error) => console.error('Could not listen for direct install commands:', error));
            } catch (error) {
                console.error('Could not register this desktop client:', error);
                if (error.code === 'functions/resource-exhausted' || error.code === 'functions/failed-precondition') {
                    setModalMessage(`Desktop client registration failed: ${error.message}`);
                } else if (!cancelled) {
                    clientQueueRetryTimerRef.current = setTimeout(start, 60 * 1000);
                }
            }
        };

        start();
        return () => {
            cancelled = true;
            queueUnsubscribe();
            if (clientQueueRetryTimerRef.current) {
                clearTimeout(clientQueueRetryTimerRef.current);
                clientQueueRetryTimerRef.current = null;
            }
            clientQueueProcessingRef.current = false;
        };
    }, [user, setModalMessage, isAuxiliaryWindow]);

    // OBS-Integration (Desktop-Client ab 1.0.23): Stream-Start öffnet das
    // Go-Live-Popup, Stream-Ende beendet die Live-Session server-seitig.
    // Ohne Bridge (alter Client / Browser) ist dieser Effekt ein No-op.
    useEffect(() => {
        if (isAuxiliaryWindow || !user || !window.electronAPI?.onObsStreamStarted) return undefined;
        const unsubStart = window.electronAPI.onObsStreamStarted((payload) => {
            if (readLiveSession()) return; // bereits mit einer Creation live
            if (payload?.openInStreamManagement) return;
            setGoLivePrompt({ service: payload?.service || null });
        });
        const unsubStop = window.electronAPI.onObsStreamStopped?.(async () => {
            setGoLivePrompt(null);
            const session = readLiveSession();
            if (!session) return;
            setLiveSession(null);
            setStreamSession(null);
            if (readOverlayQr()?.creationId === session.creationId) setOverlayQr(null);
            try {
                await httpsCallable(getFunctions(), 'endLive')({ creationId: session.creationId });
            } catch (error) {
                // Netz: der Server-Sweep beendet verwaiste Sessions von selbst.
                console.warn('Could not end the live session automatically:', error);
            }
        });
        return () => {
            if (typeof unsubStart === 'function') unsubStart();
            if (typeof unsubStop === 'function') unsubStop();
        };
    }, [isAuxiliaryWindow, user]);

    // Installed PWA: ask for notification permission automatically on first open.
    // If dismissed, the user can re-enable from Settings or the install dialog.
    useEffect(() => {
        if (!user || !isStandalone()) return;
        // First-login users get the push prompt inside the setup wizard instead.
        if (userProfile?.needsProfileSetup) return;
        if (getPushPermission() !== 'default') return;
        const flag = `pushAutoPrompted-${user.uid}`;
        if (localStorage.getItem(flag)) return;
        localStorage.setItem(flag, '1');
        enablePush(user.uid).catch(() => {});
    }, [user, userProfile?.needsProfileSetup]);

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            setModalMessage(`Error logging out: ${error.message}`);
        }
    };

    const handleResendVerification = async () => {
        if (user) {
            try {
                await sendEmailVerification(user);
                setModalMessage("A new verification email has been sent.");
            } catch (error) {
                setModalMessage(`Error: ${error.message}`);
            }
        }
    };

    const renderPopoverContent = () => {
        if (!popoverView) return null;
        switch (popoverView.name) {
            case 'detail':
                return <CreationDetail creationIdOverride={popoverView.id} user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} setExternalLink={setExternalLink} setReportModal={setReportModal} />;
            case 'profile':
                return <ProfilePage userIdOverride={popoverView.userId} user={user} userProfile={userProfile} setReportModal={setReportModal} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />;
            default:
                return null;
        }
    };
    
    if (loadingAuth) {
        if (isAuxiliaryWindow) return <div className="h-screen w-screen bg-transparent" />;
        return <div className="h-screen flex justify-center items-center bg-gray-100"><Spinner /></div>;
    }

    if (isStreamManagement) {
        if (!user) {
            return (
                <div className="h-screen bg-gray-950 p-4 text-white flex items-center justify-center">
                    <div className="rounded-xl bg-gray-900 border border-gray-700 p-6 text-center">
                        <p className="font-bold">Sign in to manage your stream.</p>
                        <button type="button" onClick={() => window.electronAPI?.closeStreamManagement?.()} className="mt-4 rounded-lg bg-gray-700 px-4 py-2">Close</button>
                    </div>
                </div>
            );
        }
        if (!localClientIdentity) {
            return <div className="h-screen bg-transparent flex items-center justify-center"><Spinner /></div>;
        }
        return (
            <StreamManagement
                user={user}
                userProfile={userProfile}
                startContext={streamStartContext}
                activeGameId={activeGameId}
                localClientId={localClientIdentity?.clientId || null}
                onClose={() => window.electronAPI?.closeStreamManagement?.()}
            />
        );
    }

    if (isGameOverlay && !isOverlayExpanded) {
        return (
            <GameOverlayWidget
                unreadCount={notifications.filter(notification => !notification.isRead).length}
                activeGameId={activeGameId}
                notifications={notifications}
                onOpen={(entry) => {
                    if (isOverlayShowcaseEntry(entry)) navigate('/overlay/showcase');
                }}
            />
        );
    }

    const showNewCreationButton = user && location.pathname === '/';
    const reportableContent = getReportableContent(location.pathname);
    const showProfileWizard = Boolean(
        user && userProfile && !isOfflineMode && !isGameOverlay &&
        userProfile.needsProfileSetup && !profileWizardDismissed
    );

    // Während des Wizards Klicks im Header abfangen (außer dem Theme-Toggle, der
    // data-wizard-allow trägt) und den Nutzer erst fragen, ob er den Wizard
    // wirklich verlassen will. capture verhindert, dass Links/Buttons navigieren.
    const handleHeaderGuard = (event) => {
        if (event.target.closest('[data-wizard-allow]')) return;
        event.preventDefault();
        event.stopPropagation();
        setWizardLeaveSignal((value) => value + 1);
    };

    const handleReportCurrentContent = async () => {
        if (!user) {
            setModalMessage('You must be logged in to report content.');
            return;
        }
        if (!reportableContent) return;
        const markerRef = doc(db, 'users', user.uid, 'reportedItems', reportableContent.markerId);
        if ((await getDoc(markerRef)).exists()) {
            setModalMessage('You have already reported this content.');
            return;
        }
        setReportModal({
            ...reportableContent,
            onConfirm: async (reason) => {
                try {
                    const batch = writeBatch(db);
                    batch.set(doc(collection(db, 'reports')), {
                        ...reportableContent,
                        reason,
                        reporterId: user.uid,
                        timestamp: serverTimestamp(),
                    });
                    batch.set(markerRef, {
                        reportedAt: serverTimestamp(),
                        targetId: reportableContent.targetId,
                        targetType: reportableContent.targetType,
                    });
                    await batch.commit();
                    setModalMessage('Content reported successfully. Our moderation team will review it.');
                } catch (error) {
                    setModalMessage(`Error submitting report: ${error.message}`);
                }
            },
        });
    };

    return (
        <>
        <RouteCanonicalMetadata />
        {isGameOverlay && (
            <GameOverlayChrome
                user={user}
                activeGameId={activeGameId}
                currentPath={location.pathname}
                onOpenCollaboration={(collaborationId, state = null) => navigate(
                    `/collaboration/${collaborationId}`,
                    { state },
                )}
                setModalMessage={setModalMessage}
            />
        )}
        <div className={`h-screen w-screen overflow-hidden flex flex-col bg-gray-100 dark:bg-gray-900 ${isGameOverlay ? 'pt-10' : ''}`}>
            {modalMessage && <Modal message={modalMessage} onClose={() => setModalMessage(null)} activeTab={activeTab} />}
            {confirmation && <ConfirmationModal message={confirmation.message} onConfirm={() => { confirmation.onConfirm(); setConfirmation(null); }} onCancel={() => setConfirmation(null)} />}
            {externalLink && <ExternalLinkModal url={externalLink} onConfirm={() => { if (isSafeHttpUrl(externalLink)) { window.open(externalLink, '_blank', 'noopener,noreferrer'); } setExternalLink(null); }} onCancel={() => setExternalLink(null)} activeTab={activeTab} />}
            {passwordConfirm && <PasswordConfirmationModal message={passwordConfirm.message} onConfirm={(password) => { passwordConfirm.onConfirm(password); setPasswordConfirm(null); }} onCancel={() => setPasswordConfirm(null)} />}
            {reportModal && <ReportModal targetType={reportModal.targetType || reportModal.type} onConfirm={(reason) => { reportModal.onConfirm(reason); setReportModal(null); }} onCancel={() => setReportModal(null)} blacklist={blacklist} />}
            {strikeModal && <StrikeModal onConfirm={(reason) => { strikeModal.onConfirm(reason); setStrikeModal(null); }} onCancel={() => setStrikeModal(null)} />}
            {popoverView && <PopoverModal onClose={() => setPopoverView(null)}>
                <Suspense fallback={<div className="h-64 flex justify-center items-center"><Spinner /></div>}>
                    {renderPopoverContent()}
                </Suspense>
            </PopoverModal>}
            {showRickRoll && <RickRollModal onClose={() => setShowRickRoll(false)} />}
            {goLivePrompt && user && (
                <GoLiveModal
                    user={user}
                    userProfile={userProfile}
                    isElectron={Boolean(window.electronAPI?.isElectron)}
                    obsService={goLivePrompt.service}
                    initialCreation={null}
                    onClose={() => setGoLivePrompt(null)}
                    setModalMessage={setModalMessage}
                />
            )}
            
            {!isStoreBuild && (updateDownloaded ? (
                <div className="bg-green-500 text-white p-3 text-center flex justify-center items-center flex-shrink-0">
                    <p className="font-semibold">Update downloaded. Restart now to install it.</p>
                    <button onClick={() => window.electronAPI.restartApp()} className="ml-4 bg-white text-green-700 font-bold py-1 px-3 rounded hover:bg-green-100">Restart</button>
                </div>
            ) : updateInfo && (
                <div className="bg-blue-500 text-white p-3 text-center flex justify-center items-center flex-shrink-0">
                    <p className="font-semibold">A new version ({updateInfo.version}) is available!</p>
                    <button 
                        onClick={() => window.electronAPI.openExternalLink(updateInfo.url)} 
                        className="ml-4 bg-white text-blue-700 font-bold py-1 px-3 rounded hover:bg-blue-100"
                    >
                        Download now
                    </button>
                </div>
            ))}

            {showProfileWizard ? (
                <div className="flex-shrink-0" onClickCapture={handleHeaderGuard}>
                    <Navbar user={user} userProfile={userProfile} onLogout={handleLogout} notifications={notifications} setModalMessage={setModalMessage} onReportBug={() => setIsBugReportOpen(true)} />
                </div>
            ) : (
                <Navbar user={user} userProfile={userProfile} onLogout={handleLogout} notifications={notifications} className="flex-shrink-0" setModalMessage={setModalMessage} onReportBug={() => setIsBugReportOpen(true)} />
            )}

            {showVerificationBanner && !isOfflineMode && (
                <div className="bg-yellow-400 text-center p-2 text-yellow-900 font-semibold flex-shrink-0">
                    Your email is not verified...
                    <button onClick={handleResendVerification} className="ml-4 underline font-bold">Resend Email</button>
                </div>
            )}
            
            <main className={`flex-1 min-h-0 overflow-y-auto ${showProfileWizard ? '[scrollbar-gutter:stable]' : ''}`}>
                <ErrorBoundary>
                    <Suspense fallback={<div className="h-full flex justify-center items-center"><Spinner /></div>}>
                        {showProfileWizard ? (
                            <ProfileSetupWizard
                                user={user}
                                userProfile={userProfile}
                                setModalMessage={setModalMessage}
                                setConfirmation={setConfirmation}
                                blacklist={blacklist}
                                leaveSignal={wizardLeaveSignal}
                                onConsent={answerConsent}
                                onComplete={(patch) => {
                                    setUserProfile(prev => ({ ...prev, ...patch }));
                                    setProfileWizardDismissed(true);
                                }}
                            />
                        ) : (
                        <Routes>
                            <Route path="/client/dashboard" element={<ClientDashboard user={user} />} />
                            <Route path="/" element={<HomePage user={user} userProfile={userProfile} activeTab={activeTab} setActiveTab={setActiveTab} homeState={homeState} setHomeState={setHomeState} />} />
                            <Route path="/login" element={<AuthPage setModalMessage={setModalMessage} activeTab={activeTab} blacklist={blacklist} />} />
                            <Route path="/creation/:id" element={<CreationDetail user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} setExternalLink={setExternalLink} setReportModal={setReportModal} />} />
                            <Route path="/profile/:userId" element={<ProfilePage user={user} userProfile={userProfile} setReportModal={setReportModal} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />} />
                            <Route path="/communitys" element={<CommunitysPage user={user} userProfile={userProfile} communitysState={communitysState} setCommunitysState={setCommunitysState} setModalMessage={setModalMessage} />} />
                            <Route path="/community/:communityName" element={<CommunityDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />} />
                            <Route path="/showcase/:showcaseId" element={<ShowcasePage />} />
                            <Route path="/overlay/showcase" element={<OverlayShowcasePage localClientId={localClientIdentity?.clientId || ''} />} />
                            <Route path="/terms-of-service" element={<LegalPage userProfile={userProfile} docId="termsOfService" title="Terms of Service" fallbackContent={TERMS_OF_SERVICE_FALLBACK} requiredNotice={MINIMUM_AGE_NOTICE} setModalMessage={setModalMessage} />} />
                            <Route path="/privacy" element={<LegalPage userProfile={userProfile} docId="privacyPolicy" title="Privacy Policy" fallbackContent={PRIVACY_POLICY} setModalMessage={setModalMessage} />} />
                            <Route path="/community-guidelines" element={<LegalPage userProfile={userProfile} docId="communityGuidelines" title="Community Content Guidelines" fallbackContent={COMMUNITY_GUIDELINES} setModalMessage={setModalMessage} />} />
                            <Route path="/impressum" element={<LegalPage userProfile={userProfile} docId="impressum" title="Impressum / Legal Notice" setModalMessage={setModalMessage} />} />
                            <Route path="/event/:eventId" element={<EventDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} setPopoverView={setPopoverView} blacklist={blacklist} />} />
                            <Route path="/client-info" element={<ClientInfoPage />} />
                            <Route path="/collaboration/:collaborationId" element={<ProtectedRoute user={user} userProfile={userProfile}><CollaborationDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} /></ProtectedRoute>} />
                            <Route path="/collaboration/join/:inviteCode" element={<JoinCollaborationPage user={user} setModalMessage={setModalMessage} />} />

                            <Route path="/settings" element={<ProtectedRoute user={user} userProfile={userProfile}><SettingsPage user={user} setModalMessage={setModalMessage} setConfirmation={setConfirmation} activeTab={activeTab} /></ProtectedRoute>} />
                            <Route path="/profile/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><EditProfilePage user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/create" element={<ProtectedRoute user={user} userProfile={userProfile}><CreationForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} initialGame={activeTab} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/creation/:id/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><CreationForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/community/:communityId/create-event" element={<ProtectedRoute user={user} userProfile={userProfile} requiredCommunityPermission="createEvents"><EventForm user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/event/:eventId/edit" element={<ProtectedRoute user={user} userProfile={userProfile} checkEventManagement={true}><EventForm user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/event/:eventId/manage" element={<ProtectedRoute user={user} userProfile={userProfile} checkEventManagement={true}><EventManager user={user} userProfile={userProfile} setModalMessage={setModalMessage} setPopoverView={setPopoverView} /></ProtectedRoute>} />
                            <Route path="/create-community" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="influencer"><CreateCommunityForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route
                                path="/collaboration/create"
                                element={window.electronAPI?.isElectron ? (
                                    <ProtectedRoute user={user} userProfile={userProfile}>
                                        <CreateCollaborationForm user={user} setModalMessage={setModalMessage} />
                                    </ProtectedRoute>
                                ) : (
                                    <Navigate to="/client-info" replace />
                                )}
                            />
                            <Route path="/collaboration/:collaborationId/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><CreateCollaborationForm user={user} setModalMessage={setModalMessage} /></ProtectedRoute>} />
                            <Route path="/manager/:id" element={<ProtectedRoute user={user} userProfile={userProfile} checkCommunityOwnership={true} setShowRickRoll={setShowRickRoll}><CommunityManagerPage setPasswordConfirm={setPasswordConfirm} setModalMessage={setModalMessage} setConfirmation={setConfirmation} blacklist={blacklist} userProfile={userProfile} setPopoverView={setPopoverView} /></ProtectedRoute>} />
                            <Route path="/admin" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="admin" setShowRickRoll={setShowRickRoll}><AdminPage setPopoverView={setPopoverView} setModalMessage={setModalMessage} setPasswordConfirm={setPasswordConfirm} /></ProtectedRoute>} />
                            <Route path="/moderation" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="moderator" setShowRickRoll={setShowRickRoll}><ModerationPage setPopoverView={setPopoverView} setModalMessage={setModalMessage} setStrikeModal={setStrikeModal} setPasswordConfirm={setPasswordConfirm} setConfirmation={setConfirmation} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/:communityName" element={<CommunityDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />} />
                        </Routes>
                        )}
                    </Suspense>
                </ErrorBoundary>
            </main>
            
            {!isOfflineMode && !showProfileWizard && <ToggleViewButton />}

            {showNewCreationButton && !showProfileWizard && (
                <PreloadLink to="/create">
                    <FloatingActionButton activeTab={activeTab} />
                </PreloadLink>
            )}

            {!isOfflineMode && !showProfileWizard && (
                <footer className="text-center px-4 py-3 text-gray-500 flex-shrink-0">
                    <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2 text-sm">
                        <span>&copy; 2026 PlanetCreations.net</span>
                        <PreloadLink to="/terms-of-service" className="hover:text-gray-800 dark:hover:text-gray-200 hover:underline whitespace-nowrap">Terms of Service</PreloadLink>
                        <PreloadLink to="/privacy" className="hover:text-gray-800 dark:hover:text-gray-200 hover:underline whitespace-nowrap">Privacy Policy</PreloadLink>
                        <PreloadLink to="/community-guidelines" className="hover:text-gray-800 dark:hover:text-gray-200 hover:underline whitespace-nowrap">Community Guidelines</PreloadLink>
                        <PreloadLink to="/impressum" className="hover:text-gray-800 dark:hover:text-gray-200 hover:underline whitespace-nowrap">Impressum / Legal Notice</PreloadLink>
                        {reportableContent && <button type="button" onClick={handleReportCurrentContent} className="hover:text-red-600 hover:underline whitespace-nowrap">Report this content</button>}
                    </div>
                    <p className="mt-2 text-xs text-gray-400">We are not affiliated with or endorsed by Frontier Developments.</p>
                </footer>
            )}
            {isBugReportOpen && user && (
                <BugReportModal
                    user={user}
                    userProfile={userProfile}
                    onClose={() => setIsBugReportOpen(false)}
                    setModalMessage={setModalMessage}
                    blacklist={blacklist}
                />
            )}
            <PrivacyPrompt />
        </div>
        </>
    );
};

export default function App() {
    if (window.electronAPI?.isOverlayNotification) return <OverlayNotificationPopover />;
    if (!isConfigured) {
        return (
            <div className="h-screen flex items-center justify-center bg-red-100 text-red-900">
                <div className="text-center p-8">
                    <h1 className="text-4xl font-bold mb-4">Firebase Configuration Missing</h1>
                    <p className="text-lg">Please add your Firebase project configuration to your config file.</p>
                </div>
            </div>
        );
    }
    
    const Router = usesHashRouting() ? HashRouter : BrowserRouter;

    return (
        <QueryClientProvider client={queryClient}>
            <Router>
                <AppContent />
            </Router>
        </QueryClientProvider>
    );
}
