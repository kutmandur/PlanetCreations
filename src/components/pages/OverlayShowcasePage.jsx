import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase/config';
import AnimatedPillTabs from '../ui/AnimatedPillTabs';
import SharingQrCode from '../ui/SharingQrCode';
import Spinner from '../ui/Spinner';
import VerifiedParkStats, { AreaSections, TypeSections } from '../ui/VerifiedParkStats';
import {
    groupPresentedParkRides,
    groupPresentedParkRidesByArea,
    sanitizeParkRidePresentation,
} from '../../utils/parkRidePresentation';
import { readOverlayQr, setOverlayQr, subscribeOverlayQr } from '../../utils/overlayQr';
import {
    clearOverlayShowcaseChecklist,
    isOverlayShowcaseEntry,
    readOverlayShowcaseChecklist,
    selectOverlayShowcaseCreation,
    writeOverlayShowcaseChecklist,
} from '../../utils/overlayShowcase';

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const creationKind = (creation) => {
    const metadata = creation?.verifiedGameMetadata?.metadata;
    if (metadata?.park) return 'Park';
    if (metadata?.blueprint) return 'Blueprint';
    return creation?.category || 'Creation';
};

const sortCreations = (creations, sortBy) => [...creations].sort((left, right) => {
    if (sortBy === 'type') {
        return creationKind(left).localeCompare(creationKind(right)) ||
            String(left.title || '').localeCompare(String(right.title || ''));
    }
    if (sortBy === 'creator') {
        return String(left.username || '').localeCompare(String(right.username || '')) ||
            String(left.title || '').localeCompare(String(right.title || ''));
    }
    return String(left.title || '').localeCompare(String(right.title || ''));
});

const Stat = ({ label, value }) => Number.isFinite(value) ? (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
        <p className="mt-1 text-lg font-black text-gray-950 dark:text-white">{numberFormatter.format(value)}</p>
    </div>
) : null;

const ParkShowcaseDetails = ({ creation, metadata, checkedRideKeys, onToggleChecked, onResetChecked }) => {
    const presentation = useMemo(() => sanitizeParkRidePresentation(creation.parkRidePresentation), [creation.parkRidePresentation]);
    const park = metadata?.park || (presentation.customRides.length > 0 ? { rides: [] } : null);
    const groups = useMemo(() => groupPresentedParkRides(park, presentation), [park, presentation]);
    const areaGroups = useMemo(() => groupPresentedParkRidesByArea(park, presentation), [park, presentation]);
    const hasAreas = presentation.areas.length > 0;
    const [grouping, setGrouping] = useState(hasAreas ? 'areas' : 'types');
    const attractionCount = groups.reduce((sum, group) => sum + group.rides.length, 0);
    const checkedCount = checkedRideKeys.size;

    useEffect(() => setGrouping(hasAreas ? 'areas' : 'types'), [creation.id, hasAreas]);

    return (
        <section className="mt-5">
            <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Attractions" value={attractionCount} />
                <Stat label="Areas" value={hasAreas ? presentation.areas.length : 0} />
                <Stat label="Guests" value={park?.guestCount} />
                <Stat label="Scenery pieces" value={park?.placedPartCount ?? park?.sceneryPieceCount} />
            </div>
            {groups.length > 0 ? (
                <>
                    <div className="mb-3 flex items-center justify-center gap-3 text-xs font-bold text-gray-500 dark:text-gray-400">
                        <span>{checkedCount} of {attractionCount} checked</span>
                        {checkedCount > 0 && (
                            <button type="button" onClick={onResetChecked} className="rounded-full bg-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                                Reset
                            </button>
                        )}
                    </div>
                    <div className="mb-5 flex justify-center">
                        <AnimatedPillTabs
                            activeTab={grouping}
                            onChange={setGrouping}
                            tabs={hasAreas ? [
                                { id: 'types', label: 'By type' },
                                { id: 'areas', label: 'By area' },
                            ] : [{ id: 'types', label: 'By type' }]}
                        />
                    </div>
                    {grouping === 'areas' && hasAreas ?
                        <AreaSections groups={areaGroups} checkedRideKeys={checkedRideKeys} onToggleChecked={onToggleChecked} /> :
                        <TypeSections groups={groups} checkedRideKeys={checkedRideKeys} onToggleChecked={onToggleChecked} />}
                </>
            ) : (
                <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                    This park does not contain a stored ride list.
                </p>
            )}
        </section>
    );
};

