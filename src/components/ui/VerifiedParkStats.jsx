import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCombinedParkPieceCount } from '../../utils/verifiedParkStats';
import {
    colorWithAlpha,
    groupPresentedParkRides,
    groupPresentedParkRidesByArea,
    sanitizeParkRidePresentation,
} from '../../utils/parkRidePresentation';

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const CATEGORY_STYLES = {
    coaster: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
    'water-ride': 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    'water-slide': 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
    'dark-ride': 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
    'transport-ride': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    'flat-ride': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200',
    'tracked-ride': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
    restaurant: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
    shop: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    show: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
};

const CATEGORY_CARD_STYLES = {
    coaster: 'border-orange-300 bg-orange-50/70 dark:border-orange-800 dark:bg-orange-950/30',
    'water-ride': 'border-blue-300 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/30',
    'water-slide': 'border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30',
    'dark-ride': 'border-violet-300 bg-violet-50/70 dark:border-violet-800 dark:bg-violet-950/30',
    'transport-ride': 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30',
    'flat-ride': 'border-fuchsia-300 bg-fuchsia-50/70 dark:border-fuchsia-800 dark:bg-fuchsia-950/30',
    'tracked-ride': 'border-cyan-300 bg-cyan-50/70 dark:border-cyan-800 dark:bg-cyan-950/30',
    restaurant: 'border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/30',
    shop: 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30',
    show: 'border-pink-300 bg-pink-50/70 dark:border-pink-800 dark:bg-pink-950/30',
};

const SCORE_TONE_STYLES = {
    green: 'border-green-300 bg-green-100 text-green-950 dark:border-green-700 dark:bg-green-950 dark:text-green-100',
    yellow: 'border-yellow-300 bg-yellow-100 text-yellow-950 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-100',
    red: 'border-red-300 bg-red-100 text-red-950 dark:border-red-700 dark:bg-red-950 dark:text-red-100',
};

export function getPlanetCoaster2ScoreTone(metric, value) {
    if (!Number.isFinite(value)) return null;
    if (metric === 'excitement') return value >= 5 ? 'green' : value >= 3 ? 'yellow' : 'red';
    if (metric === 'fear') return value <= 5 ? 'green' : value <= 7 ? 'yellow' : 'red';
    if (metric === 'nausea') return value <= 3 ? 'green' : value <= 5 ? 'yellow' : 'red';
    return null;
}

function formatNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return 'N/A';
    return digits === 0 ? numberFormatter.format(value) : decimalFormatter.format(value);
}

const AutoFitStatNumber = ({ value, testId, className = '' }) => {
    const wrapperRef = useRef(null);
    const textRef = useRef(null);
    const formattedValue = formatNumber(value);

    useLayoutEffect(() => {
        const wrapper = wrapperRef.current;
        const text = textRef.current;
        if (!wrapper || !text) return undefined;

        const fit = () => {
            const availableWidth = wrapper.clientWidth;
            if (availableWidth <= 0) return;
            const maximumSize = 20;
            const minimumSize = 8;
            text.style.fontSize = `${maximumSize}px`;
            const naturalWidth = text.scrollWidth;
            const fittedSize = naturalWidth > availableWidth ?
                maximumSize * (availableWidth / naturalWidth) : maximumSize;
            text.style.fontSize = `${Math.max(minimumSize, Math.min(maximumSize, fittedSize))}px`;
        };

        const frame = window.requestAnimationFrame(fit);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
        observer?.observe(wrapper);
        return () => {
            window.cancelAnimationFrame(frame);
            observer?.disconnect();
        };
    }, [formattedValue]);

    return (
        <div ref={wrapperRef} data-auto-fit-number="true" className="w-[48%] min-w-0 flex-none overflow-hidden text-right">
            <span
                ref={textRef}
                data-testid={testId}
                title={formattedValue}
                className={`inline-block max-w-full whitespace-nowrap text-xl font-black leading-none ${className}`}
            >
                {formattedValue}
            </span>
        </div>
    );
};

