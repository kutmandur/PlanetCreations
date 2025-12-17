import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';

// Import all necessary components for routing
import ProtectedRoute from './components/auth/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

import FloatingActionButton from './components/ui/FloatingActionButton';
import ToggleViewButton from './components/ui/ToggleViewButton';

import HomePage from './components/pages/HomePage';
import AuthPage from './components/pages/AuthPage';
import ProfilePage from './components/pages/ProfilePage';
import EditProfilePage from './components/pages/EditProfilePage';
import SettingsPage from './components/pages/SettingsPage';
import CreationForm from './components/pages/CreationForm';
import CreationDetail from './components/pages/CreationDetail';
import AdminPage from './components/pages/AdminPage';
import ModerationPage from './components/pages/ModerationPage';
import CommunitysPage from './components/pages/CommunitysPage';
import CreateCommunityForm from './components/pages/CreateCommunityForm';
import CommunityDetailPage from './components/pages/CommunityDetailPage';
import CommunityManagerPage from './components/pages/CommunityManagerPage';
import EventDetailPage from './components/pages/EventDetailPage';
import EventForm from './components/pages/EventForm';
import EventManager from './components/management/EventManager';


const AppRouter = ({ user, userProfile, activeTab, setActiveTab, homeState, setHomeState, communitysState, setCommunitysState, setModalMessage, setConfirmation, setExternalLink, setReportModal, setPopoverView, setPasswordConfirm, blacklist, setStrikeModal, setShowRickRoll }) => {
    const location = useLocation();
    const showNewCreationButton = user && location.pathname === '/';

    return (
        <>
            <main>
                <ErrorBoundary>
                    <Routes location={location} key={location.pathname}>
                        {/* Public Routes */}
                        <Route path="/" element={<HomePage user={user} userProfile={userProfile} activeTab={activeTab} setActiveTab={setActiveTab} homeState={homeState} setHomeState={setHomeState} />} />
                        <Route path="/login" element={<AuthPage setModalMessage={setModalMessage} activeTab={activeTab} blacklist={blacklist} />} />
                        <Route path="/creation/:id" element={<CreationDetail user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} setExternalLink={setExternalLink} setReportModal={setReportModal} />} />
                        <Route path="/profile/:userId" element={<ProfilePage user={user} setReportModal={setReportModal} setModalMessage={setModalMessage} />} />
                        <Route path="/communitys" element={<CommunitysPage user={user} userProfile={userProfile} communitysState={communitysState} setCommunitysState={setCommunitysState} />} />
                        <Route path="/community/:id" element={<CommunityDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />} />
                        
                        <Route path="/event/:eventId" element={<EventDetailPage user={user} userProfile={userProfile} setModalMessage={setModalMessage} />} />

                        {/* Protected Routes */}
                        <Route path="/settings" element={<ProtectedRoute user={user} userProfile={userProfile}><SettingsPage user={user} setModalMessage={setModalMessage} setConfirmation={setConfirmation} activeTab={activeTab} /></ProtectedRoute>} />
                        <Route path="/profile/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><EditProfilePage user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                        <Route path="/create" element={<ProtectedRoute user={user} userProfile={userProfile}><CreationForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} initialGame={activeTab} blacklist={blacklist} /></ProtectedRoute>} />
                        <Route path="/creation/:id/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><CreationForm user={user} userProfile={userProfile} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                        <Route path="/create-community" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="influencer"><CreateCommunityForm user={user} setModalMessage={setModalMessage} blacklist={blacklist} /></ProtectedRoute>} />
                        <Route path="/manager/:id" element={<ProtectedRoute user={user} userProfile={userProfile} checkCommunityOwnership={true} setShowRickRoll={setShowRickRoll}><CommunityManagerPage setPasswordConfirm={setPasswordConfirm} setModalMessage={setModalMessage} blacklist={blacklist} userProfile={userProfile} setPopoverView={setPopoverView} /></ProtectedRoute>} />
                        <Route path="/admin" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="admin" setShowRickRoll={setShowRickRoll}><AdminPage setPopoverView={setPopoverView} setModalMessage={setModalMessage} setPasswordConfirm={setPasswordConfirm} /></ProtectedRoute>} />
                        <Route path="/moderation" element={<ProtectedRoute user={user} userProfile={userProfile} requiredRole="moderator" setShowRickRoll={setShowRickRoll}><ModerationPage setPopoverView={setPopoverView} setModalMessage={setModalMessage} setStrikeModal={setStrikeModal} setPasswordConfirm={setPasswordConfirm} setConfirmation={setConfirmation} blacklist={blacklist} /></ProtectedRoute>} />
                        
                        <Route path="/community/:communityId/create-event" element={<ProtectedRoute user={user} userProfile={userProfile}><EventForm user={user} setModalMessage={setModalMessage} /></ProtectedRoute>} />
                        <Route path="/event/:eventId/edit" element={<ProtectedRoute user={user} userProfile={userProfile}><EventForm user={user} setModalMessage={setModalMessage} /></ProtectedRoute>} />
                        <Route path="/event/:eventId/manage" element={<ProtectedRoute user={user} userProfile={userProfile}><EventManager user={user} userProfile={userProfile} setModalMessage={setModalMessage} setPopoverView={setPopoverView} /></ProtectedRoute>} />
                    </Routes>
                </ErrorBoundary>
            </main>

            <ToggleViewButton />

            {showNewCreationButton && (
                <Link to="/create">
                    <FloatingActionButton activeTab={activeTab} />
                </Link>
            )}
        </>
    );
};

export default AppRouter;