const CreationShowcaseDetails = ({ creation, checkedRideKeys, onToggleChecked, onResetChecked }) => {
    const metadata = creation?.verifiedGameMetadata?.metadata;
    const isPark = Boolean(metadata?.park);
    const bannerImage = creation.imageUrls?.[0] || '';
    return (
        <div className="min-w-0">
            <div className="relative min-h-52 overflow-hidden rounded-2xl bg-gradient-to-br from-gray-800 to-gray-950 shadow-lg">
                {bannerImage && <img src={bannerImage} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
                <div className="relative flex min-h-52 flex-col justify-end p-5 text-center text-white sm:p-7">
                    <div className="mx-auto mb-2 rounded-full bg-black/55 px-3 py-1 text-xs font-black uppercase tracking-widest backdrop-blur-sm">
                        {creationKind(creation)}
                    </div>
                    <h1 className="text-2xl font-black leading-tight sm:text-4xl">{creation.title}</h1>
                    <p className="mt-2 text-sm text-white/80">by {creation.username || 'Unknown creator'}</p>
                    {creation.shareCode && (
                        <p className="mx-auto mt-3 rounded-lg bg-black/55 px-3 py-1.5 font-mono text-sm font-bold backdrop-blur-sm">
                            In-game share code: {creation.shareCode}
                        </p>
                    )}
                </div>
            </div>

            {creation.description && (
                <p className="mx-auto mt-4 max-w-3xl whitespace-pre-wrap text-center text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                    {creation.description}
                </p>
            )}

            {isPark ? (
                <ParkShowcaseDetails
                    creation={creation}
                    metadata={metadata}
                    checkedRideKeys={checkedRideKeys}
                    onToggleChecked={onToggleChecked}
                    onResetChecked={onResetChecked}
                />
            ) : metadata?.blueprint ? (
                <VerifiedParkStats
                    metadata={metadata}
                    presentation={creation.parkRidePresentation}
                    creationName={creation.title}
                    bannerImageUrl={bannerImage}
                    creationId={creation.id}
                    rideAnalysisSummary={creation.verifiedGameMetadata?.rideAnalysis}
                />
            ) : (
                <p className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-center text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                    No verified park or blueprint details are stored for this creation.
                </p>
            )}
        </div>
    );
};

const OverlayShowcasePage = ({ localClientId = '' }) => {
    const navigate = useNavigate();
    const [entry, setEntry] = useState(() => readOverlayQr());
    const [creations, setCreations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [sortBy, setSortBy] = useState('title');
    const [isFinishing, setIsFinishing] = useState(false);
    const [finishError, setFinishError] = useState('');
    const [checkedRidesByCreation, setCheckedRidesByCreation] = useState(() =>
        readOverlayShowcaseChecklist(readOverlayQr()));

    useEffect(() => subscribeOverlayQr(setEntry), []);
    const creationIdsKey = isOverlayShowcaseEntry(entry) ? entry.creationIds.join('\u001f') : '';

    useEffect(() => {
        setCheckedRidesByCreation(readOverlayShowcaseChecklist(entry));
    }, [entry?.communityId, entry?.showcaseId, creationIdsKey]);

    useEffect(() => {
        let cancelled = false;
        if (!isOverlayShowcaseEntry(entry)) {
            setCreations([]);
            setLoading(false);
            return undefined;
        }
        setLoading(true);
        setLoadError('');
        Promise.all(entry.creationIds.map(async (creationId) => {
            const snapshot = await getDoc(doc(db, 'creations', creationId));
            return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
        })).then((loaded) => {
            if (cancelled) return;
            setCreations(loaded.filter(Boolean));
            setLoading(false);
            if (loaded.some(creation => !creation)) setLoadError('One or more creations are no longer available.');
        }).catch((error) => {
            if (cancelled) return;
            setLoadError(error.message || 'The showcase could not be loaded.');
            setLoading(false);
        });
        return () => { cancelled = true; };
        // Only refetch when group membership changes, not when its active item changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creationIdsKey]);

    const activeCreation = creations.find(creation =>
        creation.id === (entry?.activeCreationId || entry?.creationId)) || creations[0] || null;
    const sortedCreations = useMemo(() => sortCreations(creations, sortBy), [creations, sortBy]);
    const isGroup = creations.length > 1;
    const checkedRideKeys = useMemo(() => new Set(
        checkedRidesByCreation[activeCreation?.id] || []
    ), [activeCreation?.id, checkedRidesByCreation]);

    const selectCreation = (creation) => {
        const next = selectOverlayShowcaseCreation(entry, creation);
        setOverlayQr(next);
    };

    const updateCheckedRides = (creationId, updater) => {
        setCheckedRidesByCreation(current => {
            const nextKeys = updater(new Set(current[creationId] || []));
            const next = { ...current, [creationId]: [...nextKeys] };
            writeOverlayShowcaseChecklist(entry, next);
            return next;
        });
    };

    const toggleRideChecked = (rideKey) => {
        if (!activeCreation) return;
        updateCheckedRides(activeCreation.id, keys => {
            if (keys.has(rideKey)) keys.delete(rideKey);
            else keys.add(rideKey);
            return keys;
        });
    };

    const resetCheckedRides = () => {
        if (!activeCreation) return;
        updateCheckedRides(activeCreation.id, () => new Set());
    };

    const finishShowcase = async () => {
        if (isFinishing) return;
        setIsFinishing(true);
        setFinishError('');
        try {
            if (entry?.source === 'remote' && !localClientId) {
                throw new Error('The desktop client is still initializing. Please try again in a moment.');
            }
            if (entry?.source === 'remote') {
                const callable = httpsCallable(getFunctions(), 'setClientOverlayQr');
                await callable({ clientId: localClientId, entry: null });
            }
            clearOverlayShowcaseChecklist();
            setOverlayQr(null);
            navigate('/', { replace: true });
            window.electronAPI?.setOverlayExpanded?.(false);
        } catch (error) {
            setFinishError(error.message || 'The showcase could not be finished.');
            setIsFinishing(false);
        }
    };

    if (!isOverlayShowcaseEntry(entry)) {
        return (
            <div className="flex min-h-full items-center justify-center p-6">
                <div className="max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    <h1 className="text-2xl font-black text-gray-900 dark:text-white">No overlay showcase is active</h1>
                    <p className="mt-2 text-gray-500 dark:text-gray-400">Activate a creation or group from Community Manager → Showcases → Overlay.</p>
                </div>
            </div>
        );
    }

    if (loading) return <div className="flex min-h-full items-center justify-center"><Spinner /></div>;

    return (
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
            <header className="mb-5 text-center">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600 dark:text-blue-400">Community showcase</p>
                <h1 className="mt-1 text-xl font-black text-gray-900 dark:text-white sm:text-2xl">{entry.showcaseTitle || activeCreation?.title}</h1>
            </header>
            {loadError && <p className="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{loadError}</p>}

            <div className={isGroup ? 'grid items-start gap-5 md:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]' : ''}>
                {isGroup && (
                    <aside className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:sticky md:top-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h2 className="font-black text-gray-900 dark:text-white">Creations</h2>
                            <select
                                value={sortBy}
                                onChange={(event) => setSortBy(event.target.value)}
                                className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                                aria-label="Sort showcase creations"
                            >
                                <option value="title">Title</option>
                                <option value="type">Type</option>
                                <option value="creator">Creator</option>
                            </select>
                        </div>
                        <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                            {sortedCreations.map(creation => {
                                const active = creation.id === activeCreation?.id;
                                return (
                                    <button
                                        key={creation.id}
                                        type="button"
                                        onClick={() => selectCreation(creation)}
                                        className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-200 dark:bg-blue-950/60 dark:ring-blue-900' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900'}`}
                                    >
                                        <img src={creation.imageUrls?.[0] || 'logo.png'} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-bold text-gray-900 dark:text-white">{creation.title}</span>
                                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{creationKind(creation)} · {creation.username || 'Unknown creator'}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                )}

                {activeCreation ? (
                    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
                        <div className="grid items-start gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_12rem]">
                            <CreationShowcaseDetails
                                key={activeCreation.id}
                                creation={activeCreation}
                                checkedRideKeys={checkedRideKeys}
                                onToggleChecked={toggleRideChecked}
                                onResetChecked={resetCheckedRides}
                            />
                            <aside className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-center dark:border-gray-700 dark:bg-gray-900">
                                <p className="text-xs font-black uppercase tracking-wide text-gray-500 dark:text-gray-400">Active share QR</p>
                                <SharingQrCode
                                    url={entry.url}
                                    name={activeCreation.title}
                                    fileLabel={activeCreation.title}
                                    heading={null}
                                    previewClassName="max-w-[168px]"
                                    containerClassName="mt-2"
                                    copyLabel="Copy creation link"
                                />
                            </aside>
                        </div>
                    </section>
                ) : (
                    <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800">No creation in this showcase is available.</p>
                )}
            </div>
            <footer className="mt-8 flex flex-col items-center border-t border-gray-200 pt-6 dark:border-gray-700">
                {finishError && <p className="mb-3 rounded-lg bg-red-100 px-4 py-2 text-center text-sm text-red-800 dark:bg-red-950 dark:text-red-100">{finishError}</p>}
                <button
                    type="button"
                    onClick={finishShowcase}
                    disabled={isFinishing}
                    className="min-w-56 rounded-full bg-red-600 px-6 py-3 text-sm font-black text-white shadow-lg transition-all hover:bg-red-700 hover:shadow-xl disabled:cursor-wait disabled:opacity-60"
                >
                    {isFinishing ? 'Finishing showcase…' : 'Finish showcase'}
                </button>
                <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">Ends the current showcase and restores the normal overlay icon.</p>
            </footer>
        </div>
    );
};

export default OverlayShowcasePage;
