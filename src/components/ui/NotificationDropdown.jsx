import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAllNotifications, markAllRead } from '../../firebase/database';

const NotificationDropdown = ({ user, notifications, close }) => {
    const navigate = useNavigate();

    // Opening the dropdown marks everything read (1 write; skipped if already read).
    useEffect(() => {
        if (user) markAllRead(user.uid, notifications);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleNotificationClick = (notification) => {
        if (notification.link) {
            navigate(notification.link);
        } else if (notification.creationId) {
            navigate(`/creation/${notification.creationId}`);
        }
        close();
    };

    const handleClearAll = async () => {
        if (!user) return;
        try {
            await clearAllNotifications(user.uid);
            close();
        } catch (error) {
            console.error("Error clearing notifications:", error);
        }
    };

    if (notifications.length === 0) {
        return (
            <div className="origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-30 p-4">
                <p className="text-center text-gray-500">You have no notifications.</p>
            </div>
        );
    }

    return (
        <div className="origin-top-right absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-30">
            <div className="py-1">
                <div className="px-4 py-2 flex justify-between items-center border-b">
                    <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                    <button
                        onClick={handleClearAll}
                        className="text-xs text-blue-500 hover:underline"
                    >
                        Clear All
                    </button>
                </div>
                {notifications.map(notif => (
                    <button
                        key={notif.id}
                        onClick={() => handleNotificationClick(notif)}
                        className={`w-full text-left block px-4 py-3 text-sm hover:bg-gray-100 ${!notif.isRead ? 'bg-blue-50' : ''}`}
                    >
                        <p className="font-semibold text-gray-800">{notif.title || `Update for "${notif.creationTitle}"`}</p>
                        
                        {notif.message && (
                            <p className="text-sm text-gray-600 mt-1">{notif.message}</p>
                        )}

                        {notif.updateCount > 1 && (
                            <p className="text-xs text-blue-600 font-semibold">{notif.updateCount} updates since you last checked.</p>
                        )}
                        
                        <p className="text-xs text-gray-500 mt-1">
                            {new Date(notif.timestamp?.seconds * 1000).toLocaleString()}
                        </p>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default NotificationDropdown;
