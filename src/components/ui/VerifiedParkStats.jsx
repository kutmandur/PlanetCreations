import { PARK_INFO_FIELDS, getParkInfo, PARK_TEXT_FIELDS, getParkText, RIDE_INFO_FIELDS, getRideInfo } from '../../utils/parkInfo';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPlanetCoaster2ScoreTone } from '../../utils/verifiedParkStats';
export { getPlanetCoaster2ScoreTone } from '../../utils/verifiedParkStats';
import {
    colorWithAlpha,
    groupPresentedParkRides,
    groupPresentedParkRidesByArea,
    sanitizeParkRidePresentation,
} from '../../utils/parkRidePresentation';
import AnimatedPillTabs from './AnimatedPillTabs';

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
    green: 'border-green-300 bg-green-100 text-green-950 dark:border-green-500 dark:bg-green-800/80 dark:text-green-50',
    yellow: 'border-yellow-300 bg-yellow-100 text-yellow-950 dark:border-yellow-500 dark:bg-yellow-800/80 dark:text-yellow-50',
    red: 'border-red-300 bg-red-100 text-red-950 dark:border-red-500 dark:bg-red-800/80 dark:text-red-50',
};

function formatNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return 'N/A';
    return digits === 0 ? numberFormatter.format(value) : decimalFormatter.format(value);
}

