import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const CommunityInfoCard = ({ communityInfo, setModalMessage }) => {

    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#000000';
        try {
            const r = parseInt(hexColor.substr(1, 2), 16);
            const g = parseInt(hexColor.substr(3, 2), 16);
            const b = parseInt(hexColor.substr(5, 2), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? '#000000' : '#ffffff';
        } catch(e) { return '#000000'; }
    };

    const hexToRgba = (hex, alpha = 0.1) => {
        if (!hex) return `rgba(249, 250, 251, 1)`; // default light gray
        try {
            const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            const [r, g, b] = result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0,0,0];
            return `rgba(${r},${g},${b},${alpha})`;
        } catch (e) {
            return `rgba(249, 250, 251, 1)`;
        }
    };
    
    const handleCopyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setModalMessage("Copied to clipboard!");
    };

    const renderFieldValue = (field, value) => {
        if (value === undefined || value === null) return <p className="text-sm text-gray-400 italic">Not provided</p>;

        switch (field.type) {
            case 'textfield':
                if (field.isCopyable) {
                    return (
                        <button 
                            onClick={() => handleCopyToClipboard(value)}
                            className="w-full text-sm text-left text-gray-800 font-medium bg-gray-100 p-2 rounded hover:bg-gray-200 transition-colors flex items-center justify-between"
                            title="Click to copy"
                        >
                           <span className="break-all">{value}</span>
                           <Icon path={ICONS.copy} className="w-4 h-4 text-gray-500 flex-shrink-0 ml-2" />
                        </button>
                    );
                }
                return <p className="text-sm text-gray-800 font-medium bg-gray-100 p-2 rounded break-words">{value}</p>;
            case 'toggle':
                const isActive = !!value;
                const bgColor = isActive ? (field.toggleColors?.on || '#4ADE80') : (field.toggleColors?.off || '#D1D5DB');
                const textColor = getTextColorForBackground(bgColor);
                const label = isActive ? (field.toggleLabels?.on || 'On') : (field.toggleLabels?.off || 'Off');
                return <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ backgroundColor: bgColor, color: textColor }}>{label}</span>;
            case 'dropdown':
                 return <p className="text-sm text-gray-800 font-medium">{value}</p>;
            case 'checklist':
                return (
                    <ul className="space-y-1 text-left">
                        {field.options.map(option => (
                            <li 
                                key={option} 
                                className={`text-sm ${value[option] ? 'text-green-600 font-semibold' : 'text-gray-400 line-through'}`}
                            >
                                {option}
                            </li>
                        ))}
                    </ul>
                );
            default:
                return null;
        }
    };

    const themeColor = communityInfo.themeColor || '#6B7280';
    
    const nameStyle = {
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 4,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    };

    // Layout (von oben nach unten): Bild zentriert, Community-Name,
    // Ränge des Creators, creation-spezifische Community-Infos.
    return (
        <div
            className="bg-white rounded-lg shadow-md flex flex-col overflow-hidden ring-4"
            style={{ '--tw-ring-color': themeColor }}
        >
            <div
                className="w-full p-4 flex flex-col items-center text-center"
                style={{ backgroundColor: hexToRgba(themeColor) }}
            >
                <Link to={`/community/${communityInfo.slug}`} className="flex flex-col items-center">
                    <img
                        src={communityInfo.communityProfileImageUrl || 'https://placehold.co/96x96/e2e8f0/64748b?text=C'}
                        alt={`${communityInfo.communityName} profile`}
                        className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md mb-2"
                    />
                    <h4
                        className="font-bold text-lg text-gray-800 hover:underline break-all"
                        style={nameStyle}
                        title={communityInfo.communityName}
                    >
                        {communityInfo.communityName}
                    </h4>
                </Link>
                <div className="mt-3 pt-3 border-t w-full">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Creator's Ranks</p>
                    <div className="flex flex-wrap gap-1 justify-center">
                        {communityInfo.creatorRanksInCommunity?.map(rank => (
                             <span
                                key={rank.name}
                                className="text-xs font-semibold px-2 py-1 rounded-full capitalize"
                                style={{ backgroundColor: rank.color, color: getTextColorForBackground(rank.color) }}
                            >
                                {rank.name}
                            </span>
                        ))}
                         {(!communityInfo.creatorRanksInCommunity || communityInfo.creatorRanksInCommunity.length === 0) && (
                            <span className="text-xs bg-gray-200 px-2 py-1 rounded-full">Member</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="w-full p-4 flex flex-col items-center border-t">
                <div className="space-y-3 w-full max-w-xs">
                    {communityInfo.customFieldsSchema?.map(field => (
                        <div key={field.id} className="text-center">
                            <p className="text-sm font-bold text-gray-600">{field.label}</p>
                            <div className="mt-1 flex justify-center">
                               {renderFieldValue(field, communityInfo.customData?.[field.id])}
                            </div>
                        </div>
                    ))}
                    {(!communityInfo.customFieldsSchema || communityInfo.customFieldsSchema.length === 0) && (
                        <p className="text-sm text-gray-400 text-center">This community has no custom fields.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CommunityInfoCard;