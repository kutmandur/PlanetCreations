import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ICONS } from '../../utils/helpers';
import Icon from '../ui/Icon';

const EventCreationCard = ({ 
    creation, 
    community,
    creatorRanks,
    onClick,
    onVote, 
    isVoted,
    voteCount,
    isVotingActive,
    isVotingOver,
    voteLimitReached
}) => {
    const [hoverIndex, setHoverIndex] = useState(0);
    const intervalRef = useRef(null);

    const imageUrls = creation.imageUrls || [];
    const videoUrls = creation.videoUrls || [];

    const getYoutubeThumbnail = (url) => {
        if (!url) return null;
        const videoId = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
        return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    };
    
    const mediaThumbnails = [
        ...imageUrls,
        ...videoUrls.map(getYoutubeThumbnail)
    ].filter(Boolean);

    const initialThumbnail = mediaThumbnails.length > 0 
        ? mediaThumbnails[0] 
        : 'https://placehold.co/400x225/333333/ffffff?text=No+Media';

    const startSlideshow = () => {
        if (mediaThumbnails.length > 1) {
            intervalRef.current = setInterval(() => {
                setHoverIndex(prevIndex => (prevIndex + 1) % mediaThumbnails.length);
            }, 1500);
        }
    };

    const stopSlideshow = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
        setHoverIndex(0);
    };

    const hexToRgba = (hex, alpha = 0.1) => {
        if (!hex) return `rgba(255, 255, 255, 1)`;
        try {
            const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            const [r, g, b] = result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0,0,0];
            return `rgba(${r},${g},${b},${alpha})`;
        } catch (e) {
            return `rgba(255, 255, 255, 1)`;
        }
    };

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

    const themeColor = community?.themeColor || '#F97316';
    const backgroundColor = hexToRgba(themeColor, 0.2);

    const renderVoteSection = () => {
        const handleVoteClick = (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            if(onVote) onVote();
        };
        
        if (isVotingOver) {
            return (
                <div className="w-full text-center font-bold text-lg text-green-700 bg-green-100 py-2 px-6 rounded-lg flex items-center justify-center">
                    <Icon path={ICONS.thumbUp} className="w-6 h-6 mr-2" solid />
                    <span>{voteCount} Vote(s)</span>
                </div>
            );
        }

        if (!isVotingActive) {
            return <div className="text-gray-500 text-sm text-center w-full">Voting has not started or has ended.</div>;
        }

        if (isVoted) {
            return (
                <button
                    onClick={handleVoteClick}
                    className="w-full font-bold py-2 px-6 rounded-lg flex items-center justify-center text-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
                >
                    <Icon path={ICONS.thumbUp} className="w-6 h-6 mr-2" solid />
                    Voted
                </button>
            );
        }

        if (voteLimitReached) {
            return (
                <button
                    disabled
                    className="w-full font-bold py-2 px-6 rounded-lg flex items-center justify-center text-lg bg-red-200 text-red-600 cursor-not-allowed"
                >
                    <Icon path={ICONS.lockClosed} className="w-6 h-6 mr-2" solid />
                    Vote limit reached
                </button>
            );
        }

        return (
             <button
                onClick={handleVoteClick}
                className="w-full font-bold py-2 px-6 rounded-lg flex items-center justify-center text-lg bg-green-100 text-green-800 hover:bg-green-200 transition-colors"
            >
                <Icon path={ICONS.thumbUp} className="w-6 h-6 mr-2" />
                Vote Now
            </button>
        );
    };

    return (
        <article 
            className="rounded-lg shadow-md overflow-hidden transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer flex flex-col relative group h-full ring-4"
            onMouseEnter={startSlideshow}
            onMouseLeave={stopSlideshow}
            onClick={onClick}
            style={{
                backgroundColor: backgroundColor,
                '--tw-ring-color': themeColor 
            }}
        >
            <div className="relative h-48 overflow-hidden">
                <img 
                    src={mediaThumbnails[hoverIndex] || initialThumbnail} 
                    alt={creation.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x225/333333/ffffff?text=Image+Missing'; }}
                />
                <div className="absolute top-2 right-2 flex flex-col items-center gap-y-2">
                    <div className={`w-3 h-3 rounded-full ring-2 ring-white ${creation.status === 'finished' ? 'bg-green-500' : 'bg-orange-500'}`} title={creation.status === 'finished' ? 'Finished' : 'Work in Progress'}></div>
                    {creation.modStatus === 'UsingMods' && <div className="w-3 h-3 rounded-full ring-2 ring-white bg-purple-500" title="Uses Mods"></div>}
                </div>
            </div>
            <div className="p-4 flex flex-col flex-grow">
                <h3 className="text-xl font-bold mb-2 truncate text-center" title={creation.title}>{creation.title}</h3>
                <div className="flex items-center text-gray-700 text-sm mb-2">
                    <Link to={`/profile/${creation.userId}`} className="hover:underline flex items-center" onClick={(e) => e.stopPropagation()}>
                        <img src={creation.userProfilePictureUrl || 'https://placehold.co/24x24/e2e8f0/64748b?text=P'} alt={creation.username} className="w-6 h-6 rounded-full mr-2 border-2 border-gray-300" />
                        <span className="font-semibold">{creation.username}</span>
                    </Link>
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                    {creatorRanks && creatorRanks.length > 0 ? (
                        creatorRanks.map(rank => (
                            <span 
                                key={rank.name}
                                className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize"
                                style={{ backgroundColor: rank.color, color: getTextColorForBackground(rank.color) }}
                            >
                                {rank.name}
                            </span>
                        ))
                    ) : (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-800">
                            Member
                        </span>
                    )}
                </div>
                <div className="mt-auto pt-3 border-t flex items-center justify-center">
                    {renderVoteSection()}
                </div>
            </div>
        </article>
    );
};

export default EventCreationCard;