const AutoFitStatNumber = ({ value, testId, className = '', formatter = numberFormatter }) => {
    const wrapperRef = useRef(null);
    const textRef = useRef(null);
    const formattedValue = Number.isFinite(value) ? formatter.format(value) : 'N/A';

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

const BlueprintStatCard = ({ label, value, formatter = decimalFormatter, metric, neutral = false }) => {
    const tone = metric ? getPlanetCoaster2ScoreTone(metric, value) : null;
    const toneClasses = neutral ?
        'border border-gray-200 bg-white text-gray-950 dark:border-gray-700 dark:bg-gray-900 dark:text-white' :
        (SCORE_TONE_STYLES[tone] || 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100');
    return (
        <article
            data-testid={metric ? `blueprint-score-${metric}` : undefined}
            data-tone={tone || undefined}
            className={`flex min-h-14 items-center justify-between gap-3 rounded-xl px-3 py-2 shadow-sm ${toneClasses}`}
        >
            <p className={`min-w-0 flex-1 text-[10px] font-bold uppercase leading-tight tracking-wide ${neutral ? 'text-gray-500' : ''}`}>{label}</p>
            <AutoFitStatNumber value={value} formatter={formatter} />
        </article>
    );
};

const TinyMetric = ({ label, value, accent = '' }) => (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-center dark:border-gray-700 dark:bg-gray-950">
        <p className="truncate text-[9px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`truncate text-xs font-semibold text-gray-900 dark:text-gray-100 ${accent}`}>{value}</p>
    </div>
);

const TestScoreMetric = ({ metric, label, value, source }) => {
    if (!Number.isFinite(value)) return null;
    const tone = getPlanetCoaster2ScoreTone(metric, value);
    return (
        <div
            data-testid={`test-score-${metric}`}
            data-tone={tone || 'neutral'}
            title={source === 'user' ? `${label} entered by the creator` :
                (source === 'calculated' ? `${label} calculated from the stored ride-test curve` : `${label} rating stored by the game`)}
            className={`min-w-0 rounded-lg border px-2 py-1.5 text-center ${SCORE_TONE_STYLES[tone] || 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'}`}
        >
            <p className="truncate text-[9px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
            <p className="truncate text-sm font-black">{formatNumber(value, 2)}</p>
        </div>
    );
};

const RideStats = ({ride, userEfn, manualStats}) => {
    const stats = getRideInfo(ride, manualStats);
    const scores = {...ride?.ratings, ...userEfn};
    return <div className="mt-3 space-y-2">
        <div className="grid grid-cols-3 gap-1.5">
            {['excitement', 'fear', 'nausea'].filter(key => Number.isFinite(scores[key])).map(metric =>
                <TestScoreMetric key={metric} metric={metric} label={metric[0].toUpperCase() + metric.slice(1)} value={scores[metric]} source="user" />)}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
            {RIDE_INFO_FIELDS.filter(({key}) => Number.isFinite(stats[key])).map(({key, label}) =>
                <TinyMetric key={key} label={label} value={formatNumber(stats[key], 2)} />)}
        </div>
    </div>;
};

const RideCard = ({
    entry,
    showType = false,
    checked = false,
    onToggleChecked = null,
}) => {
    const { ride, index, category } = entry;
    const categoryKey = category?.key || 'tracked-ride';
    return (
        <article
            data-testid={`ride-card-${categoryKey}-${index}`}
            data-checked={onToggleChecked ? String(checked) : undefined}
            className={`min-w-0 rounded-2xl border p-3 text-center shadow-sm transition-all ${checked ? 'ring-2 ring-green-500 ring-offset-2 dark:ring-offset-gray-900' : ''} ${CATEGORY_CARD_STYLES[categoryKey] || CATEGORY_CARD_STYLES['tracked-ride']}`}
        >
            {onToggleChecked && (
                <label className="mb-2 ml-auto flex w-fit cursor-pointer items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-gray-700 shadow-sm dark:bg-gray-950/75 dark:text-gray-200">
                    <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleChecked(entry.key)}
                        className="h-3.5 w-3.5 accent-green-600"
                        aria-label={`Mark ${entry.displayName} as checked`}
                    />
                    Checked
                </label>
            )}
            <div className="min-w-0 text-center">
                <h4 className={`break-words text-sm font-bold leading-tight text-gray-950 dark:text-white ${checked ? 'line-through opacity-60' : ''}`} title={entry.displayName}>{entry.displayName}</h4>
                {ride.name && ride.category && ride.category !== ride.name && <p className="mt-0.5 break-words text-xs text-gray-500">{ride.category}</p>}
                {showType && (
                    <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${CATEGORY_STYLES[categoryKey] || CATEGORY_STYLES['tracked-ride']}`}>
                        {category?.label || 'Other Tracked Rides'}
                    </span>
                )}
            </div>
            <RideStats ride={ride} userEfn={entry.userEfn} manualStats={entry.manualStats} />

        </article>
    );
};

const TypeSections = ({ groups, checkedRideKeys = new Set(), onToggleChecked = null }) => (
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
                    {group.rides.map(entry => (
                        <RideCard
                            key={entry.key}
                            entry={entry}
                            checked={checkedRideKeys.has(entry.key)}
                            onToggleChecked={onToggleChecked}
                        />
                    ))}
                </div>
            </section>
        ))}
    </div>
);

const AreaSections = ({ groups, checkedRideKeys = new Set(), onToggleChecked = null }) => (
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
                        {area.rides.map(entry => (
                            <RideCard
                                key={entry.key}
                                entry={entry}
                                showType
                                checked={checkedRideKeys.has(entry.key)}
                                onToggleChecked={onToggleChecked}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="py-4 text-center text-sm text-gray-500">No visible attractions assigned to this area.</p>
                )}
            </section>
        ))}
    </div>
);

export { AreaSections, TypeSections };

const RideListPopover = ({groups, areaGroups, hasAreas, onClose}) => {
    const [grouping, setGrouping] = useState(hasAreas ? 'areas' : 'types');
    useEffect(() => {
        const handleKeyDown = event => { if (event.key === 'Escape') onClose(); };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);
        return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKeyDown); };
    }, [onClose]);
    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-label="Ride List" className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-gray-100 dark:bg-gray-950">
                <header className="flex items-center justify-between p-5">
                    <div><h2 className="text-2xl font-bold">Ride List</h2><p className="text-xs text-gray-500">Information provided by the creator.</p></div>
                    <button type="button" aria-label="Close Ride List" onClick={onClose} className="h-10 w-10 rounded-full bg-gray-200 text-xl dark:bg-gray-800">×</button>
                </header>
                <div className="overflow-y-auto p-5">
                    {hasAreas && <div className="mb-6"><AnimatedPillTabs activeTab={grouping} onChange={setGrouping} tabs={[{id: 'areas', label: 'Areas'}, {id: 'types', label: 'Types'}]} /></div>}
                    {grouping === 'areas' && hasAreas ? <AreaSections groups={areaGroups} /> : <TypeSections groups={groups} />}
                </div>
            </div>
        </div>, document.body);
};

const VerifiedParkStats = ({ metadata, presentation }) => {
    const [rideListOpen, setRideListOpen] = useState(false);
    const normalizedPresentation = useMemo(() => sanitizeParkRidePresentation(presentation), [presentation]);
    const park = metadata?.park || metadata?.blueprint || { rides: [] };
    const parkInfo = getParkInfo(metadata, normalizedPresentation);
    const parkText = getParkText(metadata, normalizedPresentation);
    const groups = useMemo(() => groupPresentedParkRides(park, normalizedPresentation), [park, normalizedPresentation]);
    const areaGroups = useMemo(() => groupPresentedParkRidesByArea(park, normalizedPresentation), [park, normalizedPresentation]);
    if (!groups.length && !Object.values(parkText).some(value => value.trim()) && !PARK_INFO_FIELDS.some(({key}) => Number.isFinite(parkInfo[key]))) return null;
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
            {PARK_TEXT_FIELDS.filter(({key}) => parkText[key].trim()).map(({key, label}) => <TinyMetric key={key} label={label} value={parkText[key]} />)}
            {PARK_INFO_FIELDS.filter(({key}) => Number.isFinite(parkInfo[key])).map(({key, label}) =>
                <BlueprintStatCard key={key} label={label} value={parkInfo[key]} metric={['excitement', 'fear', 'nausea'].includes(key) ? key : undefined} neutral />)}
            {groups.length > 0 && <button type="button" onClick={() => setRideListOpen(true)} className="min-h-14 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Ride List</button>}
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
