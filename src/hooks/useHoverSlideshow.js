import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCreationById } from '../firebase/creationsService';
import { getYoutubeThumbnailUrl } from '../utils/helpers';

// Hover-Slideshow für Creation-Karten. Index-Einträge (__fromIndex, z. B.
// Community-Seite und Community-Manager) enthalten nur das erste Bild — beim
// Hover wird die volle Creation nachgeladen (gleicher React-Query-Key wie der
// Detail-Prefetch der Karte → keine doppelten Reads). Die Slideshow startet
// effektbasiert, sobald mehrere Bilder verfügbar sind — auch wenn sie erst
// während des Hovers eintreffen.
export default function useHoverSlideshow(creation) {
    const [isHovering, setIsHovering] = useState(false);
    const [hoverIndex, setHoverIndex] = useState(0);

    const needsFullDoc = !!creation.__fromIndex;
    const { data: fullCreation } = useQuery({
        queryKey: ['creation', creation.id],
        queryFn: () => fetchCreationById(creation.id),
        enabled: isHovering && needsFullDoc,
        staleTime: 5 * 60 * 1000,
    });

    const sourceImages = (needsFullDoc && fullCreation?.imageUrls?.length
        ? fullCreation.imageUrls
        : creation.imageUrls) || [];
    const slideshowImages = sourceImages.filter(Boolean);

    useEffect(() => {
        if (!isHovering || slideshowImages.length < 2) return undefined;
        const interval = setInterval(() => {
            setHoverIndex(prev => (prev + 1) % slideshowImages.length);
        }, 1500);
        return () => clearInterval(interval);
    }, [isHovering, slideshowImages.length]);

    useEffect(() => {
        if (!isHovering) setHoverIndex(0);
    }, [isHovering]);

    const videoUrls = creation.videoUrls || [];
    const fallbackThumbnail = videoUrls.length > 0
        ? getYoutubeThumbnailUrl(videoUrls[0])
        : 'https://placehold.co/400x225/333333/ffffff?text=No+Media';
    const imgSrc = slideshowImages.length > 0
        ? slideshowImages[hoverIndex % slideshowImages.length]
        : fallbackThumbnail;

    return {
        imgSrc,
        onMouseEnter: () => setIsHovering(true),
        onMouseLeave: () => setIsHovering(false),
    };
}