const TinyMetric = ({ label, value, accent = '' }) => (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-center dark:border-gray-700 dark:bg-gray-950">
        <p className="truncate text-[9px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`truncate text-xs font-semibold text-gray-900 dark:text-gray-100 ${accent}`}>{value}</p>
    </div>
);

const TestScoreMetric = ({ metric, label, value, source }) => {
    const tone = getPlanetCoaster2ScoreTone(metric, value);
    return (
        <div
            data-testid={`test-score-${metric}`}
            data-tone={tone || 'neutral'}
            title={source === 'user' ? `${label} entered by the creator` : `${label} rating stored by the game`}
            className={`min-w-0 rounded-lg border px-2 py-1.5 text-center ${SCORE_TONE_STYLES[tone] || 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'}`}
        >
            <p className="truncate text-[9px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
            <p className="truncate text-sm font-black">{formatNumber(value, 2)}</p>
        </div>
    );
};

const RideStats = ({ ride, userEfn }) => {
    const stats = ride?.testStats;
    const ratings = ride?.ratings;
    const hasGameRatings = ['excitement', 'fear', 'nausea']
        .some(metric => Number.isFinite(ratings?.[metric]));
    const scores = hasGameRatings ? ratings : userEfn;
    const scoreSource = hasGameRatings ? 'game' : 'user';
    if (!stats && !scores) {
        return <p className="mt-3 text-xs text-gray-500">{ride?.isCustom ? 'Custom attraction — no savefile stats.' : 'No stored per-ride test stats.'}</p>;
    }
    return (
        <div className="mt-3 space-y-2">
            {scores && (
                <div className="grid grid-cols-3 gap-1.5">
                    <TestScoreMetric metric="excitement" label="Excitement" value={scores.excitement} source={scoreSource} />
                    <TestScoreMetric metric="fear" label="Fear" value={scores.fear} source={scoreSource} />
                    <TestScoreMetric metric="nausea" label="Nausea" value={scores.nausea} source={scoreSource} />
                </div>
            )}
            {stats && <>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <TinyMetric label="Test duration" value={`${formatNumber(stats.durationSeconds, 2)} s`} />
                    <TinyMetric label="Traversal" value={`${formatNumber(stats.traversalLengthMeters, 2)} m`} />
                    <TinyMetric label="Max speed" value={`${formatNumber(stats.maxSpeedKph, 2)} km/h`} />
                    <TinyMetric label="Samples" value={formatNumber(stats.sampleCount)} />
                </div>
                {stats.gForces && (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                        <TinyMetric label="Lateral G min / max" value={`${formatNumber(stats.gForces.lateral?.min, 2)} / ${formatNumber(stats.gForces.lateral?.max, 2)}`} />
                        <TinyMetric label="Vertical G min / max" value={`${formatNumber(stats.gForces.vertical?.min, 2)} / ${formatNumber(stats.gForces.vertical?.max, 2)}`} />
                        <TinyMetric label="Longitudinal G min / max" value={`${formatNumber(stats.gForces.longitudinal?.min, 2)} / ${formatNumber(stats.gForces.longitudinal?.max, 2)}`} />
                    </div>
                )}
            </>}
        </div>
    );
};

