import React, { useState, useEffect, useRef } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import useHoverSlideshow from '../../hooks/useHoverSlideshow';

const ManagedCreationCard = ({ creation, onPinToggle, onUnlink, onClick, onMarkForShowcase }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef(null);
    const { imgSrc, onMouseEnter, onMouseLeave } = useHoverSlideshow(creation);

    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#ffffff';
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleMenuToggle = (e) => {
        e.stopPropagation();
        setIsMenuOpen(!isMenuOpen);
    };

    const handleActionClick = (e, action) => {
        e.stopPropagation();
        action();
        setIsMenuOpen(false);
    };

    return (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden flex flex-col h-full relative group" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
            <button onClick={onClick} className="w-full h-full text-left focus:outline-none">
                <div className="relative">
                    <div className="overflow-hidden h-40">
                        <img
                            src={imgSrc}
                            alt={creation.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x225/333333/ffffff?text=Image+Missing'; }}
                        />
                    </div>
                </div>
                <div className="p-3 flex flex-col flex-grow">
                    <h3 className="text-lg font-bold truncate text-center" title={creation.title}>{creation.title}</h3>
                    <p className="text-sm text-gray-500 text-center">by {creation.username}</p>
                </div>
            </button>

            <div className="p-3 border-t mt-auto">
                <p className="text-xs font-semibold text-gray-600 mb-2">Creator's Ranks:</p>
                <div className="flex flex-wrap gap-1">
                    {creation.creatorRanks && creation.creatorRanks.length > 0 ? (
                        creation.creatorRanks.map(rank => {
                            const bgColor = rank.color || '#6B7280';
                            const textColor = getTextColorForBackground(bgColor);
                            return (
                                <span key={rank.name} className="text-xs font-semibold px-2 py-1 rounded-full capitalize" style={{ backgroundColor: bgColor, color: textColor }}>
                                    {rank.name}
                                </span>
                            );
                        })
                    ) : (
                        <span className="text-xs bg-gray-200 px-2 py-1 rounded-full">Member</span>
                    )}
                </div>
            </div>

            <div ref={menuRef} className="absolute top-2 left-2 z-10">
                <button onClick={handleMenuToggle} className="w-8 h-8 rounded-full bg-black bg-opacity-60 text-white flex items-center justify-center hover:bg-opacity-80 transition-all">
                    <Icon path={ICONS.chevronDown} className="w-5 h-5" />
                </button>
                {isMenuOpen && (
                    <div className="absolute top-10 left-0 w-48 bg-white rounded-md shadow-lg border z-20">
                        <button onClick={(e) => handleActionClick(e, onPinToggle)} className="w-full text-left flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            <Icon path={ICONS.star} className="w-4 h-4 mr-3" solid={creation.pinned} />
                            {creation.pinned ? 'Unpin' : 'Pin'}
                        </button>
                        <button onClick={(e) => handleActionClick(e, onMarkForShowcase)} className="w-full text-left flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            <Icon path={ICONS.checklist} className="w-4 h-4 mr-3" />
                            Mark for Showcase
                        </button>
                        {/* ✅ REMOVED: "Assign Showcase Video" button is no longer here */}
                        <button onClick={(e) => handleActionClick(e, onUnlink)} className="w-full text-left flex items-center px-4 py-2 text-sm text-red-700 hover:bg-red-50">
                             <Icon path={ICONS.trash} className="w-4 h-4 mr-3" solid />
                             Unlink
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ManagedCreationCard;
