import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getYoutubeThumbnailUrl } from '../../utils/helpers';
import { useYoutubeChannelFeed } from '../../hooks/youtubeChannelFeed';
import Spinner from '../ui/Spinner';
import CommunityFilterBar from '../management/CommunityFilterBar';

// Kleine Creation-Vorschau mit Titel + Ersteller als Overlay über dem Bild
const CreationPreviewTile = ({ creation }) => {
    const thumb = creation.imageUrls?.[0]
        || getYoutubeThumbnailUrl(creation.videoUrls?.[0], 'mqdefault')
        || 'https://placehold.co/320x180/333333/ffffff?text=No+Media';
    return (
        <Link to={`/creation/${creation.id}`} className="relative block h-20 rounded-md overflow-hidden group">
            <img src={thumb} alt={creation.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            <div className="absolute inset-0 bg-black/45 group-hover:bg-black/30 transition-colors flex flex-col items-center justify-center text-white text-center px-1">
                <p className="text-xs font-bold truncate w-full" title={creation.title}>{creation.title}</p>
                <p className="text-[10px] truncate w-full opacity-80">by {creation.username}</p>
            </div>
        </Link>
    );
};

// Video-Karte: großes YouTube-Thumbnail mit Play-Overlay, öffnet das Video.
// aspect-video (16:9) statt fester Höhe, damit das Thumbnail nicht beschnitten wird.
const VideoThumb = ({ url, children }) => (
    <a href={url} target="_blank" rel="noopener noreferrer" className="relative block aspect-video overflow-hidden group">
        <img
            src={getYoutubeThumbnailUrl(url) || 'https://placehold.co/480x270/333333/ffffff?text=Video'}
            alt="Video thumbnail"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-black/60 group-hover:bg-red-600 transition-colors flex items-center justify-center">
                <div className="w-0 h-0 border-y-8 border-y-transparent border-l-[14px] border-l-white ml-1" />
            </div>
        </div>
        {children}
    </a>
);

const CommunityVideosTab = ({ community, creations, events }) => {
    // YouTube-Untertab nur, wenn in den Community-Settings ein Kanal verlinkt ist
    const youtubeChannelUrl = community.socialLinks?.youtube || null;
    const subTabs = useMemo(() =>
        youtubeChannelUrl ? ['Youtube', 'Showcases', 'Events'] : ['Showcases', 'Events'],
        [youtubeChannelUrl]);

    const [activeSubTab, setActiveSubTab] = useState(subTabs[0]);

    // Kanal-Videos über den geteilten Hook laden (Prefetch passiert bereits beim
    // Laden der Community-Seite, daher meist sofort aus dem Cache verfügbar).
    const { data: channelFeed, isLoading: feedLoading, error: feedError } = useYoutubeChannelFeed(youtubeChannelUrl);

    // Showcases: Creations mit derselben showcaseVideoUrl gehören zu einem Showcase
    const showcases = useMemo(() => {
        const byUrl = new Map();
        creations.forEach(c => {
            if (!c.showcaseVideoUrl) return;
            if (!byUrl.has(c.showcaseVideoUrl)) byUrl.set(c.showcaseVideoUrl, []);
            byUrl.get(c.showcaseVideoUrl).push(c);
        });
        return [...byUrl.entries()].map(([url, list]) => ({
            url,
            name: list.find(c => c.showcaseName)?.showcaseName || null,
            creations: list,
        }));
    }, [creations]);

    // Videos aus Community-Events
    const eventVideos = useMemo(() =>
        events.flatMap(event => (event.videoUrls || []).map(url => ({ url, event }))),
        [events]);

    // Suche/Filter für die Untertabs Showcases und Events
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ status: 'all', rank: 'all', tag: '', dlc: 'all' });
    const [eventFilter, setEventFilter] = useState('all');
    const handleFilterChange = (field, value) => setFilters(prev => ({ ...prev, [field]: value }));

    const availableDlcs = useMemo(() => {
        const dlcs = new Set();
        showcases.forEach(s => s.creations.forEach(c => (c.requiredDlcs || []).forEach(dlc => dlcs.add(dlc))));
        return [...dlcs].sort();
    }, [showcases]);

    const anyFilterActive =
        searchTerm.trim() !== '' || filters.status !== 'all' || filters.rank !== 'all' ||
        filters.dlc !== 'all' || filters.tag.trim() !== '';

    // Index-Einträge haben creatorRoles (Strings), daher eigene Prüfung
    const matchesCreation = (creation) => {
        if (filters.status !== 'all' && creation.status !== filters.status) return false;
        if (filters.rank !== 'all' && !(creation.creatorRoles || []).some(r => r.toLowerCase() === filters.rank)) return false;
        if (filters.dlc !== 'all' && !(creation.requiredDlcs || []).includes(filters.dlc)) return false;
        const tagTerm = filters.tag.trim().toLowerCase();
        if (tagTerm && !(creation.tags || []).some(t => t.toLowerCase().includes(tagTerm))) return false;
        const term = searchTerm.trim().toLowerCase();
        if (term &&
            !creation.title?.toLowerCase().includes(term) &&
            !creation.username?.toLowerCase().includes(term) &&
            !(creation.tags || []).some(t => t.toLowerCase().includes(term))) return false;
        return true;
    };

    const filteredShowcases = useMemo(() =>
        showcases.map(showcase => ({
            ...showcase,
            visibleCreations: anyFilterActive ? showcase.creations.filter(matchesCreation) : showcase.creations,
        })).filter(showcase => showcase.visibleCreations.length > 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [showcases, searchTerm, filters]);

    // Events mit Videos für den Event-Filter
    const eventsWithVideos = useMemo(() =>
        events.filter(e => e.videoUrls?.length > 0),
        [events]);

    const filteredEventVideos = useMemo(() =>
        eventVideos.filter(({ event }) => {
            if (eventFilter !== 'all' && event.id !== eventFilter) return false;
            const term = searchTerm.trim().toLowerCase();
            if (term && !event.title?.toLowerCase().includes(term)) return false;
            return true;
        }),
        [eventVideos, eventFilter, searchTerm]);

    return (
        <div>
            <div className="flex justify-center mb-8">
                <div className="relative flex items-center bg-gray-200 dark:bg-gray-700 rounded-full p-1 shadow-inner overflow-x-auto">
                    {subTabs.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveSubTab(tab)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${activeSubTab === tab ? 'community-bg text-white' : 'text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white'}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {activeSubTab === 'Youtube' && (
                feedLoading ? (
                    <div className="py-16"><Spinner /></div>
                ) : feedError ? (
                    <p className="text-center text-gray-500 dark:text-gray-400 mt-10 py-10 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                        Could not load channel videos. Please check the YouTube link in the community settings.
                    </p>
                ) : (channelFeed?.videos?.length > 0 ? (
                    <>
                        {channelFeed.channelTitle && (
                            <p className="text-center text-gray-500 dark:text-gray-400 mb-4">
                                Latest videos from{' '}
                                <a href={youtubeChannelUrl} target="_blank" rel="noopener noreferrer" className="font-semibold community-text hover:underline">
                                    {channelFeed.channelTitle}
                                </a>
                            </p>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {channelFeed.videos.map(video => (
                                <div key={video.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
                                    <VideoThumb url={`https://www.youtube.com/watch?v=${video.id}`} />
                                    <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="block p-3 hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <p className="font-bold line-clamp-2" title={video.title}>{video.title}</p>
                                        {video.published && (
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{new Date(video.published).toLocaleDateString()}</p>
                                        )}
                                    </a>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <p className="text-center text-gray-500 dark:text-gray-400 mt-10 py-10 bg-white dark:bg-gray-800 rounded-lg shadow-md">This channel has no videos yet.</p>
                ))
            )}

            {activeSubTab === 'Showcases' && (
                <>
                    {showcases.length > 0 && (
                        <CommunityFilterBar
                            searchTerm={searchTerm}
                            onSearchChange={setSearchTerm}
                            filters={filters}
                            onFilterChange={handleFilterChange}
                            ranks={community.ranks || []}
                            availableDlcs={availableDlcs}
                            statusOptions={[
                                { value: 'all', label: 'All Statuses' },
                                { value: 'finished', label: 'Finished' },
                                { value: 'wip', label: 'Work in Progress' },
                            ]}
                            placeholder="Search showcased creations..."
                        />
                    )}
                    {showcases.length === 0 ? (
                        <p className="text-center text-gray-500 dark:text-gray-400 mt-10 py-10 bg-white dark:bg-gray-800 rounded-lg shadow-md">No showcase videos yet.</p>
                    ) : filteredShowcases.length === 0 ? (
                        <p className="text-center text-gray-500 dark:text-gray-400 mt-10 py-10 bg-white dark:bg-gray-800 rounded-lg shadow-md">No showcases match your filters.</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredShowcases.map(showcase => (
                                <div key={showcase.url} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
                                    <VideoThumb url={showcase.url}>
                                        {showcase.name && (
                                            <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 to-transparent px-3 pt-2 pb-6 pointer-events-none">
                                                <p className="text-white font-bold text-lg text-center truncate" title={showcase.name}>{showcase.name}</p>
                                            </div>
                                        )}
                                        <span className="absolute bottom-2 left-2 text-xs font-bold text-white bg-black/60 px-2 py-0.5 rounded-full">
                                            Showcase · {showcase.creations.length} creation{showcase.creations.length !== 1 ? 's' : ''}
                                        </span>
                                    </VideoThumb>
                                    <div className="p-2 grid grid-cols-3 gap-1.5">
                                        {showcase.visibleCreations.map(creation => (
                                            <CreationPreviewTile key={creation.id} creation={creation} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {activeSubTab === 'Events' && (
                <>
                    {eventVideos.length > 0 && (
                        <div className="flex justify-center items-center mb-6 gap-2">
                            <div className="relative flex-grow max-w-xl">
                                <input
                                    type="text"
                                    placeholder="Search event videos..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full p-3 pl-4 pr-10 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-full focus:outline-none focus:ring-2"
                                    style={{ '--tw-ring-color': 'var(--theme-color)' }}
                                />
                                {searchTerm && (
                                    <button onClick={() => setSearchTerm('')} className="absolute z-10 right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-300/50" aria-label="Clear search">
                                        <span className="text-2xl font-bold community-text pb-1">×</span>
                                    </button>
                                )}
                            </div>
                            <select
                                value={eventFilter}
                                onChange={(e) => setEventFilter(e.target.value)}
                                className="p-3 bg-gray-200 dark:bg-gray-700 rounded-full text-sm font-medium text-gray-700 dark:text-gray-200 focus:outline-none"
                            >
                                <option value="all">All Events</option>
                                {eventsWithVideos.map(event => (
                                    <option key={event.id} value={event.id}>{event.title}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {eventVideos.length > 0 && filteredEventVideos.length === 0 && (
                        <p className="text-center text-gray-500 dark:text-gray-400 mt-10 py-10 bg-white dark:bg-gray-800 rounded-lg shadow-md">No event videos match your search.</p>
                    )}
                    {eventVideos.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {filteredEventVideos.map(({ url, event }, index) => (
                                <div key={`${event.id}_${index}`} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
                                    <VideoThumb url={url} />
                                    <Link to={`/event/${event.id}`} className="block p-3 hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <p className="font-bold truncate" title={event.title}>{event.title}</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Event video</p>
                                    </Link>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-gray-500 dark:text-gray-400 mt-10 py-10 bg-white dark:bg-gray-800 rounded-lg shadow-md">No event videos yet.</p>
                    )}
                </>
            )}
        </div>
    );
};

export default CommunityVideosTab;
