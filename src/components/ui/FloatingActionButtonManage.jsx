import React from 'react';
import { Link } from 'react-router-dom';
import { ICONS } from '../../utils/helpers';
import { useFooterAwareBottom } from '../../utils/useFooterAwareBottom';
import Icon from './Icon';

const FloatingActionButtonManage = ({ communityId }) => {
    const bottom = useFooterAwareBottom();
    return (
        <Link
            to={`/manager/${communityId}`}
            style={{ bottom }}
            className={`
                pc-floating-action pc-floating-action--right
                group fixed right-8 h-16 w-16
                bg-purple-600 hover:bg-purple-700 
                text-white 
                rounded-full 
                flex items-center justify-center 
                shadow-lg 
                outline-none focus:outline-none
                focus-visible:ring-2 focus-visible:ring-purple-500
                transition-all duration-300 ease-in-out
                hover:w-64
            `}
            aria-label="Manage Your Community"
        >
            <div className="flex items-center justify-center">
                <Icon path={ICONS.cog} className="pc-floating-icon w-8 h-8 flex-shrink-0" solid />
                <div className="pc-floating-label overflow-hidden max-w-0 group-hover:max-w-xs transition-all duration-300 ease-in-out">
                    <span className="pl-2 font-bold whitespace-nowrap">
                        Manage Your Community
                    </span>
                </div>
            </div>
        </Link>
    );
};

export default FloatingActionButtonManage;
