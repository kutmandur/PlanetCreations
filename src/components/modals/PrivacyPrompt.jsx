import React, { useState, useEffect } from 'react';
import { ICONS } from '../../utils/helpers';
import Icon from '../ui/Icon';

const PrivacyPrompt = () => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Only show the banner if no choice has been made yet
        const consent = localStorage.getItem('cookie_consent');
        if (!consent) {
            setIsVisible(true);
        }
    }, []);

    const handleAccept = () => {
        localStorage.setItem('cookie_consent', 'accepted');
        setIsVisible(false);
    };

    const handleDecline = () => {
        // Save the "declined" state to localStorage
        localStorage.setItem('cookie_consent', 'declined');
        setIsVisible(false);
    };

    if (!isVisible) {
        return null;
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-800 text-white p-4 flex flex-col sm:flex-row items-center justify-between shadow-lg z-50">
            <div className="flex items-center mb-4 sm:mb-0">
                <Icon path={ICONS.infoCircle} className="w-8 h-8 mr-4 text-blue-400 flex-shrink-0" solid />
                <p className="text-sm">
                    We use cookies to improve your experience. Accepting allows us to remember your login session. If you decline, you will be logged out when you close your browser. Essential site functions are always active.
                </p>
            </div>
            <div className="flex space-x-4 flex-shrink-0">
                <button 
                    onClick={handleDecline} 
                    className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg text-sm"
                >
                    Decline
                </button>
                <button 
                    onClick={handleAccept} 
                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg text-sm"
                >
                    Accept
                </button>
            </div>
        </div>
    );
};

export default PrivacyPrompt;
