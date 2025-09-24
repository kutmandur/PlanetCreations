import React from 'react';
import { Link, useLocation } from 'react-router-dom'; // ✅ Import Link and useLocation
import { ICONS } from '../../utils/helpers';
import Icon from './Icon';

// ❌ The 'setView' and 'currentView' props are no longer needed
const ToggleViewButton = () => {
    const location = useLocation(); // ✅ Get current location

    // ✅ Check the URL path to determine state
    const isCommunitysPage = location.pathname.startsWith('/community');

    const iconPath = isCommunitysPage ? ICONS.globe : ICONS.users;
    const text = isCommunitysPage ? 'Creation Browser' : 'Communitys';
    const newPath = isCommunitysPage ? '/' : '/communitys';

    return (
        // ✅ The button is now a Link component
        <Link
            to={newPath}
            className={`
                group fixed bottom-8 left-8 h-16 w-16 
                bg-yellow-500 hover:bg-yellow-600 
                text-white 
                rounded-full 
                flex items-center justify-center 
                shadow-lg 
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500
                transition-all duration-300 ease-in-out
                hover:w-52
            `}
            aria-label={text}
        >
            <div className="flex items-center justify-center">
                <Icon path={iconPath} className="w-8 h-8 flex-shrink-0" solid />
                
                <div className="overflow-hidden max-w-0 group-hover:max-w-xs transition-all duration-300 ease-in-out">
                    <span className="pl-2 font-bold whitespace-nowrap">
                        {text}
                    </span>
                </div>
            </div>
        </Link>
    );
};

export default ToggleViewButton;
