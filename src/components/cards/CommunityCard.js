import React, { useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { getGameColor } from '../../utils/helpers';
import { useQueryClient } from '@tanstack/react-query';
import { fetchCommunityBySlug } from '../../firebase/communitiesService';
import { preloadComponent } from '../../utils/preload';

// Hilfsfunktion außerhalb der Komponente (kein Re-Create bei jedem Render)
const hexToRgba = (hex, alpha = 0.1) => {
    if (!hex) return `rgba(209, 213, 219, ${alpha})`;
    try {
        const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
        return `rgba(${r},${g},${b},${alpha})`;
    } catch (e) {
        return `rgba(209, 213, 219, ${alpha})`;
    }
};

const GAME_PILLS = {
    'planet-coaster': 'PC1',
    'planet-coaster-2': 'PC2',
    'planet-zoo': 'PZ'
};

const CommunityCard = memo(({ community }) => {
    const queryClient = useQueryClient();

    const themeColor = community.themeColor || '#6B7280';
    const allowedGames = community.allowedGames || ['planet-coaster', 'planet-coaster-2', 'planet-zoo'];

    const handlePrefetch = useCallback(() => {
        if (community.slug) {
            queryClient.prefetchQuery({
                queryKey: ['community', community.slug],
                queryFn: () => fetchCommunityBySlug(community.slug),
            });
        }
        preloadComponent('CommunityDetailPage');
    }, [queryClient, community.slug]);

    return (
        <Link 
            to={`/community/${community.slug}`}
            onMouseEnter={handlePrefetch}
            onTouchStart={handlePrefetch}
        >
            <article 
                className="bg-white rounded-lg shadow-lg overflow-hidden transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer flex flex-col relative group h-full ring-4"
                style={{ '--tw-ring-color': themeColor }}
            >
                <div className="overflow-hidden h-48">
                    <img 
                        src={community.bannerImageUrl || 'https://placehold.co/400x225/333333/ffffff?text=Community'} 
                        alt={`${community.name} banner`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                    />
                </div>
                <div 
                    className="p-4 flex flex-col flex-grow"
                    style={{ backgroundColor: hexToRgba(themeColor) }}
                >
                    <h3 className="text-xl font-bold mb-2 truncate" title={community.name}>{community.name}</h3>
                    <p className="text-gray-600 flex-grow text-sm mb-4 h-10 overflow-hidden">
                        {community.description}
                    </p>
                    <div className="flex justify-between items-center mt-auto pt-2 border-t" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
                        <div className="text-sm text-gray-500">
                            by <span className="font-semibold text-gray-700">{community.ownerUsername}</span>
                        </div>
                        <div className="text-sm font-semibold text-gray-800">
                            {community.memberCount} Members
                        </div>
                    </div>
                    <div className="flex justify-center items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                        {allowedGames.map(gameId => {
                             const color = getGameColor(gameId);
                             return (
                                <span key={gameId} className={`px-2 py-1 text-xs font-bold text-white rounded-full ${color.bg}`}>
                                    {GAME_PILLS[gameId] || gameId}
                                </span>
                             );
                        })}
                    </div>
                </div>
            </article>
        </Link>
    );
});

export default CommunityCard;