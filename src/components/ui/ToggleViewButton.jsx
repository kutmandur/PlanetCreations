import React from 'react';
import { Link, useLocation } from 'react-router-dom'; // ✅ Import Link and useLocation
import { ICONS } from '../../utils/helpers';
import { useFooterAwareBottom } from '../../utils/useFooterAwareBottom';
import Icon from './Icon';

// ❌ The 'setView' and 'currentView' props are no longer needed
const ToggleViewButton = () => {
    const location = useLocation(); // ✅ Get current location
    const bottom = useFooterAwareBottom();

    // ✅ Check the URL path to determine state
    const isCommunitysPage = location.pathname.startsWith('/community');

    const iconPath = isCommunitysPage ? ICONS.squares2x2 : ICONS.userGroup;
    const text = isCommunitysPage ? 'Creation Browser' : 'Communitys';
    const newPath = isCommunitysPage ? '/' : '/communitys';

    return (
        // ✅ The button is now a Link component
        <Link
            to={newPath}
            style={{ bottom }}
            className={`
                pc-floating-action pc-floating-action--left
                group fixed left-8 h-16 w-16 overflow-hidden
                bg-yellow-500 hover:bg-yellow-600
                text-white
                rounded-full
                flex items-center
                shadow-lg
                outline-none focus:outline-none
                focus-visible:ring-2 focus-visible:ring-yellow-700
                transition-all duration-300 ease-in-out
                hover:w-52
            `}
            aria-label={text}
        >
            <span className="pc-floating-icon flex h-16 w-16 flex-none items-center justify-center">
                <Icon
                    path={iconPath}
                    className="h-8 w-8"
                    strokeWidth={1.8}
                />
            </span>

            <span className="pc-floating-label max-w-0 overflow-hidden whitespace-nowrap font-bold opacity-0 transition-all duration-300 ease-in-out group-hover:max-w-36 group-hover:pr-3 group-hover:opacity-100">
                {text}
            </span>
        </Link>
    );
};

export default ToggleViewButton;
