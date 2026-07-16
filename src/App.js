import React, { useState, useEffect, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { signOut, onAuthStateChanged, sendEmailVerification } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

import { auth, db, isConfigured } from './firebase/config';
import { enablePush, getPushPermission } from './firebase/push';
import { isStandalone } from './utils/pwaInstall';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PreloadLink from './components/ui/PreloadLink';
import { preloadCriticalComponents } from './utils/preload';
import lazyWithReload from './utils/lazyWithReload';
import { isSafeHttpUrl } from './utils/helpers';

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

import ErrorBoundary from './components/ErrorBoundary';
import CookieConsent from './components/modals/CookieConsent';
import BugReportModal from './components/modals/BugReportModal';
import ClientDashboard from './components/pages/ClientDashboard';

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

const AppContent = () => {
    const location = useLocation();
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
    const [activeTab, setActiveTab] = useState('planet-coaster-2');
    const [blacklist, setBlacklist] = useState([]);
    const [showRickRoll, setShowRickRoll] = useState(false);
    const [isBugReportOpen, setIsBugReportOpen] = useState(false);
    
    const [homeState, setHomeState] = useState({
        searchTerm: '', filterTag: '', sortBy: 'createdAt', activeCategory: 'All',
        showModsOnly: false, platformFilter: 'all', dlcFilterMode: 'all', selectedDlcs: []
    });

    const [communitysState, setCommunitysState] = useState({
        searchTerm: '', sortBy: 'memberCount', activeTab: 'Browser', activeGameFilter: 'all',
    });

    const [notifications, setNotifications] = useState([]);
    const [showVerificationBanner, setShowVerificationBanner] = useState(false);

    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateDownloaded, setUpdateDownloaded] = useState(false);

    useEffect(() => {
        if (isOfflineMode) {
            document.documentElement.style.overflow = 'hidden';
        } else {
            document.documentElement.style.overflow = 'auto';
        }
    }, [isOfflineMode]);

    useEffect(() => {
        if (!isConfigured) { setLoadingAuth(false); return; }
        let notificationUnsubscribe = () => {};
        const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser && currentUser.isAnonymous) {
                await signOut(auth);
                setUser(null); setUserProfile(null); setNotifications([]); setActiveTab('planet-coaster-2'); setLoadingAuth(false);
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
                        if (combinedProfile.favoriteGame) {
                            setActiveTab(combinedProfile.favoriteGame);
                            const savedPreference = combinedProfile.platformPreferences?.[combinedProfile.favoriteGame];
                            if (savedPreference) { setHomeState(prev => ({ ...prev, platformFilter: savedPreference })); }
                        } else { setActiveTab('planet-coaster-2'); }
                    } else {
                        setUserProfile({ uid: currentUser.uid, role: 'user' });
                        setActiveTab('planet-coaster-2');
                    }
                    // Single capped inbox doc: 1 read loads the whole bell, and
                    // items are already stored newest-first (server prepends).
                    const inboxRef = doc(db, 'users', currentUser.uid, 'meta', 'inbox');
                    notificationUnsubscribe = onSnapshot(inboxRef, (snap) => {
                        setNotifications(snap.exists() ? (snap.data().items || []) : []);
                    });
                } catch (error) {
                    console.error('Error fetching user profile:', error);
                    setModalMessage(`Error: ${error.message}`);
                    setUserProfile(null);
                }
            } else {
                setUserProfile(null); setNotifications([]); setActiveTab('planet-coaster-2');
            }
            setLoadingAuth(false);
        });
        const blacklistRef = doc(db, 'meta', 'blacklist');
        const unsubBlacklist = onSnapshot(blacklistRef, (docSnap) => {
            if (docSnap.exists()) { setBlacklist(docSnap.data().words || []); } else { setBlacklist([]); }
        });

        if (window.electronAPI) {
            window.electronAPI.onUpdateInfoAvailable((info) => {
                setUpdateInfo(info);
            });
            window.electronAPI.onUpdateDownloaded(() => {
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

        return () => { authUnsubscribe(); notificationUnsubscribe(); unsubBlacklist(); };
    }, []);

    // Installed PWA: ask for notification permission automatically on first open.
    // If dismissed, the user can re-enable from Settings or the install dialog.
    useEffect(() => {
        if (!user || !isStandalone()) return;
        if (getPushPermission() !== 'default') return;
        const flag = `pushAutoPrompted-${user.uid}`;
        if (localStorage.getItem(flag)) return;
        localStorage.setItem(flag, '1');
        enablePush(user.uid).catch(() => {});
    }, [user]);

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
        return <div className="h-screen flex justify-center items-center bg-gray-100"><Spinner /></div>;
    }

    const showNewCreationButton = user && location.pathname === '/';

    return (
        <div className="h-screen w-screen overflow-hidden flex flex-col bg-gray-100">
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
            
            {updateDownloaded ? (
                <div className="bg-green-500 text-white p-3 text-center flex justify-center items-center flex-shrink-0">
                    <p className="font-semibold">Update heruntergeladen. Jetzt neu starten, um zu installieren.</p>
                    <button onClick={() => window.electronAPI.restartApp()} className="ml-4 bg-white text-green-700 font-bold py-1 px-3 rounded hover:bg-green-100">Neu starten</button>
                </div>
            ) : updateInfo && (
                <div className="bg-blue-500 text-white p-3 text-center flex justify-center items-center flex-shrink-0">
                    <p className="font-semibold">Eine neue Version ({updateInfo.version}) ist verfügbar!</p>
                    <button 
                        onClick={() => window.electronAPI.openExternalLink(updateInfo.url)} 
                        className="ml-4 bg-white text-blue-700 font-bold py-1 px-3 rounded hover:bg-blue-100"
                    >
                        Jetzt herunterladen
                    </button>
                </div>
            )}

            <Navbar user={user} userProfile={userProfile} onLogout={handleLogout} notifications={notifications} className="flex-shrink-0" setModalMessage={setModalMessage} />

            {showVerificationBanner && !isOfflineMode && (
                <div className="bg-yellow-400 text-center p-2 text-yellow-900 font-semibold flex-shrink-0">
                    Your email is not verified...
                    <button onClick={handleResendVerification} className="ml-4 underline font-bold">Resend Email</button>
                </div>
            )}
            
            <main className="flex-1 min-h-0 overflow-y-auto">
                <ErrorBoundary>
                    <Suspense fallback={<div className="h-full flex justify-center items-center"><Spinner /></div>}>
                        <Routes>
                            <Route path="/client/dashboard" element={<ClientDashboard user={user} />} />
                            <Route path="/" element={<HomePage user={user} userProfile={userProfile} activeTab={activeTab} setActiveTab={setActiveTab} homeState={homeState} setHomeState={setHomeState} />} />
                            <Route path="/login" element={<AuthPage setModalMessage={setModalMessage} activeTab={activeTab} blacklist={blacklist} />} />
                            <Route path="/creation/:id" element={<CreationDetail user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} setExternalLink={setExternalLink} setReportModal={setReportModal} />} />
                            <Route path="/profile/:userId" element={<ProfilePage user={user} userProfile={userProfile} setReportModal={setReportModal} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />} />
                            <Route path="/communitys" element={<CommunitysPage user={user} userProfile={userProfile} communitysState={communitysState} setCommunitysState={setCommunitysState} setModalMessage={setModalMessage} />} />
                            <Route path="/community/:communityName" element={<CommunityDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />} />
                            <Route path="/showcase/:showcaseId" element={<ShowcasePage />} />
                            <Route path="/terms-of-service" element={<LegalPage userProfile={userProfile} docId="termsOfService" title="Terms of Service" setModalMessage={setModalMessage} />} />
                            <Route path="/impressum" element={<LegalPage userProfile={userProfile} docId="impressum" title="Impressum / Legal Notice" setModalMessage={setModalMessage} />} />
                            <Route path="/event/:eventId" element={<EventDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} setPopoverView={setPopoverView} blacklist={blacklist} />} />
                            <Route path="/client-info" element={<ClientInfoPage />} />
                            <Route path="/collaboration/:collaborationId" element={<CollaborationDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />} />
                            <Route path="/collaboration/join/:inviteCode" element={<JoinCollaborationPage user={user} setModalMessage={setModalMessage} />} />

                            <Route path="/settings" element={<ProtectedRoute user={user} userProfile={userProfile}><SettingsPage user={user} setModalMessage={setModalMessage} setConfirmation={setConfirmation} activeTab={activeTab} /></ProtectedRoute>} />
                            <Route path="/profile/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><EditProfilePage user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/create" element={<ProtectedRoute user={user} userProfile={userProfile}><CreationForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} initialGame={activeTab} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/creation/:id/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><CreationForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/community/:communityId/create-event" element={<ProtectedRoute user={user} userProfile={userProfile} checkCommunityOwnership={true}><EventForm user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/event/:eventId/edit" element={<ProtectedRoute user={user} userProfile={userProfile} checkCommunityOwnership={true}><EventForm user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/event/:eventId/manage" element={<ProtectedRoute user={user} userProfile={userProfile} checkCommunityOwnership={true}><EventManager user={user} userProfile={userProfile} setModalMessage={setModalMessage} setPopoverView={setPopoverView} /></ProtectedRoute>} />
                            <Route path="/create-community" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="influencer"><CreateCommunityForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                            <Route path="/collaboration/create" element={<ProtectedRoute user={user} userProfile={userProfile}><CreateCollaborationForm user={user} setModalMessage={setModalMessage} /></ProtectedRoute>} />
                            <Route path="/manager/:id" element={<ProtectedRoute user={user} userProfile={userProfile} checkCommunityOwnership={true} setShowRickRoll={setShowRickRoll}><CommunityManagerPage setPasswordConfirm={setPasswordConfirm} setModalMessage={setModalMessage} setConfirmation={setConfirmation} blacklist={blacklist} userProfile={userProfile} setPopoverView={setPopoverView} /></ProtectedRoute>} />
                            <Route path="/admin" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="admin" setShowRickRoll={setShowRickRoll}><AdminPage setPopoverView={setPopoverView} setModalMessage={setModalMessage} setPasswordConfirm={setPasswordConfirm} /></ProtectedRoute>} />
                            <Route path="/moderation" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="moderator" setShowRickRoll={setShowRickRoll}><ModerationPage setPopoverView={setPopoverView} setModalMessage={setModalMessage} setStrikeModal={setStrikeModal} setPasswordConfirm={setPasswordConfirm} setConfirmation={setConfirmation} blacklist={blacklist} /></ProtectedRoute>} />
                        </Routes>
                    </Suspense>
                </ErrorBoundary>
            </main>
            
            {!isOfflineMode && <ToggleViewButton />}

            {showNewCreationButton && (
                <PreloadLink to="/create">
                    <FloatingActionButton activeTab={activeTab} />
                </PreloadLink>
            )}

            {!isOfflineMode && (
                <footer className="text-center px-4 py-3 text-gray-500 flex-shrink-0">
                    <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2 text-sm">
                        <span>&copy; 2025 PlanetCreations.net</span>
                        <PreloadLink to="/terms-of-service" className="hover:text-gray-800 hover:underline whitespace-nowrap">Terms of Service</PreloadLink>
                        <PreloadLink to="/impressum" className="hover:text-gray-800 hover:underline whitespace-nowrap">Impressum / Legal Notice</PreloadLink>
                        <PreloadLink to="/client-info" className="hover:text-gray-800 hover:underline whitespace-nowrap">About the Client</PreloadLink>
                        {user && (
                            <button onClick={() => setIsBugReportOpen(true)} className="hover:text-gray-800 hover:underline whitespace-nowrap">
                                Report a Bug
                            </button>
                        )}
                    </div>
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
            <CookieConsent />
        </div>
    );
};

export default function App() {
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
    
    return (
        <QueryClientProvider client={queryClient}>
            <HashRouter>
                <AppContent />
            </HashRouter>
        </QueryClientProvider>
    );
}