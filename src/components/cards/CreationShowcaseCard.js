import React from 'react';
import { ICONS } from '../../utils/helpers';
import Icon from '../ui/Icon';

const CreationShowcaseCard = ({ creation, community, setPopoverView, setModalMessage, onRemoveFromGroup, children }) => {

    const handleCopy = (text, fieldName) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setModalMessage(`${fieldName} copied to clipboard!`);
    };

    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#ffffff';
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    };

    const customData = creation.communitySpecificData?.[community.id] || {};

    return (
        <div className="bg-white p-3 rounded-lg shadow border w-full">
            <div className="flex justify-between items-start">
                <button 
                    onClick={() => setPopoverView({ name: 'detail', id: creation.id })} 
                    className="font-bold text-blue-600 hover:underline text-left text-lg"
                >
                    {creation.title}
                </button>
                {/* ✅ Button is now conditional and will only show if the function is provided */}
                {onRemoveFromGroup && (
                    <button onClick={onRemoveFromGroup} className="p-1 text-gray-400 hover:text-red-600" title="Remove from Group">
                        <Icon path={ICONS.xMark} className="w-4 h-4" />
                    </button>
                )}
            </div>
            
            <div className="mt-2 pt-2 border-t">
                <button 
                    onClick={() => setPopoverView({ name: 'profile', userId: creation.userId })}
                    className="flex items-center space-x-2 text-sm text-gray-600 hover:text-black"
                >
                    <span className="font-semibold">{creation.username}</span>
                    <div className="flex flex-wrap gap-1">
                        {creation.creatorRanks?.map(rank => (
                            <span 
                                key={rank.name}
                                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: rank.color, color: getTextColorForBackground(rank.color) }}
                            >
                                {rank.name}
                            </span>
                        ))}
                    </div>
                </button>
            </div>

            {creation.shareCode && (
                <div className="mt-2">
                    <button 
                        onClick={() => handleCopy(creation.shareCode, 'Share Code')}
                        className="w-full flex items-center justify-between text-left p-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                    >
                        <span className="text-xs font-mono text-gray-700">{creation.shareCode}</span>
                        <Icon path={ICONS.copy} className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    </button>
                </div>
            )}
            
            {community.customCreationFields?.map(field => {
                const value = customData[field.id];
                if (!value) return null;
                return (
                    <div key={field.id} className="mt-2">
                         <button
                            onClick={() => handleCopy(value, field.label)}
                            className="w-full flex items-center justify-between text-left p-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                        >
                            <div>
                                <p className="text-xs font-bold text-gray-500">{field.label}</p>
                                <p className="text-sm text-gray-800">{value}</p>
                            </div>
                            <Icon path={ICONS.copy} className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        </button>
                    </div>
                );
            })}

            {/* Zusatzinhalt (z.B. Tags + Aktions-Buttons) innerhalb der Karte */}
            {children}
        </div>
    );
};

export default CreationShowcaseCard;