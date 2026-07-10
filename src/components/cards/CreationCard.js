import React, { useState, useRef, useCallback, memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { fetchCreationById } from '../../firebase/creationsService';
import { ICONS, getYoutubeThumbnailUrl } from '../../utils/helpers';
import Icon from '../ui/Icon';
import { preloadComponent } from '../../utils/preload';

// Hilfsfunktion außerhalb der Komponente (kein Re-Create bei jedem Render)
const getYoutubeThumbnail = (url) => getYoutubeThumbnailUrl(url);

const CreationCard = memo(({ creation, isLink = true, onTagClick }) => {
    const queryClient = useQueryClient();
    const [hoverIndex, setHoverIndex] = useState(0);
    const intervalRef = useRef(null);
    const navigate = useNavigate();

    const imageUrls = creation.imageUrls || [];
    const videoUrls = creation.videoUrls || [];

    const slideshowImages = imageUrls.filter(Boolean);
    const initialThumbnail = imageUrls.length > 0 ? imageUrls[0] : videoUrls.length > 0 ? getYoutubeThumbnail(videoUrls[0]) : 'https://placehold.co/400x225/333333/ffffff?text=No+Media';

    const handlePrefetch = useCallback(() => {
        // Prefetch der Creation-Daten via React Query
        queryClient.prefetchQuery({
            queryKey: ['creation', creation.id],
            queryFn: () => fetchCreationById(creation.id),
        });

        // Prefetch des Creator-Profils (wichtig für schnelle Detail-Ansicht)
        if (creation.userId) {
            queryClient.prefetchQuery({
                queryKey: ['profile', creation.userId],
                queryFn: async () => {
                    const snap = await getDoc(doc(db, 'profiles', creation.userId));
                    return snap.exists() ? snap.data() : null;
                },
            });
        }

        // Preload der CreationDetail Komponente
        preloadComponent('CreationDetail');
    }, [queryClient, creation.id, creation.userId]);

    const startSlideshow = useCallback(() => {
        if (intervalRef.current) return;
        if (slideshowImages.length > 1) {
            intervalRef.current = setInterval(() => {
                setHoverIndex(prevIndex => (prevIndex + 1) % slideshowImages.length);
            }, 1500);
        }
    }, [slideshowImages.length]);

    const handleMouseEnter = useCallback(() => {
        startSlideshow();
        handlePrefetch();
    }, [startSlideshow, handlePrefetch]);

    const stopSlideshow = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        setHoverIndex(0);
    }, []);

    const handleProfileClick = useCallback((e) => {
        e.stopPropagation();
        preloadComponent('ProfilePage');
        navigate(`/profile/${creation.userId}`);
    }, [navigate, creation.userId]);

    const handleTagClick = useCallback((e, tag) => {
        e.preventDefault();
        e.stopPropagation();
        if (onTagClick) {
            onTagClick(tag);
        }
    }, [onTagClick]);

    const CardContent = () => (
        <article className="bg-white rounded-lg shadow-md overflow-hidden transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer flex flex-col relative group h-full">
            <div className="relative h-48 overflow-hidden">
                <img 
                    src={slideshowImages[hoverIndex] || initialThumbnail} 
                    alt={creation.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x225/333333/ffffff?text=Image+Missing'; }}
                />
                <div className="absolute top-2 right-2 flex flex-col items-center gap-y-2">
                    <div className={`w-3 h-3 rounded-full ring-2 ring-white ${creation.status === 'finished' ? 'bg-green-500' : 'bg-orange-500'}`} title={creation.status === 'finished' ? 'Finished' : 'Work in Progress'}></div>
                    {creation.modStatus === 'UsingMods' && <div className="w-3 h-3 rounded-full ring-2 ring-white bg-purple-500" title="Uses Mods"></div>}
                </div>
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 text-white px-2 py-1 rounded-md text-xs font-semibold">
                    <div onClick={handleProfileClick} className="hover:underline flex items-center">
                        <img src={creation.userProfilePictureUrl || 'https://placehold.co/24x24/e2e8f0/64748b?text=P'} alt={creation.username} className="w-6 h-6 rounded-full mr-2 border-2 border-white" />
                        <span>
                            {creation.username}
                        </span>
                    </div>
                </div>
            </div>

            <div className="p-4 flex flex-col flex-grow">
                <h3 className="text-xl font-bold mb-2 truncate" title={creation.title}>{creation.title}</h3>
                <p className="text-gray-600 flex-grow text-sm mb-4 h-10 overflow-hidden">
                    {creation.description}
                </p>
                <div className="flex justify-between items-center mt-auto pt-2 border-t">
                    <div className="flex space-x-3 text-sm">
                        <span className="flex items-center"><Icon path={ICONS.thumbUp} className="w-5 h-5 mr-1 text-green-500" solid/> {creation.likes || 0}</span>
                        <span className="flex items-center"><Icon path={ICONS.thumbDown} className="w-5 h-5 mr-1 text-red-500" solid/> {creation.dislikes || 0}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                        {creation.tags?.slice(0, 2).map(tag => (
                            <button
                                key={tag}
                                onClick={(e) => handleTagClick(e, tag)}
                                className={`text-xs bg-gray-200 px-2 py-1 rounded-full ${onTagClick ? 'hover:bg-gray-300 transition-colors cursor-pointer' : 'cursor-default'}`}
                                disabled={!onTagClick}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </article>
    );

    return isLink ? (
        <Link 
            to={`/creation/${creation.id}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={stopSlideshow}
            onTouchStart={handlePrefetch}
        >
            <CardContent />
        </Link>
    ) : (
        <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={stopSlideshow}
            onTouchStart={handlePrefetch}
        >
            <CardContent />
        </div>
    );
});

export default CreationCard;