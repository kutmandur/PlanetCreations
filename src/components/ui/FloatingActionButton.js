import React from 'react';
import { getGameColor, ICONS } from '../../utils/helpers';
import Icon from './Icon';

const FloatingActionButton = ({ activeTab }) => {
    const color = getGameColor(activeTab);

    return (
        <div
            className={`
                group fixed bottom-8 right-8 h-16
                ${color.bg} ${color.hoverBg} 
                text-white 
                rounded-full 
                flex items-center justify-center 
                shadow-lg 
                focus:outline-none focus:ring-2 focus:ring-offset-2 ${color.ring}
                transition-all duration-300 ease-in-out
                w-16 hover:w-48
            `}
            aria-label="New Creation"
        >
            <div className="flex items-center justify-center">
                <Icon path={ICONS.plus} className="w-8 h-8 flex-shrink-0" />
                <div className="overflow-hidden max-w-0 group-hover:max-w-xs transition-all duration-300 ease-in-out">
                    <span className="pl-2 font-bold whitespace-nowrap">
                        New Creation
                    </span>
                </div>
            </div>
        </div>
    );
};

export default FloatingActionButton;