const AnimatedPillTabs = ({ activeTab, onChange, tabs }) => {
    const buttonRefs = useRef([]);
    const containerRef = useRef(null);
    const [gliderStyle, setGliderStyle] = useState({ opacity: 0 });

    useEffect(() => {
        const updateGlider = () => {
            const activeIndex = tabs.findIndex(tab => tab.id === activeTab);
            const activeButton = buttonRefs.current[activeIndex];
            if (!activeButton) return;
            setGliderStyle({
                opacity: 1,
                transform: `translateX(${activeButton.offsetLeft}px)`,
                width: `${activeButton.offsetWidth}px`,
            });
        };
        updateGlider();
        const observer = typeof ResizeObserver === 'function' && containerRef.current ?
            new ResizeObserver(updateGlider) : null;
        if (observer && containerRef.current) observer.observe(containerRef.current);
        window.addEventListener('resize', updateGlider);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updateGlider);
        };
    }, [activeTab, tabs]);

    return (
        <div ref={containerRef} className="relative mx-auto flex w-full max-w-xs items-center rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-800">
            <div className="absolute bottom-1 top-1 left-0 rounded-full bg-blue-600 shadow transition-all duration-300 ease-out" style={gliderStyle} />
            {tabs.map((tab, index) => (
                <button
                    key={tab.id}
                    ref={element => { buttonRefs.current[index] = element; }}
                    type="button"
                    onClick={() => onChange(tab.id)}
                    className={`relative z-10 flex-1 rounded-full px-4 py-2 text-sm font-bold transition-colors duration-300 ${activeTab === tab.id ? 'text-white' : 'text-gray-600 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white'}`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
};

const RideCard = ({ entry, showType = false }) => {
    const { ride, index, category } = entry;
    const categoryKey = category?.key || 'tracked-ride';
    return (
        <article
            data-testid={`ride-card-${categoryKey}-${index}`}
            className={`rounded-2xl border p-3 text-center shadow-sm ${CATEGORY_CARD_STYLES[categoryKey] || CATEGORY_CARD_STYLES['tracked-ride']}`}
        >
            <div className="min-w-0 text-center">
                <h4 className="break-words text-sm font-bold leading-tight text-gray-950 dark:text-white" title={entry.displayName}>{entry.displayName}</h4>
                {ride.name && ride.category && ride.category !== ride.name && <p className="mt-0.5 break-words text-xs text-gray-500">{ride.category}</p>}
                {showType && (
                    <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${CATEGORY_STYLES[categoryKey] || CATEGORY_STYLES['tracked-ride']}`}>
                        {category?.label || 'Other Tracked Rides'}
                    </span>
                )}
            </div>
            {!ride.isCountPlaceholder && <RideStats ride={ride} userEfn={entry.userEfn} />}
            {ride.isCountPlaceholder && <p className="mt-3 text-center text-xs text-gray-500">Ride counted, but no individual record was available.</p>}
        </article>
    );
};

const TypeSections = ({ groups }) => (
    <div className="space-y-7">
        {groups.map(group => (
            <section key={group.key}>
                <div className="mb-4 flex justify-center">
                    <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 shadow-sm ${CATEGORY_STYLES[group.key] || CATEGORY_STYLES['tracked-ride']}`}>
                        <h3 data-testid={`ride-category-heading-${group.key}`} className="text-center text-sm font-black uppercase tracking-wide">{group.label}</h3>
                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-black tabular-nums text-current dark:bg-black/20">{group.rides.length}</span>
                    </div>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {group.rides.map(entry => <RideCard key={entry.key} entry={entry} />)}
                </div>
            </section>
        ))}
    </div>
);

const AreaSections = ({ groups }) => (
    <div className="space-y-5">
        {groups.map(area => (
            <section
                key={area.id}
                data-testid={`ride-area-${area.id}`}
                className="rounded-3xl border-2 p-4 sm:p-5"
                style={{ borderColor: area.color, backgroundColor: colorWithAlpha(area.color, '0D') }}
            >
                <div className="mb-4 text-center" style={{ color: area.color }}>
                    <h3 className="text-lg font-black uppercase tracking-wide">{area.name}</h3>
                    <p className="text-xs font-bold opacity-75">{area.rides.length} {area.rides.length === 1 ? 'attraction' : 'attractions'}</p>
                </div>
                {area.rides.length > 0 ? (
                    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                        {area.rides.map(entry => <RideCard key={entry.key} entry={entry} showType />)}
                    </div>
                ) : (
                    <p className="py-4 text-center text-sm text-gray-500">No visible attractions assigned to this area.</p>
                )}
            </section>
        ))}
    </div>
);

const RideListPopover = ({ groups, areaGroups, hasAreas, onClose }) => {
    const [grouping, setGrouping] = useState(hasAreas ? 'areas' : 'types');
    useEffect(() => {
        const handleKeyDown = event => { if (event.key === 'Escape') onClose(); };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-3" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-label="Ride List" className="flex max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-300 bg-gray-100 shadow-2xl dark:border-gray-700 dark:bg-gray-950 sm:max-h-[calc(100vh-1.5rem)]">
                <header className="flex flex-none items-start justify-between gap-4 border-b border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:px-7">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-300">Park metadata</p>
                        <h2 className="mt-1 text-2xl font-bold text-gray-950 dark:text-white">Ride List</h2>
                        <p className="mt-1 text-xs text-gray-500">EFN values are shown only when stored by the game or entered separately by the creator.</p>
                    </div>
                    <button type="button" aria-label="Close Ride List" onClick={onClose} className="grid h-10 w-10 flex-none place-items-center rounded-full bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700">
                        <span aria-hidden="true" className="relative block h-4 w-4">
                            <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-current" />
                            <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current" />
                        </span>
                    </button>
                </header>
                <div className="overflow-y-auto p-4 sm:p-6">
                    {hasAreas && (
                        <div className="mb-6">
                            <AnimatedPillTabs
                                activeTab={grouping}
                                onChange={setGrouping}
                                tabs={[{ id: 'areas', label: 'Areas' }, { id: 'types', label: 'Types' }]}
                            />
                        </div>
                    )}
                    {grouping === 'areas' && hasAreas ? <AreaSections groups={areaGroups} /> : <TypeSections groups={groups} />}
                </div>
            </div>
        </div>,
        document.body,
    );
};

const VerifiedParkStats = ({ metadata, presentation }) => {
    const [rideListOpen, setRideListOpen] = useState(false);
    const normalizedPresentation = useMemo(() => sanitizeParkRidePresentation(presentation), [presentation]);
    const park = metadata?.park || (normalizedPresentation.customRides.length > 0 ? { rides: [] } : null);
    const groups = useMemo(() => groupPresentedParkRides(park, normalizedPresentation), [park, normalizedPresentation]);
    const areaGroups = useMemo(() => groupPresentedParkRidesByArea(park, normalizedPresentation), [park, normalizedPresentation]);
    if (!park) return null;

    const pieceCount = getCombinedParkPieceCount(park);
    return <>
        <div
            className="mt-3 grid gap-2 text-left"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))' }}
            data-testid="verified-park-stats"
        >
            {groups.map(group => (
                <article
                    key={group.key}
                    data-testid={`ride-category-${group.key}`}
                    className={`flex min-h-14 items-center justify-between gap-3 rounded-xl px-3 py-2 shadow-sm ${CATEGORY_STYLES[group.key] || CATEGORY_STYLES['tracked-ride']}`}
                >
                    <p className="min-w-0 flex-1 text-[10px] font-bold uppercase leading-tight tracking-wide">{group.label}</p>
                    <AutoFitStatNumber value={group.rides.length} />
                </article>
            ))}
            <article className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900" title="Placement parts plus separately stored rail elements, tracked-ride elements and bins. Transform entities are excluded to avoid double counting.">
                <p className="min-w-0 flex-1 text-[10px] font-bold uppercase leading-tight tracking-wide text-gray-500">Scenery pieces</p>
                <AutoFitStatNumber value={pieceCount} testId="combined-piece-count" className="text-gray-950 dark:text-white" />
            </article>
            <button type="button" onClick={() => setRideListOpen(true)} disabled={groups.length === 0} className="min-h-14 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Ride List</button>
        </div>
        {rideListOpen && (
            <RideListPopover
                groups={groups}
                areaGroups={areaGroups}
                hasAreas={normalizedPresentation.areas.length > 0}
                onClose={() => setRideListOpen(false)}
            />
        )}
    </>;
};

export default VerifiedParkStats;
