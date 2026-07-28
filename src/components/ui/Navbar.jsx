import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ICONS } from '../../utils/helpers';
import Icon from './Icon';
import NotificationDropdown from './NotificationDropdown';
import InstallHelp from './InstallHelp';
import PreloadLink from './PreloadLink';
import ViewModeToggle from './ViewModeToggle';
import ThemeToggle from './ThemeToggle';
import ProfileImage from './ProfileImage';
import { preloadRoute } from '../../utils/preload';
import { hardReloadApp } from '../../utils/appRefresh';

import logo from '../../assets/logo.png'; 

const Navbar = ({ user, userProfile, onLogout, notifications, className, setModalMessage, onReportBug }) => {
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
    const profileMenuRef = useRef(null);
    const notificationMenuRef = useRef(null);
    const navigate = useNavigate();
    
    const location = useLocation();
    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    const isOfflineMode = location.pathname.startsWith('/client');
    
    const switchModePath = isOfflineMode ? '/' : '/client/dashboard';
    const switchModeText = isOfflineMode ? 'Online Workshop' : 'Offline Manager';
    const switchModeIcon = isOfflineMode ? ICONS.globe : ICONS.cog;

    const SHIELD_ICON_PATH = "M12 2L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-3z";
    const unreadCount = notifications.filter(n => !n.isRead).length;

    const handleOutsideClick = (event) => {
        if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
            setIsProfileMenuOpen(false);
        }
        if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target)) {
            setIsNotificationsOpen(false);
        }
    };

    useEffect(() => {
        document.addEventListener('mousedown', handleOutsideClick);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }, []);

    const handleLogoutAndRedirect = () => {
        onLogout();
        setIsProfileMenuOpen(false);
        navigate('/');
    };

    const isAdmin = userProfile && userProfile.role === 'admin';
    const isModerator = userProfile && (userProfile.role === 'moderator' || userProfile.role === 'admin');

    return (
        <header className={`bg-gray-800 shadow-md sticky top-0 z-40 ${className}`}>
            <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                <Link to="/" className="flex items-center space-x-2">
                    {/* 2. Das <img>-Tag verwendet jetzt die importierte Variable */}
                    <img src={logo} alt="PlanetCreations Logo" className="h-10 w-auto" />
                </Link>

                <nav className="flex items-center space-x-4">
                    {isElectron && (
                        <PreloadLink to={switchModePath}>
                            <button className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors">
                                <Icon path={switchModeIcon} className="w-5 h-5" solid />
                                <span>{switchModeText}</span>
                            </button>
                        </PreloadLink>
                    )}

                    <span data-wizard-allow className="flex items-center">
                        <ThemeToggle />
                    </span>

                    {user ? (
                        <>
                            {isModerator && (
                                <button
                                    onClick={() => navigate('/moderation')}
                                    onMouseEnter={() => preloadRoute('/moderation')}
                                    onTouchStart={() => preloadRoute('/moderation')}
                                    className="p-2 rounded-full hover:bg-gray-700"
                                    title="Moderation Panel"
                                >
                                    <Icon path={SHIELD_ICON_PATH} className="w-6 h-6 text-yellow-500" solid />
                                </button>
                            )}
                            {isAdmin && (
                                <button
                                    onClick={() => navigate('/admin')}
                                    onMouseEnter={() => preloadRoute('/admin')}
                                    onTouchStart={() => preloadRoute('/admin')}
                                    className="p-2 rounded-full hover:bg-gray-700"
                                    title="Admin Management"
                                >
                                    <Icon path={SHIELD_ICON_PATH} className="w-6 h-6 text-red-500" solid />
                                </button>
                            )}
                            <InstallHelp user={user} setModalMessage={setModalMessage} />
                            <div className="relative" ref={notificationMenuRef}>
                                <button onClick={() => setIsNotificationsOpen(!isNotificationsOpen)} className="p-2 rounded-full hover:bg-gray-700 relative" title="Notifications">
                                    <Icon path={ICONS.bell} className="w-6 h-6 text-gray-300" />
                                    {unreadCount > 0 && (
                                        <span className="absolute top-0 right-0 h-4 w-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">{unreadCount}</span>
                                    )}
                                </button>
                                {isNotificationsOpen && <NotificationDropdown user={user} notifications={notifications} close={() => setIsNotificationsOpen(false)} />}
                            </div>
                            <div className="relative" ref={profileMenuRef}>
                                <button onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)} className="flex items-center space-x-2">
                                    <ProfileImage src={userProfile?.profilePictureUrl} alt="Profile" className="w-10 h-10 rounded-full object-cover" />
                                </button>
                                {isProfileMenuOpen && (
                                    <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-30">
                                        <button
                                            onClick={() => { navigate(`/profile/${user.uid}`); setIsProfileMenuOpen(false); }}
                                            onMouseEnter={() => preloadRoute(`/profile/${user.uid}`)}
                                            onTouchStart={() => preloadRoute(`/profile/${user.uid}`)}
                                            className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                        >
                                            Profile
                                        </button>
                                        <button
                                            onClick={() => { navigate('/settings'); setIsProfileMenuOpen(false); }}
                                            onMouseEnter={() => preloadRoute('/settings')}
                                            onTouchStart={() => preloadRoute('/settings')}
                                            className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                        >
                                            Settings
                                        </button>
                                        <button
                                            onClick={() => { navigate('/client-info'); setIsProfileMenuOpen(false); }}
                                            onMouseEnter={() => preloadRoute('/client-info')}
                                            onTouchStart={() => preloadRoute('/client-info')}
                                            className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                        >
                                            About the Client
                                        </button>
                                        {onReportBug && (
                                            <button
                                                onClick={() => { onReportBug(); setIsProfileMenuOpen(false); }}
                                                className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                            >
                                                Report a Bug
                                            </button>
                                        )}
                                        {isElectron && (
                                            <button
                                                onClick={hardReloadApp}
                                                className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                                title="Reload the app to fetch the latest data"
                                            >
                                                Reload App
                                            </button>
                                        )}
                                        <ViewModeToggle onSelect={() => setIsProfileMenuOpen(false)} />
                                        <button onClick={handleLogoutAndRedirect} className="w-full text-left block px-4 py-2 text-sm text-red-700 hover:bg-red-50">
                                            Logout
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <button
                            onClick={() => navigate('/login')}
                            onMouseEnter={() => preloadRoute('/login')}
                            onTouchStart={() => preloadRoute('/login')}
                            className={`bg-blue-500 hover:bg-blue-600 text-white font-bold px-4 py-2 rounded-md transition-colors`}
                        >
                            Login / Register
                        </button>
                    )}
                </nav>
            </div>
        </header>
    );
};

export default Navbar;
