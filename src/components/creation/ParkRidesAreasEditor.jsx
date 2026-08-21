import React, { useMemo, useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import {
    AREA_COLOR_PRESETS,
    getPresentedParkRideEntries,
    makePresentationId,
    normalizeAreaColor,
    PARK_AREA_LIMIT,
    PARK_CUSTOM_RIDE_LIMIT,
    RIDE_CATEGORY_OPTIONS,
    sanitizeParkRidePresentation,
} from '../../utils/parkRidePresentation';

const CATEGORY_PILL_STYLES = {
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

const VENUE_CATEGORY_KEYS = new Set(['restaurant', 'shop', 'show']);
const ATTRACTION_GROUP_OPTIONS = [
    { key: 'all', label: 'All' },
    { key: 'rides', label: 'Rides' },
    { key: 'venues', label: 'Venues' },
];
const RIDE_FILTER_OPTIONS = RIDE_CATEGORY_OPTIONS
    .filter(option => !VENUE_CATEGORY_KEYS.has(option.key))
    .map(option => option.key === 'tracked-ride' ? { ...option, label: 'Other' } : option);
const VENUE_FILTER_OPTIONS = RIDE_CATEGORY_OPTIONS.filter(option => VENUE_CATEGORY_KEYS.has(option.key));
const CATEGORY_INDICATOR_COLORS = {
    all: '#F97316',
    coaster: '#F97316',
    'water-ride': '#2563EB',
    'water-slide': '#0EA5E9',
    'dark-ride': '#7C3AED',
    'transport-ride': '#059669',
    'flat-ride': '#C026D3',
    'tracked-ride': '#0891B2',
    restaurant: '#E11D48',
    shop: '#D97706',
    show: '#DB2777',
};

const SegmentedPillSelector = ({ options, value, onChange, activeColor, ariaLabel, testId }) => {
    const selectedIndex = Math.max(0, options.findIndex(option => option.key === value));
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="relative grid w-full items-stretch rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-800"
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            <div
                data-testid={`${testId}-indicator`}
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-full shadow transition-[transform,background-color] duration-300 ease-out"
                style={{
                    width: `calc((100% - 0.5rem) / ${options.length})`,
                    transform: `translateX(${selectedIndex * 100}%)`,
                    backgroundColor: activeColor,
                }}
            />
            {options.map(option => (
                <button
                    key={option.key}
                    type="button"
                    title={option.label}
                    aria-pressed={value === option.key}
                    onClick={() => onChange(option.key)}
                    className={`relative z-10 min-w-0 truncate rounded-full px-1.5 py-2 text-center text-[11px] font-bold transition-colors duration-300 sm:px-2 sm:text-xs ${value === option.key ? 'text-white' : 'text-gray-600 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white'}`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
};

const AttractionCategoryTabs = ({ value, onChange, lastRideCategory, lastVenueCategory }) => {
    const group = value === 'all' ? 'all' : VENUE_CATEGORY_KEYS.has(value) ? 'venues' : 'rides';
    const activeColor = CATEGORY_INDICATOR_COLORS[value] || CATEGORY_INDICATOR_COLORS.all;
    const subOptions = group === 'rides' ? RIDE_FILTER_OPTIONS : VENUE_FILTER_OPTIONS;

    const selectGroup = nextGroup => {
        if (nextGroup === 'all') onChange('all');
        else if (nextGroup === 'rides') onChange(lastRideCategory);
        else onChange(lastVenueCategory);
    };

    return (
        <div className="space-y-2">
            <SegmentedPillSelector
                options={ATTRACTION_GROUP_OPTIONS}
                value={group}
                onChange={selectGroup}
                activeColor={activeColor}
                ariaLabel="Filter attraction groups"
                testId="attraction-group"
            />
            {group !== 'all' && (
                <SegmentedPillSelector
                    options={subOptions}
                    value={value}
                    onChange={onChange}
                    activeColor={activeColor}
                    ariaLabel={group === 'rides' ? 'Filter ride types' : 'Filter venue types'}
                    testId="attraction-subcategory"
                />
            )}
        </div>
    );
};

const ParkRidesAreasEditor = ({ park, value, onChange, color }) => {
    const presentation = useMemo(() => sanitizeParkRidePresentation(value), [value]);
    const rideEntries = useMemo(
        () => getPresentedParkRideEntries(park, presentation, { includeHidden: true }),
        [park, presentation],
    );
    const [activeRideCategory, setActiveRideCategory] = useState('all');
    const [lastRideCategory, setLastRideCategory] = useState('coaster');
    const [lastVenueCategory, setLastVenueCategory] = useState('restaurant');
    const visibleRideEntries = useMemo(() => activeRideCategory === 'all' ? rideEntries :
        rideEntries.filter(entry => entry.category.key === activeRideCategory), [activeRideCategory, rideEntries]);
    const [newAreaName, setNewAreaName] = useState('');
    const [newRideName, setNewRideName] = useState('');
    const [newRideCategory, setNewRideCategory] = useState('restaurant');

    const selectRideCategory = categoryKey => {
        setActiveRideCategory(categoryKey);
        if (categoryKey === 'all') return;
        if (VENUE_CATEGORY_KEYS.has(categoryKey)) setLastVenueCategory(categoryKey);
        else setLastRideCategory(categoryKey);
    };

    const commit = next => onChange(sanitizeParkRidePresentation(next));

    const addArea = () => {
        const name = newAreaName.trim();
        if (!name || presentation.areas.length >= PARK_AREA_LIMIT) return;
        commit({
            ...presentation,
            areas: [...presentation.areas, {
                id: makePresentationId('area'),
                name,
                color: AREA_COLOR_PRESETS[presentation.areas.length % AREA_COLOR_PRESETS.length],
            }],
        });
        setNewAreaName('');
    };

    const updateArea = (areaId, patch) => commit({
        ...presentation,
        areas: presentation.areas.map(area => area.id === areaId ? { ...area, ...patch } : area),
    });

    const removeArea = areaId => commit({
        ...presentation,
        areas: presentation.areas.filter(area => area.id !== areaId),
        rideAreaAssignments: Object.fromEntries(Object.entries(presentation.rideAreaAssignments)
            .filter(([, assignedAreaId]) => assignedAreaId !== areaId)),
    });

    const addCustomRide = () => {
        const name = newRideName.trim();
        if (!name || presentation.customRides.length >= PARK_CUSTOM_RIDE_LIMIT) return;
        commit({
            ...presentation,
            customRides: [...presentation.customRides, {
                id: makePresentationId('custom'),
                name,
                rideCategoryKey: newRideCategory,
            }],
        });
        setNewRideName('');
        selectRideCategory(newRideCategory);
    };

    const removeCustomRide = rideKey => commit({
        ...presentation,
        customRides: presentation.customRides.filter(ride => ride.id !== rideKey),
        hiddenRideKeys: presentation.hiddenRideKeys.filter(key => key !== rideKey),
        rideAreaAssignments: Object.fromEntries(Object.entries(presentation.rideAreaAssignments)
            .filter(([key]) => key !== rideKey)),
        rideEfnOverrides: Object.fromEntries(Object.entries(presentation.rideEfnOverrides)
            .filter(([key]) => key !== rideKey)),
        rideDisplayNames: Object.fromEntries(Object.entries(presentation.rideDisplayNames)
            .filter(([key]) => key !== rideKey)),
    });

    const updateCustomRide = (rideKey, patch) => {
        const rideEfnOverrides = { ...presentation.rideEfnOverrides };
        if (VENUE_CATEGORY_KEYS.has(patch.rideCategoryKey)) delete rideEfnOverrides[rideKey];
        commit({
            ...presentation,
            customRides: presentation.customRides.map(ride =>
                ride.id === rideKey ? { ...ride, ...patch } : ride),
            rideEfnOverrides,
        });
    };

    const toggleRideVisibility = rideKey => {
        const hidden = presentation.hiddenRideKeys.includes(rideKey);
        commit({
            ...presentation,
            hiddenRideKeys: hidden ?
                presentation.hiddenRideKeys.filter(key => key !== rideKey) :
                [...presentation.hiddenRideKeys, rideKey],
        });
    };

    const assignRide = (rideKey, areaId) => {
        const assignments = { ...presentation.rideAreaAssignments };
        if (areaId) assignments[rideKey] = areaId;
        else delete assignments[rideKey];
        commit({ ...presentation, rideAreaAssignments: assignments });
    };

    const updateRideEfn = (rideKey, metric, rawValue) => {
        const rideEfnOverrides = { ...presentation.rideEfnOverrides };
        const scores = { ...(rideEfnOverrides[rideKey] || {}) };
        if (rawValue === '') delete scores[metric];
        else {
            const value = Number(rawValue);
            if (!Number.isFinite(value) || value < 0 || value > 100) return;
            scores[metric] = value;
        }
        if (Object.keys(scores).length > 0) rideEfnOverrides[rideKey] = scores;
        else delete rideEfnOverrides[rideKey];
        commit({ ...presentation, rideEfnOverrides });
    };

    const updateRideDisplayName = (rideKey, originalDisplayName, rawDisplayName) => {
        const rideDisplayNames = { ...presentation.rideDisplayNames };
        const displayName = rawDisplayName.trim();
        if (!displayName || displayName === originalDisplayName) delete rideDisplayNames[rideKey];
        else rideDisplayNames[rideKey] = displayName;
        commit({ ...presentation, rideDisplayNames });
    };

    return (
        <div className="space-y-7">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                Savefile rides keep their original names and extracted stats. Your display names, visibility, custom attractions, areas and colors are presentation settings and never change the verified save metadata.
            </div>

            <section className="space-y-4">
                <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Areas</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Create park areas and choose the color used for their heading and outline.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                        aria-label="New area name"
                        value={newAreaName}
                        onChange={event => setNewAreaName(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addArea(); } }}
                        maxLength={60}
                        placeholder="e.g. Steampunk District"
                        className={`min-w-0 flex-1 rounded-xl border p-3 focus:ring-2 ${color.ring}`}
                    />
                    <button type="button" onClick={addArea} disabled={!newAreaName.trim() || presentation.areas.length >= PARK_AREA_LIMIT} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${color.bg} ${color.hoverBg}`}>
                        <Icon path={ICONS.plus} className="h-5 w-5" /> Add Area
                    </button>
                </div>
                {presentation.areas.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                        {presentation.areas.map(area => (
                            <article key={area.id} className="rounded-2xl border-2 bg-white p-3 dark:bg-gray-900" style={{ borderColor: area.color }}>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        aria-label={`${area.name} theme color`}
                                        value={area.color}
                                        onChange={event => updateArea(area.id, { color: normalizeAreaColor(event.target.value) })}
                                        className="h-10 w-10 flex-none cursor-pointer rounded-lg border-0 bg-transparent p-0"
                                    />
                                    <input
                                        aria-label={`${area.name} name`}
                                        defaultValue={area.name}
                                        maxLength={60}
                                        onBlur={event => {
                                            const name = event.target.value.trim();
                                            if (!name) event.target.value = area.name;
                                            else if (name !== area.name) updateArea(area.id, { name });
                                        }}
                                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                                        className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-semibold"
                                        style={{ color: area.color }}
                                    />
                                    <button type="button" aria-label={`Delete ${area.name} area`} onClick={() => removeArea(area.id)} className="grid h-10 w-10 flex-none place-items-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                                        <Icon path={ICONS.trash} className="h-5 w-5" />
                                    </button>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {AREA_COLOR_PRESETS.map(preset => (
                                        <button key={preset} type="button" aria-label={`Use ${preset} for ${area.name}`} onClick={() => updateArea(area.id, { color: preset })} className={`h-5 w-5 rounded-full border-2 ${area.color === preset ? 'border-gray-900 dark:border-white' : 'border-transparent'}`} style={{ backgroundColor: preset }} />
                                    ))}
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700">
                <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Attractions</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Rename or hide savefile rides, assign them to an area or add an attraction that is not stored in the savefile metadata.</p>
                </div>
                <div className="grid gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
                    <input
                        aria-label="Attraction name"
                        value={newRideName}
                        onChange={event => setNewRideName(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomRide(); } }}
                        maxLength={100}
                        placeholder="Attraction name"
                        className={`min-w-0 rounded-xl border p-3 focus:ring-2 ${color.ring}`}
                    />
                    <select aria-label="Attraction category" value={newRideCategory} onChange={event => setNewRideCategory(event.target.value)} className="rounded-xl border p-3">
                        {RIDE_CATEGORY_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.singular}</option>)}
                    </select>
                    <button type="button" onClick={addCustomRide} disabled={!newRideName.trim() || presentation.customRides.length >= PARK_CUSTOM_RIDE_LIMIT} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${color.bg} ${color.hoverBg}`}>
                        <Icon path={ICONS.plus} className="h-5 w-5" /> Add Attraction
                    </button>
                </div>

                <AttractionCategoryTabs
                    value={activeRideCategory}
                    onChange={selectRideCategory}
                    lastRideCategory={lastRideCategory}
                    lastVenueCategory={lastVenueCategory}
                />

                {visibleRideEntries.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">No attractions are available in this category.</div>
                ) : (
                    <div className="space-y-2">
                        {visibleRideEntries.map(entry => {
                            const hasGameRatings = ['excitement', 'fear', 'nausea']
                                .some(metric => Number.isFinite(entry.ride?.ratings?.[metric]));
                            const isVenue = VENUE_CATEGORY_KEYS.has(entry.category.key);
                            return (
                            <article key={entry.key} className={`grid items-center gap-3 rounded-xl border p-3 transition-opacity sm:grid-cols-[auto_minmax(0,1fr)_10rem] ${entry.hidden ? 'bg-gray-50 opacity-55 dark:bg-gray-900' : 'bg-white dark:bg-gray-900'}`}>
                                <button type="button" aria-label={`${entry.hidden ? 'Show' : 'Hide'} ${entry.displayName}`} onClick={() => toggleRideVisibility(entry.key)} className="grid h-10 w-10 place-items-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
                                    <Icon path={entry.hidden ? ICONS.eyeSlash : ICONS.eye} className="h-5 w-5" />
                                </button>
                                <div className="min-w-0">
                                    <input
                                        aria-label={`Display name for ${entry.originalDisplayName}`}
                                        defaultValue={entry.displayName}
                                        maxLength={100}
                                        onBlur={event => {
                                            const displayName = event.target.value.trim();
                                            if (!displayName) event.target.value = entry.originalDisplayName;
                                            updateRideDisplayName(entry.key, entry.originalDisplayName, displayName);
                                        }}
                                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                                        className="w-full min-w-0 rounded-lg border px-3 py-2 font-bold text-gray-900 dark:text-white"
                                    />
                                    {entry.source === 'save' && entry.displayName !== entry.originalDisplayName && <p className="mt-1 text-[10px] text-gray-500">Savefile name: {entry.originalDisplayName}</p>}
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORY_PILL_STYLES[entry.category.key] || CATEGORY_PILL_STYLES['tracked-ride']}`}>{entry.category.label}</span>
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-300">{entry.source === 'custom' ? 'Custom attraction' : 'Savefile'}</span>
                                    </div>
                                    {entry.source === 'custom' && (
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <select
                                                aria-label={`Attraction category for ${entry.displayName}`}
                                                value={entry.category.key}
                                                onChange={event => {
                                                    updateCustomRide(entry.key, { rideCategoryKey: event.target.value });
                                                    if (activeRideCategory !== 'all') selectRideCategory(event.target.value);
                                                }}
                                                className="rounded-lg border px-2 py-1 text-xs"
                                            >
                                                {RIDE_CATEGORY_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.singular}</option>)}
                                            </select>
                                            <button type="button" onClick={() => removeCustomRide(entry.key)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700"><Icon path={ICONS.trash} className="h-3.5 w-3.5" /> Remove attraction</button>
                                        </div>
                                    )}
                                </div>
                                <select aria-label={`Area for ${entry.displayName}`} value={entry.areaId || ''} onChange={event => assignRide(entry.key, event.target.value)} className="min-w-0 rounded-lg border px-2 py-2 text-sm">
                                    <option value="">Unassigned</option>
                                    {presentation.areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                                </select>
                                {!isVenue && (
                                    <div className="sm:col-span-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950/50">
                                        {hasGameRatings ? (
                                            <p className="text-center text-xs font-semibold text-green-700 dark:text-green-300">Final EFN ratings are stored by the game and cannot be overridden.</p>
                                        ) : (
                                            <>
                                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                                    <p className="text-xs font-bold text-gray-700 dark:text-gray-200">User-entered EFN</p>
                                                    {entry.ride?.testStats?.testCurves?.average && <p className="text-[10px] text-gray-500">Calculated trace values are retained but hidden.</p>}
                                                </div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {['excitement', 'fear', 'nausea'].map(metric => (
                                                        <label key={metric} className="text-center text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                                            {metric}
                                                            <input
                                                                type="number"
                                                                aria-label={`${metric} EFN for ${entry.displayName}`}
                                                                min="0"
                                                                max="100"
                                                                step="0.01"
                                                                value={entry.userEfn?.[metric] ?? ''}
                                                                onChange={event => updateRideEfn(entry.key, metric, event.target.value)}
                                                                placeholder="—"
                                                                className="mt-1 w-full rounded-lg border px-2 py-1.5 text-center text-sm font-bold text-gray-900 dark:text-white"
                                                            />
                                                        </label>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </article>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

export default ParkRidesAreasEditor;
