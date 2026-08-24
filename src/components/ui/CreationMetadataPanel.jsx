import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';
import { getPlanetCoaster2ResearchPack } from '../../utils/planetCoaster2ResearchPacks';
import { getPlanetCoaster2ScoreTone } from '../../utils/verifiedParkStats';

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatGameMoney(value) {
    return Number.isFinite(value) ? moneyFormatter.format(value) : 'N/A';
}

function formatNumber(value, maximumFractionDigits = 0) {
    if (!Number.isFinite(value)) return 'N/A';
    if (maximumFractionDigits === 0) return numberFormatter.format(value);
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function humanize(value) {
    return String(value || '').replace(/^(Filter_|Menu_|Coaster_)/, '').replaceAll('_', ' ').trim();
}

function formatPercent(value) {
    return Number.isFinite(value) ? `${formatNumber(value * 100, 1)}%` : 'N/A';
}

function formatDlcIdentifier(value) {
    return String(value || '').replace(/^Content(\d+)$/i, 'Content $1');
}

function planetZooDlcIdentifierBit(value) {
    if (String(value).toLowerCase() === 'deluxe') return 0;
    const match = /^Content(\d+)$/i.exec(String(value));
    return match ? Number(match[1]) : null;
}

const Metric = ({ label, value, title, accent = '', compact = false }) => (
    <div className={`${compact ? 'min-w-28 rounded-lg px-2 py-1.5' : 'min-w-32 rounded-xl px-3 py-2.5'} inline-flex w-fit max-w-full flex-col items-center justify-center border border-gray-200 bg-white text-center shadow-sm dark:border-gray-800 dark:bg-gray-900/75 dark:shadow-none`} title={title}>
        <p className={`${compact ? 'text-[8px] tracking-wide' : 'text-[10px] tracking-wider'} max-w-52 break-words uppercase text-gray-500`}>{label}</p>
        <p className={`${compact ? 'text-xs' : 'mt-0.5 text-sm'} max-w-60 break-words font-semibold text-gray-900 dark:text-gray-100 ${accent}`}>{value}</p>
    </div>
);

const RIDE_CATEGORY_ORDER = ['coaster', 'water-ride', 'water-slide', 'dark-ride', 'transport-ride', 'flat-ride', 'tracked-ride'];
const RIDE_CATEGORY_STYLES = {
    coaster: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200',
    'water-ride': 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
    'water-slide': 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
    'dark-ride': 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
    'transport-ride': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
    'flat-ride': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/60 dark:text-fuchsia-200',
    'tracked-ride': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200',
};
const RIDE_CATEGORY_PLURALS = {
    Coaster: 'Coasters', 'Water Ride': 'Water Rides', 'Water Slide': 'Water Slides',
    'Dark Ride': 'Dark Rides', 'Transport Ride': 'Transport Rides',
    'Flat Ride': 'Flat Rides', 'Tracked Ride': 'Tracked Rides',
};
const TRACKED_RIDE_METRIC_LABELS = {
    coaster: 'Coasters',
    'water-ride': 'Water rides',
    'water-slide': 'Water slides',
    'dark-ride': 'Dark rides',
    'transport-ride': 'Transport rides',
    'tracked-ride': 'Other tracked rides',
};

const AUDIO_ICON = 'M9 18V5l12-2v13M9 9l12-2M6 21a3 3 0 100-6 3 3 0 000 6zm12-2a3 3 0 100-6 3 3 0 000 6z';
const FILE_ICON = 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5V5.25A2.25 2.25 0 0012.375 3h-6.75a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 005.625 21h11.25a2.625 2.625 0 002.625-2.625v-4.125z';

function customMediaKind(fileName) {
    const extension = String(fileName || '').split('.').pop().toLowerCase();
    if (['mp3', 'ogg'].includes(extension)) return 'audio';
    if (['mp4', 'webm', 'mov'].includes(extension)) return 'video';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
    return 'file';
}

const CustomMediaGrid = ({ references = [] }) => {
    if (references.length === 0) return null;
    const iconByKind = { audio: AUDIO_ICON, video: ICONS.video, image: ICONS.image, file: FILE_ICON };
    const styleByKind = {
        audio: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
        video: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
        image: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
        file: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    };
    return (
        <section>
            <div className="flex flex-col items-center gap-3 text-center">
                <div className="text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-300">Custom media</p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950 dark:text-white">Referenced files</h3>
                </div>
                <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{references.length}</span>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
                {references.map((fileName, index) => {
                    const kind = customMediaKind(fileName);
                    return (
                        <div key={`${fileName}-${index}`} title={fileName} className="flex w-fit max-w-xs items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-2 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900/70 dark:shadow-none">
                            <span className={`grid h-8 w-8 flex-none place-items-center rounded-lg ${styleByKind[kind]}`}>
                                <Icon path={iconByKind[kind]} className="h-4 w-4" />
                            </span>
                            <span className="break-all text-center text-xs text-gray-700 dark:text-gray-300">{fileName}</span>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

function normalizedRideCategory(ride) {
    if (ride?.rideCategory && ride?.rideCategoryKey) return { key: ride.rideCategoryKey, label: ride.rideCategory };
    return ride?.kind === 'flat' ? { key: 'flat-ride', label: 'Flat Ride' } : { key: 'tracked-ride', label: 'Tracked Ride' };
}

function groupedRides(rides) {
    const groups = rides.reduce((result, ride, index) => {
        const category = normalizedRideCategory(ride);
        const group = result.get(category.key) || { ...category, rides: [] };
        group.rides.push({ ride, index });
        result.set(category.key, group);
        return result;
    }, new Map());
    return [...groups.values()].sort((left, right) => {
        const leftIndex = RIDE_CATEGORY_ORDER.indexOf(left.key);
        const rightIndex = RIDE_CATEGORY_ORDER.indexOf(right.key);
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    });
}

function trackedRideCategoryMetrics(rides = [], totalTrackedRides) {
    const counts = new Map();
    for (const ride of rides) {
        if (ride?.kind !== 'tracked') continue;
        const { key } = normalizedRideCategory(ride);
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    const knownRideCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (Number.isFinite(totalTrackedRides) && totalTrackedRides > knownRideCount) {
        counts.set('tracked-ride', (counts.get('tracked-ride') || 0) + totalTrackedRides - knownRideCount);
    }

    return RIDE_CATEGORY_ORDER
        .filter(key => key !== 'flat-ride' && counts.has(key))
        .map(key => ({ key, label: TRACKED_RIDE_METRIC_LABELS[key], count: counts.get(key) }));
}

const RATING_TONE_TEXT_STYLES = {
    green: 'text-green-700 dark:text-green-300',
    yellow: 'text-yellow-700 dark:text-yellow-300',
    red: 'text-red-700 dark:text-red-300',
};

const RatingMetric = ({ metric, label, value, compact }) => {
    const tone = getPlanetCoaster2ScoreTone(metric, value);
    return (
        <Metric
            compact={compact}
            label={label}
            value={formatNumber(value, 2)}
            accent={RATING_TONE_TEXT_STYLES[tone] || ''}
        />
    );
};

const RatingMetrics = ({ ratings, prefix = '', compact = false }) => ratings && (
    <div className={`flex flex-wrap justify-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
        <RatingMetric compact={compact} metric="excitement" label={`${prefix}Excitement`} value={ratings.excitement} />
        <RatingMetric compact={compact} metric="fear" label={`${prefix}Fear`} value={ratings.fear} />
        <RatingMetric compact={compact} metric="nausea" label={`${prefix}Nausea`} value={ratings.nausea} />
    </div>
);

const BANNER_EFN_STYLES = {
    green: 'border-green-300 bg-green-100/90 text-green-950 dark:border-green-500 dark:bg-green-800/85 dark:text-green-50',
    yellow: 'border-yellow-300 bg-yellow-100/90 text-yellow-950 dark:border-yellow-500 dark:bg-yellow-800/85 dark:text-yellow-50',
    red: 'border-red-300 bg-red-100/90 text-red-950 dark:border-red-500 dark:bg-red-800/85 dark:text-red-50',
};

const BannerEfnPills = ({ ratings }) => {
    const entries = [
        { key: 'excitement', label: 'Excitement', value: ratings?.excitement },
        { key: 'fear', label: 'Fear', value: ratings?.fear },
        { key: 'nausea', label: 'Nausea', value: ratings?.nausea },
    ].filter(entry => Number.isFinite(entry.value))
        .map(entry => ({ ...entry, tone: getPlanetCoaster2ScoreTone(entry.key, entry.value) }));
    if (entries.length === 0) return null;

    return (
        <div className="mt-3 flex flex-wrap justify-center gap-2" aria-label="EFN ratings">
            {entries.map(entry => (
                <span
                    key={entry.key}
                    data-testid={`banner-efn-${entry.key}`}
                    data-tone={entry.tone}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold shadow-sm backdrop-blur-sm ${BANNER_EFN_STYLES[entry.tone]}`}
                >
                    <span>{entry.label}</span>
                    <span className="tabular-nums">{formatNumber(entry.value, 2)}</span>
                </span>
            ))}
        </div>
    );
};

const ResearchPackList = ({ researchPacks = [] }) => {
    const rewards = [...new Set(researchPacks.filter(Number.isSafeInteger))]
        .map(getPlanetCoaster2ResearchPack);
    if (rewards.length === 0) return null;
    return (
        <section className="mx-auto w-fit max-w-full rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900/60 dark:shadow-none">
            <h3 className="font-semibold text-gray-950 dark:text-white">Research packs</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">Unlock rewards required by objects in this blueprint. They do not represent the creator's research progress.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
                {rewards.map(reward => (
                    <span
                        key={reward.id}
                        title={`${reward.category} · Frontier reward ID ${reward.id}`}
                        className={`rounded-xl border px-3 py-2 ${reward.known ? 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/45 dark:text-blue-100' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/45 dark:text-amber-100'}`}
                    >
                        <span className="block text-sm font-semibold">{reward.label}</span>
                        <span className={`mt-0.5 block text-[10px] ${reward.known ? 'text-blue-700/75 dark:text-blue-300/75' : 'text-amber-700/75 dark:text-amber-300/75'}`}>{reward.category} · #{reward.id}</span>
                    </span>
                ))}
            </div>
        </section>
    );
};

const RideTestStats = ({ stats }) => {
    if (!stats) return <p className="mt-3 text-xs text-gray-500">No completed ride-test trace stored.</p>;
    return (
        <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
            <div className="flex flex-wrap justify-center gap-1.5">
                <Metric compact label="Test duration" value={`${formatNumber(stats.durationSeconds, 1)} s`} />
                <Metric compact label="Traversal" value={`${formatNumber(stats.traversalLengthMeters, 1)} m`} />
                <Metric compact label="Max speed" value={`${formatNumber(stats.maxSpeedKph, 1)} km/h`} />
                <Metric compact label="Test samples" value={formatNumber(stats.sampleCount)} />
                {stats.gForces && <>
                    <Metric compact label="Lateral G min / max" value={`${formatNumber(stats.gForces.lateral?.min, 2)} / ${formatNumber(stats.gForces.lateral?.max, 2)}`} />
                    <Metric compact label="Vertical G min / max" value={`${formatNumber(stats.gForces.vertical?.min, 2)} / ${formatNumber(stats.gForces.vertical?.max, 2)}`} />
                    <Metric compact label="Longitudinal G min / max" value={`${formatNumber(stats.gForces.longitudinal?.min, 2)} / ${formatNumber(stats.gForces.longitudinal?.max, 2)}`} />
                </>}
            </div>
        </div>
    );
};

const RideOverview = ({ rides = [], showTraceNote = true, eyebrow = 'Rides', title = 'Per-ride overview' }) => {
    const groups = useMemo(() => groupedRides(rides), [rides]);
    if (groups.length === 0) return null;
    return (
        <section className="space-y-4 text-center">
            <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-300">{eyebrow}</p>
                <h3 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">{title}</h3>
                {showTraceNote && <p className="mt-1 text-[11px] text-gray-500">Calculated EFN trace values are retained for future improvements, but intentionally hidden until the calculation is reliable.</p>}
            </div>
            {groups.map(group => (
                <div key={group.key} className="space-y-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs ${RIDE_CATEGORY_STYLES[group.key] || RIDE_CATEGORY_STYLES['tracked-ride']}`}>{RIDE_CATEGORY_PLURALS[group.label] || group.label}</span>
                        <span className="text-xs text-gray-500">{group.rides.length}</span>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2.5">
                        {group.rides.map(({ ride, index }) => (
                            <article key={`${ride.kind}-${ride.typeId || 'unknown'}-${index}`} className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800/80 dark:shadow-none sm:w-72">
                                <div className="flex flex-col items-center gap-2 text-center">
                                    <div className="min-w-0 text-center">
                                        <h4 className="break-words text-sm font-semibold text-gray-950 dark:text-white" title={ride.name || ride.category || `Ride ${index + 1}`}>{ride.name || ride.category || `Ride ${index + 1}`}</h4>
                                        {ride.name && ride.category && ride.category !== ride.name && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{ride.category}</p>}
                                    </div>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${RIDE_CATEGORY_STYLES[group.key] || RIDE_CATEGORY_STYLES['tracked-ride']}`}>{group.label}</span>
                                </div>
                                {ride.ratings && <div className="mt-2"><p className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">Final rating stored in blueprint metadata</p><RatingMetrics compact ratings={ride.ratings} /></div>}
                                {ride.kind === 'tracked' && showTraceNote && <RideTestStats stats={ride.testStats} />}
                            </article>
                        ))}
                    </div>
                </div>
            ))}
        </section>
    );
};

const ZooMetricSection = ({ eyebrow, title, children }) => (
    <section className="text-center">
        <div className="mb-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{eyebrow}</p>
            {title && <h3 className="mt-1 text-lg font-semibold text-gray-950 dark:text-white">{title}</h3>}
        </div>
        <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </section>
);

const ZooOverview = ({ park, blueprint }) => {
    const zoo = park || blueprint;
    if (!zoo) return null;
    return <div className="space-y-7">
        <ZooMetricSection eyebrow="Zoo overview">
            {park?.gameMode && <Metric label="Mode" value={humanize(park.gameMode)} />}
            {park?.biome && <Metric label="Biome" value={humanize(park.biome)} />}
            {park?.difficulty && <Metric label="Difficulty" value={humanize(park.difficulty)} />}
            {Number.isFinite(park?.guestCount) && <Metric label="Guests" value={formatNumber(park.guestCount)} />}
            {Number.isFinite(park?.animalCount) && <Metric label="Animals" value={formatNumber(park.animalCount)} title="Total animals stored by Planet Zoo, including habitat and exhibit animals." />}
            {Number.isFinite(park?.parkRating) && <Metric label="Park rating" value={formatPercent(park.parkRating)} />}
            {Number.isFinite(park?.guestHappiness) && <Metric label="Guest happiness" value={formatPercent(park.guestHappiness)} />}
            {Number.isFinite(park?.cash) && <Metric label="Balance" value={formatGameMoney(park.cash)} />}
            {Number.isFinite(park?.scenarioStarsTotal) && <Metric label="Scenario stars" value={`${formatNumber(park.scenarioStarsEarned)} / ${formatNumber(park.scenarioStarsTotal)}`} />}
            {park?.isDiorama === true && <Metric label="Park type" value="Diorama" />}
            {blueprint && Number.isFinite(blueprint.placementCost) && <Metric label="Build cost" value={formatGameMoney(blueprint.placementCost)} />}
            {blueprint && Number.isFinite(blueprint.runningCost) && <Metric label="Running cost" value={formatGameMoney(blueprint.runningCost)} />}
        </ZooMetricSection>

        <ZooMetricSection eyebrow="Animals & habitats" title="Living collection">
            {Number.isFinite(zoo.animalHabitatCount) && <Metric label="Habitats" value={formatNumber(zoo.animalHabitatCount)} />}
            {Number.isFinite(zoo.habitatAnimalCount) && <Metric label="Habitat animals" value={formatNumber(zoo.habitatAnimalCount)} title="Animals serialized by the habitat-animal manager; exhibit animals are not included in this value." />}
            {Number.isFinite(zoo.habitatObjectCount) && <Metric label="Habitat objects" value={formatNumber(zoo.habitatObjectCount)} />}
            {Number.isFinite(zoo.feedingStationCount) && <Metric label="Feeding stations" value={formatNumber(zoo.feedingStationCount)} />}
            {Number.isFinite(zoo.animalTalkCount) && <Metric label="Animal talks" value={formatNumber(zoo.animalTalkCount)} />}
        </ZooMetricSection>

        <ZooMetricSection eyebrow="Zoo operations" title="Facilities & staff">
            {Number.isFinite(zoo.facilityCount) && <Metric label="Facilities" value={formatNumber(zoo.facilityCount)} />}
            {Number.isFinite(zoo.staffCount) && <Metric label="Staff" value={formatNumber(zoo.staffCount)} />}
            {Number.isFinite(zoo.keeperHutCount) && <Metric label="Keeper huts" value={formatNumber(zoo.keeperHutCount)} />}
            {Number.isFinite(zoo.donationBoxCount) && <Metric label="Donation boxes" value={formatNumber(zoo.donationBoxCount)} />}
            {Number.isFinite(zoo.binCount) && <Metric label="Bins" value={formatNumber(zoo.binCount)} />}
            {Number.isFinite(zoo.benchCount) && <Metric label="Benches" value={formatNumber(zoo.benchCount)} />}
        </ZooMetricSection>

        <ZooMetricSection eyebrow="Construction & transport" title="Built environment">
            {Number.isFinite(zoo.placedPartCount) && <Metric label="Construction parts" value={formatNumber(zoo.placedPartCount)} title="Serialized placement parts, including scenery and building pieces." />}
            {Number.isFinite(zoo.pathSegmentCount) && <Metric label="Path segments" value={formatNumber(zoo.pathSegmentCount)} />}
            {Number.isFinite(zoo.lakeCount) && <Metric label="Lakes" value={formatNumber(zoo.lakeCount)} />}
            {Number.isFinite(zoo.rideCount) && <Metric label="Transport rides" value={formatNumber(zoo.rideCount)} />}
            {Number.isFinite(zoo.stationCount) && <Metric label="Ride stations" value={formatNumber(zoo.stationCount)} />}
        </ZooMetricSection>
    </div>;
};

const CreationMetadataPanel = ({
    metadata,
    filePath,
    metadataStatus = 'ready',
    metadataError,
    customMediaReferences = [],
    triggerLabel,
    triggerClassName,
    creationName,
    bannerImageUrl,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [bannerImageFailed, setBannerImageFailed] = useState(false);

    useEffect(() => setBannerImageFailed(false), [bannerImageUrl]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = event => { if (event.key === 'Escape') setIsOpen(false); };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || (bannerImageUrl && !bannerImageFailed) || !filePath || preview || !window.electronAPI?.readFrontierPreview) return undefined;
        let cancelled = false;
        setPreviewLoading(true);
        window.electronAPI.readFrontierPreview(filePath)
            .then(value => { if (!cancelled) setPreview(value || null); })
            .catch(() => { if (!cancelled) setPreview(null); })
            .finally(() => { if (!cancelled) setPreviewLoading(false); });
        return () => { cancelled = true; };
    }, [bannerImageFailed, bannerImageUrl, filePath, isOpen, preview]);

    if (!metadata && metadataStatus !== 'pending' && !metadataError) return null;
    const park = metadata?.park;
    const blueprint = metadata?.blueprint;
    const rides = park?.rides || blueprint?.rides || [];
    const trackedRideMetrics = trackedRideCategoryMetrics(rides, park?.trackedRideCount ?? blueprint?.trackedRideCount);
    const requiredDlcs = metadata?.requiredDlcs || [];
    const requiredDlcIdentifiers = metadata?.requiredDlcIdentifiers || [];
    const requiredDlcBits = metadata?.requiredDlcBits || [];
    const unknownDlcBits = metadata?.unknownDlcBits || [];
    const unknownDlcIdentifiers = metadata?.unknownDlcIdentifiers;
    const isPlanetZoo = metadata?.gameId === 'planet-zoo';
    const unresolvedDlcIdentifiers = Array.isArray(unknownDlcIdentifiers) ? unknownDlcIdentifiers :
        (isPlanetZoo ? requiredDlcIdentifiers.filter(identifier => {
        const bit = planetZooDlcIdentifierBit(identifier);
        return bit === null || !requiredDlcBits.includes(bit) || unknownDlcBits.includes(bit);
    }) : requiredDlcIdentifiers);
    const identifiedUnknownBits = new Set(unresolvedDlcIdentifiers
        .map(planetZooDlcIdentifierBit)
        .filter(Number.isSafeInteger));
    const displayedUnknownDlcBits = unknownDlcBits.filter(bit => !identifiedUnknownBits.has(bit));
    const headerImageUrl = bannerImageUrl && !bannerImageFailed ? bannerImageUrl : preview;
    const headerTitle = creationName || metadata?.name || park?.parkName || 'Creation analysis';

    const modal = isOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm dark:bg-black/75 sm:p-3" onMouseDown={event => { if (event.target === event.currentTarget) setIsOpen(false); }}>
            <div role="dialog" aria-modal="true" aria-label="Creation stats" className="flex max-h-[calc(100vh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-gray-300 bg-gray-100 text-center text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 sm:max-h-[calc(100vh-1.5rem)]">
                <header className={`relative min-h-48 overflow-hidden bg-gradient-to-br ${isPlanetZoo ? 'from-emerald-100 via-white to-lime-100 dark:from-emerald-950 dark:via-gray-900 dark:to-lime-950' : 'from-blue-100 via-white to-purple-100 dark:from-blue-950 dark:via-gray-900 dark:to-purple-950'}`}>
                    {headerImageUrl && (
                        <img
                            src={headerImageUrl}
                            alt={bannerImageUrl && !bannerImageFailed ? `${headerTitle} gallery banner` : 'In-game save preview'}
                            className="absolute inset-0 h-full w-full object-cover"
                            onError={() => { if (bannerImageUrl && !bannerImageFailed) setBannerImageFailed(true); }}
                        />
                    )}
                    <div className={`absolute inset-0 ${headerImageUrl ? 'bg-gradient-to-t from-black/90 via-black/45 to-black/15' : 'bg-gradient-to-t from-white via-white/55 to-white/10 dark:from-gray-950 dark:via-gray-950/35 dark:to-black/10'}`} />
                    {previewLoading && !headerImageUrl && <p className="absolute left-6 top-6 text-xs text-gray-700 dark:text-white/70">Loading save image…</p>}
                    <button type="button" aria-label="Close stats" onClick={() => setIsOpen(false)} className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/80 text-xl text-gray-800 shadow-sm hover:bg-white dark:bg-black/55 dark:text-white dark:shadow-none dark:hover:bg-black/80">×</button>
                    <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                        <div className="flex flex-col items-center justify-center gap-3 text-center">
                            <div className="text-center">
                                <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${headerImageUrl ? (isPlanetZoo ? 'text-emerald-200' : 'text-blue-200') : (isPlanetZoo ? 'text-emerald-700 dark:text-emerald-300' : 'text-blue-700 dark:text-blue-300')}`}>{isPlanetZoo ? (blueprint ? 'Zoo blueprint' : park ? 'Zoo save' : 'Planet Zoo creation') : (blueprint ? 'Blueprint' : park ? 'Park save' : 'Creation')}</p>
                                <h2 className={`mt-1 text-2xl font-bold sm:text-3xl ${headerImageUrl ? 'text-white drop-shadow-md' : 'text-gray-950 dark:text-white'}`}>{headerTitle}</h2>
                                <BannerEfnPills ratings={blueprint?.ratings} />
                            </div>
                            {metadataStatus === 'pending' && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">Analysis queued</span>}
                            {metadataStatus === 'error' && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">Analysis incomplete</span>}
                        </div>
                    </div>
                </header>

                <div className="overflow-y-auto p-5 text-center sm:p-7">
                    {!metadata && metadataStatus === 'pending' && <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:shadow-none">This file is waiting for its turn in the sequential metadata scan. The view updates automatically.</div>}
                    {metadataError && <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{metadataError}</div>}
                    {metadata && <div className="space-y-8">
                        {isPlanetZoo ? <ZooOverview park={park} blueprint={blueprint} /> : <section className="text-center">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-300">Overview</p>
                            <div className="flex flex-wrap justify-center gap-2">
                                {park && <>
                                    {park.gameMode && <Metric label="Mode" value={humanize(park.gameMode)} />}
                                    {park.biome && <Metric label="Biome" value={humanize(park.biome)} />}
                                    {(Number.isFinite(park.guestCount) || Number.isFinite(park.guestCap)) && <Metric label="Guests" value={`${formatNumber(park.guestCount)} / ${formatNumber(park.guestCap)}`} />}
                                    {Number.isFinite(park.complexity) && <Metric label="Complexity" value={formatNumber(park.complexity)} />}
                                    {Number.isFinite(park.rideCount) && <Metric label="Rides" value={formatNumber(park.rideCount)} />}
                                    {Number.isFinite(park.trackedRideCount) && <Metric label="Tracked rides" value={formatNumber(park.trackedRideCount)} />}
                                    {trackedRideMetrics.map(category => <Metric key={category.key} label={category.label} value={formatNumber(category.count)} />)}
                                    {Number.isFinite(park.flatRideCount) && <Metric label="Flat rides" value={formatNumber(park.flatRideCount)} />}
                                    {Number.isFinite(park.poolCount) && <Metric label="Pools" value={formatNumber(park.poolCount)} />}
                                    {Number.isFinite(park.placedPartCount) && <Metric label="Construction parts" value={formatNumber(park.placedPartCount)} title="Serialized PlacementPartData total, including grouped building and scenery parts." />}
                                    {Number.isFinite(park.sceneryPieceCount) && <Metric label="Piece entities" value={formatNumber(park.sceneryPieceCount)} title="Individual scenery/building PartData entities." />}
                                    {Number.isFinite(park.buildingCount) && <Metric label="Scenery/building groups" value={formatNumber(park.buildingCount)} title="Serialized scenery and building groups." />}
                                    {Number.isFinite(park.railElementCount) && <Metric label="Rail elements" value={formatNumber(park.railElementCount)} />}
                                    {Number.isFinite(park.trackedRideElementCount) && <Metric label="Tracked-ride elements" value={formatNumber(park.trackedRideElementCount)} />}
                                    {Number.isFinite(park.binCount) && <Metric label="Bins" value={formatNumber(park.binCount)} />}
                                </>}
                                {blueprint && <>
                                    {Number.isFinite(blueprint.placementCost) && <Metric label="Build cost" value={formatGameMoney(blueprint.placementCost)} />}
                                    {Number.isFinite(blueprint.runningCost) && <Metric label="Running cost" value={formatGameMoney(blueprint.runningCost)} />}
                                    {Number.isFinite(blueprint.sceneryCount) && <Metric label="Loose scenery" value={formatNumber(blueprint.sceneryCount)} title="Count from the outer blueprint metadata; grouped building parts are represented separately." />}
                                    {Number.isFinite(blueprint.buildingCount) && <Metric label="Buildings" value={formatNumber(blueprint.buildingCount)} />}
                                    {Number.isFinite(blueprint.rideCount) && <Metric label="Rides" value={formatNumber(blueprint.rideCount)} />}
                                    {Number.isFinite(blueprint.trackedRideCount) && <Metric label="Tracked rides" value={formatNumber(blueprint.trackedRideCount)} />}
                                    {trackedRideMetrics.map(category => <Metric key={category.key} label={category.label} value={formatNumber(category.count)} />)}
                                    {Number.isFinite(blueprint.flatRideCount) && <Metric label="Flat rides" value={formatNumber(blueprint.flatRideCount)} />}
                                    {Number.isFinite(blueprint.placedPartCount) && <Metric label="Construction parts" value={formatNumber(blueprint.placedPartCount)} />}
                                    {Number.isFinite(blueprint.sceneryPieceCount) && <Metric label="Piece entities" value={formatNumber(blueprint.sceneryPieceCount)} />}
                                    {Number.isFinite(blueprint.serializedGroupCount) && <Metric label="Serialized groups" value={formatNumber(blueprint.serializedGroupCount)} />}
                                    {Number.isFinite(blueprint.railElementCount) && <Metric label="Rail elements" value={formatNumber(blueprint.railElementCount)} />}
                                    {Number.isFinite(blueprint.trackedRideElementCount) && <Metric label="Tracked-ride elements" value={formatNumber(blueprint.trackedRideElementCount)} />}
                                    {Number.isFinite(blueprint.binCount) && <Metric label="Bins" value={formatNumber(blueprint.binCount)} />}
                                    {Number.isFinite(blueprint.poolCount) && <Metric label="Pools" value={formatNumber(blueprint.poolCount)} />}
                                </>}
                            </div>
                            {park && Number.isFinite(park.placedPartCount) && <p className="mt-3 text-xs leading-relaxed text-gray-500">Construction parts already include grouped scenery, props and most effect objects. Rails, tracked-ride elements and some simulation objects are stored in separate managers, so they are shown separately instead of being combined into an unverified in-game selection total.</p>}
                        </section>}

                        {blueprint?.utilities && <section className="text-center">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-300">Utilities</p>
                            <div className="flex flex-wrap justify-center gap-2">
                                {Number.isFinite(blueprint.utilities.generatedPower) && <Metric label="Generated power" value={formatNumber(blueprint.utilities.generatedPower, 2)} />}
                                {Number.isFinite(blueprint.utilities.requiredPower) && <Metric label="Required power" value={formatNumber(blueprint.utilities.requiredPower, 2)} />}
                                {Number.isFinite(blueprint.utilities.generatedWater) && <Metric label="Generated water" value={formatNumber(blueprint.utilities.generatedWater, 2)} />}
                                {Number.isFinite(blueprint.utilities.requiredWater) && <Metric label="Required water" value={formatNumber(blueprint.utilities.requiredWater, 2)} />}
                            </div>
                        </section>}
                        <ResearchPackList researchPacks={blueprint?.researchPacks} />
                        <RideOverview
                            rides={rides}
                            showTraceNote={!isPlanetZoo}
                            eyebrow={isPlanetZoo ? 'Transport' : 'Rides'}
                            title={isPlanetZoo ? 'Transport ride overview' : 'Per-ride overview'}
                        />

                        <section className="flex flex-wrap justify-center gap-4 text-center">
                            <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900/60 dark:shadow-none">
                                <h3 className="font-semibold text-gray-950 dark:text-white">Required DLC</h3>
                                <div className="mt-3 flex flex-wrap justify-center gap-2">
                                    {requiredDlcs.map(dlc => <span key={dlc} className="rounded-full bg-purple-100 px-2.5 py-1 text-xs text-purple-800 dark:bg-purple-900/70 dark:text-purple-200">{dlc}</span>)}
                                    {unresolvedDlcIdentifiers.map(identifier => <span key={identifier} title="Frontier content identifier without a known DLC mapping" className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">Unknown DLC ({formatDlcIdentifier(identifier)})</span>)}
                                    {metadata.requiredDlc === null && <span className="text-sm text-gray-600 dark:text-gray-400">DLC metadata unavailable</span>}
                                    {metadata.requiredDlc !== null && requiredDlcs.length === 0 && unresolvedDlcIdentifiers.length === 0 && displayedUnknownDlcBits.length === 0 && <span className="text-sm text-gray-600 dark:text-gray-400">No DLC detected</span>}
                                    {displayedUnknownDlcBits.map(bit => <span key={bit} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">Unknown DLC (Bit {bit})</span>)}
                                </div>
                            </div>
                            <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300 dark:shadow-none">
                                <h3 className="font-semibold text-gray-950 dark:text-white">Creation details</h3>
                                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                    <span className="text-gray-500">Modded</span><span>{metadata.isModded ? 'Yes' : 'No'}</span>
                                    <span className="text-gray-500">Game version</span><span>{metadata.gameVersion || 'N/A'}</span>
                                    <span className="text-gray-500">Save format</span><span>{metadata.saveFormatVersion ?? 'N/A'}</span>
                                    {blueprint?.rideId && <><span className="text-gray-500">Ride ID</span><span className="break-all">{blueprint.rideId}</span></>}
                                </div>
                            </div>
                        </section>
                        {metadata.description && <section className="mx-auto w-fit max-w-3xl rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900/60 dark:shadow-none"><h3 className="font-semibold text-gray-950 dark:text-white">Description</h3><p className="mt-2 whitespace-pre-wrap text-center text-sm leading-relaxed text-gray-700 dark:text-gray-300">{metadata.description}</p></section>}
                        {metadata.tags?.length > 0 && <div className="flex flex-wrap justify-center gap-1.5">{metadata.tags.map(tag => <span key={tag} className="rounded-full bg-gray-200 px-2.5 py-1 text-center text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{humanize(tag)}</span>)}</div>}
                        <CustomMediaGrid references={customMediaReferences} />
                    </div>}
                </div>
            </div>
        </div>,
        document.body,
    );

    return <>
        <button type="button" onClick={() => setIsOpen(true)} className={triggerClassName || 'mt-3 inline-flex items-center gap-2 rounded-full border border-blue-500/50 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:bg-blue-500/20'}>
            {metadataStatus === 'pending' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600 dark:bg-blue-300" />}
            {triggerLabel || (metadataStatus === 'pending' ? 'Stats queued' : 'View stats')}
        </button>
        {modal}
    </>;
};

export default CreationMetadataPanel;
