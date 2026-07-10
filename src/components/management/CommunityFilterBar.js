import React, { useState, useRef, useEffect, useMemo } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

// Such-/Filterleiste im Look der Startseite (runde Suchleiste + runder
// Filter-Button mit Popover). Wird im Community-Manager und in allen
// Showcase-Untertabs verwendet. Die Theme-Farbe kommt über die CSS-Variable
// --theme-color der umgebenden Seite.
const CommunityFilterBar = ({
    searchTerm,
    onSearchChange,
    filters,            // { status, rank, tag, dlc, sort? }
    onFilterChange,     // (field, value) => void
    ranks = [],
    availableDlcs = [],
    statusOptions,      // [{ value, label }]
    sortOptions = null, // optional [{ value, label }]
    placeholder = 'Search by title, creator or tag...',
}) => {
    const [isFilterVisible, setIsFilterVisible] = useState(false);
    const filterMenuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
                setIsFilterVisible(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const isFilterActive = useMemo(() =>
        (filters.status && filters.status !== 'all') ||
        (filters.rank && filters.rank !== 'all') ||
        (filters.dlc && filters.dlc !== 'all') ||
        !!(filters.tag && filters.tag.trim()),
    [filters]);

    return (
        <div className="flex justify-center items-center mb-6 gap-2">
            <div className="relative flex-grow max-w-xl">
                <input
                    type="text"
                    placeholder={placeholder}
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full p-3 pl-10 pr-10 bg-gray-200 rounded-full focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--theme-color)' }}
                />
                <Icon path={ICONS.search} className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                {searchTerm && (
                    <button
                        onClick={() => onSearchChange('')}
                        className="absolute z-10 right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-300/50 transition-colors"
                        aria-label="Clear search"
                    >
                        <span className="text-2xl font-bold text-[--theme-color] pb-1">×</span>
                    </button>
                )}
            </div>
            <div className="relative" ref={filterMenuRef}>
                <button
                    onClick={() => setIsFilterVisible(!isFilterVisible)}
                    className={`p-3 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors duration-300 ${isFilterActive ? 'bg-[--theme-color] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                >
                    <Icon path={ICONS.filter} className="w-6 h-6" />
                </button>
                {isFilterVisible && (
                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl p-4 z-20 border">
                        <h4 className="font-bold mb-3 border-b pb-2">Filter{sortOptions ? ' & Sort' : ''}</h4>
                        <div className="space-y-4">
                            {sortOptions && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Sort by</label>
                                    <select value={filters.sort} onChange={(e) => onFilterChange('sort', e.target.value)} className="mt-1 block w-full p-2 border rounded-md shadow-sm bg-white">
                                        {sortOptions.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Status</label>
                                <select value={filters.status} onChange={(e) => onFilterChange('status', e.target.value)} className="mt-1 block w-full p-2 border rounded-md shadow-sm bg-white">
                                    {statusOptions.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Creator Rank</label>
                                <select value={filters.rank} onChange={(e) => onFilterChange('rank', e.target.value)} className="mt-1 block w-full p-2 border rounded-md shadow-sm bg-white">
                                    <option value="all">All Ranks</option>
                                    {ranks.map(rank => (<option key={rank.name} value={rank.name.toLowerCase()}>{rank.name}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Tag</label>
                                <input type="text" placeholder="e.g. Coaster" value={filters.tag} onChange={(e) => onFilterChange('tag', e.target.value)} className="mt-1 block w-full p-2 border rounded-md shadow-sm" />
                            </div>
                            {availableDlcs.length > 0 && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Required DLC</label>
                                    <select value={filters.dlc} onChange={(e) => onFilterChange('dlc', e.target.value)} className="mt-1 block w-full p-2 border rounded-md shadow-sm bg-white">
                                        <option value="all">All DLCs</option>
                                        {availableDlcs.map(dlc => (<option key={dlc} value={dlc}>{dlc}</option>))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Gemeinsame Filterlogik für Creation-Objekte (Status separat, da die
// Status-Optionen je nach Kontext variieren).
export const creationMatchesFilters = (creation, { searchTerm, rank, tag, dlc }) => {
    if (rank && rank !== 'all' && !(creation.creatorRanks || []).some(r => r.name.toLowerCase() === rank)) return false;
    if (dlc && dlc !== 'all' && !(creation.requiredDlcs || []).includes(dlc)) return false;
    const tagTerm = (tag || '').trim().toLowerCase();
    if (tagTerm && !(creation.tags || []).some(t => t.toLowerCase().includes(tagTerm))) return false;
    const term = (searchTerm || '').trim().toLowerCase();
    if (term &&
        !creation.title?.toLowerCase().includes(term) &&
        !creation.username?.toLowerCase().includes(term) &&
        !(creation.tags || []).some(t => t.toLowerCase().includes(term))) return false;
    return true;
};

export default CommunityFilterBar;
