import React from 'react';
import { Link } from 'react-router-dom';

const CommunityMembershipCard = ({ membership }) => {
    
    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#ffffff';
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    };

    const slugify = (text) => {
        if (!text) return '';
        return text.toString().toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
    };

    return (
        <Link to={`/community/${slugify(membership.communityName)}`}>
            <div className="bg-white rounded-lg shadow-md p-4 flex flex-col h-full transform hover:-translate-y-1 transition-transform duration-300">
                <div className="flex items-center mb-3">
                    <img 
                        src={membership.communityProfileImageUrl || 'https://placehold.co/48x48/e2e8f0/64748b?text=C'} 
                        alt={`${membership.communityName} profile`}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0 mr-4"
                    />
                    <h4 className="font-bold text-lg text-gray-800 truncate">{membership.communityName}</h4>
                </div>
                <div>
                    <p className="text-sm font-semibold text-gray-600 mb-2">Ranks:</p>
                    <div className="flex flex-wrap gap-2">
                        {membership.roles && membership.ranks ? (
                            membership.roles.map(roleName => {
                                const rankInfo = membership.ranks.find(r => r.name.toLowerCase() === roleName.toLowerCase());
                                const bgColor = rankInfo ? rankInfo.color : '#6B7280';
                                const textColor = getTextColorForBackground(bgColor);

                                return (
                                    <span 
                                        key={roleName}
                                        className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize"
                                        style={{ backgroundColor: bgColor, color: textColor }}
                                    >
                                        {roleName}
                                    </span>
                                );
                            })
                        ) : (
                            <span className="text-xs bg-gray-200 px-2.5 py-1 rounded-full">Member</span>
                        )}
                    </div>
                </div>
            </div>
        </Link>
    );
};

export default CommunityMembershipCard;