import React from 'react';
import { Link } from 'react-router-dom';
import { buildCommunityPath } from '../../utils/communityRoutes';

const CommunityMembershipCard = ({ membership }) => {
    
    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#ffffff';
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    };

    return (
        <Link to={buildCommunityPath(membership.communitySlug)} className="block">
            <article className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden h-full transform hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                <div className="h-28 overflow-hidden">
                    <img
                        src={membership.communityBannerImageUrl || 'https://placehold.co/600x220/333333/ffffff?text=Community'}
                        alt={`${membership.communityName} banner`}
                        className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                    />
                </div>
                <div className="p-4 text-center">
                    <h4 className="font-bold text-lg text-gray-800 dark:text-gray-100 truncate" title={membership.communityName}>{membership.communityName}</h4>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-2 mb-1.5">Ranks</p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                        {membership.roles?.length > 0 && membership.ranks ? (
                            membership.roles.map(roleName => {
                                const rankInfo = membership.ranks.find(r => r.name.toLowerCase() === roleName.toLowerCase());
                                const bgColor = rankInfo ? rankInfo.color : '#D1D5DB';
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
                            <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2.5 py-1 rounded-full">Member</span>
                        )}
                    </div>
                </div>
            </article>
        </Link>
    );
};

export default CommunityMembershipCard;
