import React, { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const FeatureCard = ({ id, icon, title, description, accent = 'blue', badge }) => {
    const accents = {
        blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
        green: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300',
        purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300',
        amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
        cyan: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-300',
        rose: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'
    };

    return (
        <article id={id} className="client-feature-card relative scroll-mt-24 overflow-hidden bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 text-center transition-all duration-300 hover:-translate-y-2 hover:shadow-xl">
            <span className="client-card-shine" aria-hidden="true" />
            {badge && (
                <span className="absolute top-4 right-4 rounded-full bg-blue-100 dark:bg-blue-900/50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-200">
                    {badge}
                </span>
            )}
            <div className={`client-feature-icon w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center ${accents[accent]}`}>
                <Icon path={icon} className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{description}</p>
        </article>
    );
};

const WorkflowStep = ({ number, title, description, last = false }) => (
    <div className="client-workflow-step relative flex gap-4 rounded-lg -mx-2 px-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50">
        {!last && <div className="absolute left-5 top-10 bottom-[-1.5rem] w-px bg-blue-200 dark:bg-blue-800" />}
        <div className="client-step-number relative z-10 w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold shadow-sm">
            {number}
        </div>
        <div className="pb-6">
            <h3 className="font-bold text-gray-900 dark:text-gray-100">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{description}</p>
        </div>
    </div>
);

const getPlatformSignature = (browserNavigator) => [
    browserNavigator?.userAgentData?.platform,
    browserNavigator?.platform,
    browserNavigator?.userAgent,
].filter(Boolean).join(' ').toLowerCase();

export const detectRecommendedDownload = (browserNavigator = typeof navigator === 'undefined' ? null : navigator) => {
    const signature = getPlatformSignature(browserNavigator);
    if (/iphone|ipad|ipod|android/.test(signature)) return null;
    if (/windows|win32|win64/.test(signature)) return 'windows';
    if (/linux/.test(signature)) return 'linux';
    if (!/mac|darwin/.test(signature)) return null;

    const explicitArchitecture = `${browserNavigator?.userAgentData?.architecture || ''} ${browserNavigator?.userAgent || ''}`.toLowerCase();
    if (/arm64|aarch64|apple silicon/.test(explicitArchitecture)) return 'macArm64';
    if (/x86_64|amd64/.test(explicitArchitecture)) return 'macIntel';

    // Modern Apple Silicon browsers often report the compatibility value
    // "MacIntel". Prefer the current Mac architecture until Client Hints can
    // provide a reliable hardware answer below.
    return 'macArm64';
};

const resolveRecommendedDownload = async (browserNavigator) => {
    const initialRecommendation = detectRecommendedDownload(browserNavigator);
    if (!initialRecommendation?.startsWith('mac') ||
        typeof browserNavigator?.userAgentData?.getHighEntropyValues !== 'function') {
        return initialRecommendation;
    }

    try {
        const details = await browserNavigator.userAgentData.getHighEntropyValues(['architecture', 'bitness']);
        const architecture = String(details?.architecture || '').toLowerCase();
        if (/^arm|aarch/.test(architecture)) return 'macArm64';
        if (/^(x86|x64|amd)/.test(architecture)) return 'macIntel';
    } catch {
        // Privacy settings may reject high-entropy Client Hints. The initial
        // operating-system recommendation remains useful in that case.
    }

    return initialRecommendation;
};

const InfoTooltip = ({ label, children }) => (
    <span className="group absolute right-3 top-3 z-20">
        <button
            type="button"
            aria-label={label}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors hover:border-blue-400 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:border-blue-400 dark:hover:text-blue-300"
        >
            <Icon path={ICONS.info} className="h-4 w-4" />
        </button>
        <span role="tooltip" className="pointer-events-none absolute right-0 top-full mt-2 w-64 translate-y-1 rounded-lg bg-gray-950 px-3 py-2 text-left text-xs font-medium leading-relaxed text-white opacity-0 shadow-xl transition-all group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:bg-gray-100 dark:text-gray-900">
            {children}
        </span>
    </span>
);

const DownloadCard = ({ title, subtitle, detail, icon, accent, href, loading, recommended, info }) => (
    <article className={`relative flex h-full flex-col rounded-xl border-2 bg-white dark:bg-gray-800 p-4 text-center shadow-md transition-all hover:-translate-y-1 hover:shadow-xl ${recommended ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'}`}>
        {recommended && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                Recommended for this device
            </span>
        )}
        {info && <InfoTooltip label={`About ${title}`}>{info}</InfoTooltip>}
        <div className={`w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center ${accent}`}>
            <Icon path={icon} className="w-7 h-7" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="mt-1 font-semibold text-gray-700 dark:text-gray-200">{subtitle}</p>
        <p className="mt-2 min-h-[2.5rem] text-sm text-gray-500 dark:text-gray-400">{detail}</p>
        <div className="mt-auto pt-5">
            {href ? (
                <a href={href} className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-bold text-white transition-colors hover:bg-blue-700">
                    <Icon path={ICONS.download} className="w-5 h-5" />
                    Download
                </a>
            ) : (
                <span className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-gray-200 px-4 py-2.5 font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                    {loading ? 'Finding latest download…' : 'Download unavailable'}
                </span>
            )}
        </div>
    </article>
);

const MicrosoftStoreCard = ({ recommended }) => {
    const badgeRef = useRef(null);

    useEffect(() => {
        const badge = badgeRef.current;
        if (!badge) return;
        Object.entries({
            productid: '9pc0mzv8rwr0',
            productname: 'PlanetCreations Client',
            'window-mode': 'direct',
            theme: 'auto',
            size: 'large',
            language: 'en-us',
            animation: 'on',
        }).forEach(([name, value]) => badge.setAttribute(name, value));
    }, []);

    return (
        <article className={`relative flex h-full flex-col rounded-xl border-2 bg-white dark:bg-gray-800 p-4 text-center shadow-md transition-all hover:-translate-y-1 hover:shadow-xl ${recommended ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'}`}>
            {recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                    Recommended for this device
                </span>
            )}
            <InfoTooltip label="About the Microsoft Store version">
                Microsoft verifies and signs this package, avoiding the direct installer's unsigned-publisher warning. Updates arrive through Microsoft Store after certification, so a new release can appear later than the direct version.
            </InfoTooltip>
            <div className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                <Icon path={ICONS.shieldCheck} className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Microsoft Store</h3>
            <p className="mt-1 font-semibold text-gray-700 dark:text-gray-200">Windows 10 &amp; 11</p>
            <p className="mt-2 min-h-[2.5rem] text-sm text-gray-500 dark:text-gray-400">
                Microsoft-verified installation with updates managed by Windows.
            </p>
            <div className="client-store-badge mt-auto flex min-h-[44px] items-center justify-center pt-5">
                <ms-store-badge
                    ref={badgeRef}
                    productid="9pc0mzv8rwr0"
                    productname="PlanetCreations Client"
                    window-mode="direct"
                />
            </div>
        </article>
    );
};

const ClientInfoPage = () => {
    const [downloads, setDownloads] = useState({
        loading: true,
        version: null,
        windows: null,
        macArm64: null,
        macIntel: null,
        linux: null,
    });
    const [recommendedDownload, setRecommendedDownload] = useState(() => detectRecommendedDownload());

    useEffect(() => {
        let cancelled = false;
        fetch('https://api.github.com/repos/kutmandur/PlanetCreations/releases/latest', {
            headers: { Accept: 'application/vnd.github+json' },
        })
            .then((response) => {
                if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
                return response.json();
            })
            .then((release) => {
                if (cancelled) return;
                const assets = Array.isArray(release.assets) ? release.assets : [];
                const findAsset = (predicate) => assets.find((asset) => predicate(asset.name))?.browser_download_url || null;
                setDownloads({
                    loading: false,
                    version: release.tag_name || null,
                    windows: findAsset((name) => /Setup-.*\.exe$/i.test(name)),
                    macArm64: findAsset((name) => /-arm64\.dmg$/i.test(name)),
                    macIntel: findAsset((name) => /\.dmg$/i.test(name) && !/-arm64\.dmg$/i.test(name)),
                    linux: findAsset((name) => /\.AppImage$/i.test(name)),
                });
            })
            .catch(() => {
                if (!cancelled) setDownloads((current) => ({ ...current, loading: false }));
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (typeof navigator === 'undefined') return undefined;
        let cancelled = false;
        resolveRecommendedDownload(navigator).then((recommendation) => {
            if (!cancelled) setRecommendedDownload(recommendation);
        });
        return () => { cancelled = true; };
    }, []);

    const scrollToSection = (sectionId) => {
        document.getElementById(sectionId)?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    };
    const scrollToDownloads = () => scrollToSection('client-downloads');
    const previewLinks = [
        { label: 'PlanetCreations', sectionId: 'in-game-overlay-feature' },
        { label: 'Savefile Stats', sectionId: 'savefile-intelligence' },
        { label: 'Backups', sectionId: 'savegame-backups' },
        { label: 'Custom Media', sectionId: 'custom-media-automation' },
    ];

    return (
        <main className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            <section className="client-hero relative overflow-hidden bg-gray-900 text-white">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/40 via-transparent to-purple-600/30" />
                <div className="client-hero-grid absolute inset-0" />
                <div className="client-orb client-orb-one absolute -top-24 -right-24 w-80 h-80 rounded-full bg-blue-500/30 blur-3xl" />
                <div className="client-orb client-orb-two absolute -bottom-40 -left-24 w-96 h-96 rounded-full bg-purple-500/25 blur-3xl" />
                <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 md:py-24 text-center">
                    <div className="client-hero-enter client-hero-kicker inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 backdrop-blur-md px-4 py-2 text-sm font-semibold mb-6">
                        <Icon path={ICONS.desktop} className="w-5 h-5" />
                        PlanetCreations Desktop Client
                    </div>
                    <h1 className="client-hero-enter client-hero-title text-4xl md:text-6xl font-extrabold tracking-tight">PlanetCreations, <span className="client-gradient-text">right inside your game.</span></h1>
                    <p className="client-hero-enter client-hero-copy max-w-3xl mx-auto mt-6 text-lg md:text-xl leading-relaxed text-gray-200">
                        Manage parks and blueprints, extract useful savefile metadata, preserve matching Custom Media and open the PlanetCreations hub without leaving your game.
                    </p>
                    <div className="client-hero-enter client-hero-actions mt-9 flex flex-col sm:flex-row justify-center gap-3">
                        <button type="button" onClick={scrollToDownloads} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-6 py-3 font-bold text-white transition-colors shadow-lg">
                            <Icon path={ICONS.download} className="w-5 h-5" />
                            Download Latest Release
                        </button>
                        <a href="https://github.com/kutmandur/PlanetCreations" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 px-6 py-3 font-bold text-white transition-colors">
                            <Icon path={ICONS.code} className="w-5 h-5" />
                            View Source Code
                        </a>
                    </div>
                    <p className="mt-4 text-sm text-gray-400">Available for Windows, Apple Silicon and Intel Macs, and Linux</p>
                    <div className="client-app-preview relative mt-12 max-w-3xl mx-auto rounded-xl border border-white/20 bg-gray-950/80 p-2 shadow-2xl backdrop-blur-md text-left" aria-label="Explore PlanetCreations client features">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                            <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                            <span className="ml-3 text-xs text-gray-400">PlanetCreations Client</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 p-3 text-xs">
                            {previewLinks.map(({ label, sectionId }, index) => (
                                <button
                                    key={label}
                                    type="button"
                                    onClick={() => scrollToSection(sectionId)}
                                    title={`Jump to ${label}`}
                                    className={`rounded-md px-2 py-2 text-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${index === 0 ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-3 gap-3 p-3 pt-1">
                            {[72, 48, 61].map((width, index) => (
                                <div key={width} className="rounded-lg border border-white/10 bg-gray-900 p-3">
                                    <div className={`h-16 rounded-md bg-gradient-to-br ${index === 0 ? 'from-blue-500/50 to-cyan-400/20' : index === 1 ? 'from-purple-500/50 to-pink-400/20' : 'from-green-500/50 to-emerald-400/20'}`} />
                                    <div className="mt-3 h-2 rounded bg-gray-700" style={{ width: `${width}%` }} />
                                    <div className="mt-2 h-1.5 w-1/2 rounded bg-gray-800" />
                                </div>
                            ))}
                        </div>
                        <button type="button" onClick={() => scrollToSection('in-game-overlay-feature')} className="client-floating-badge client-floating-badge-one" title="Jump to the In-Game Overlay feature">
                            <Icon path={ICONS.desktop} className="w-4 h-4" /> In-Game Overlay
                        </button>
                        <button type="button" onClick={() => scrollToSection('savegame-backups')} className="client-floating-badge client-floating-badge-two" title="Jump to immediate savegame backups">
                            <Icon path={ICONS.shieldCheck} className="w-4 h-4" /> Savegame backed up
                        </button>
                    </div>
                </div>
            </section>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 md:py-20 space-y-20">
                <section id="client-downloads" className="scroll-mt-8">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl md:text-4xl font-bold">Download the right client</h2>
                        <p className="mt-3 text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                            Choose your operating system — each button opens the correct installer directly.
                            {downloads.version && <span className="block mt-1 font-semibold">Latest release: {downloads.version}</span>}
                        </p>
                    </div>
                    <p className="mb-6 text-center text-sm text-gray-600 dark:text-gray-300">
                        The direct and Microsoft Store versions contain the same PlanetCreations features and use the same account and local data.
                    </p>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <DownloadCard
                            title="Direct download"
                            subtitle="Windows 10 & 11 (.exe)"
                            detail="Available directly from GitHub with the built-in updater."
                            icon={ICONS.desktop}
                            accent="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
                            href={downloads.windows}
                            loading={downloads.loading}
                            info="Direct releases are normally available as soon as they are published on GitHub and update through the client. Because the installer is currently unsigned, Windows SmartScreen may show an unknown-publisher warning during installation."
                        />
                        <MicrosoftStoreCard recommended={recommendedDownload === 'windows'} />
                        <DownloadCard
                            title="macOS"
                            subtitle="Apple Silicon"
                            detail="For Macs with an M1, M2, M3, M4 or newer Apple chip (.dmg)."
                            icon={ICONS.desktop}
                            accent="bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                            href={downloads.macArm64}
                            loading={downloads.loading}
                            recommended={recommendedDownload === 'macArm64'}
                        />
                        <DownloadCard
                            title="macOS"
                            subtitle="Intel (x64)"
                            detail="For Intel-based 64-bit Macs (.dmg)."
                            icon={ICONS.desktop}
                            accent="bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                            href={downloads.macIntel}
                            loading={downloads.loading}
                            recommended={recommendedDownload === 'macIntel'}
                        />
                        <DownloadCard
                            title="Linux"
                            subtitle="64-bit Linux"
                            detail="Portable AppImage — download, make executable and launch."
                            icon={ICONS.code}
                            accent="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            href={downloads.linux}
                            loading={downloads.loading}
                            recommended={recommendedDownload === 'linux'}
                        />
                    </div>
                    {!downloads.loading && !downloads.windows && !downloads.macArm64 && !downloads.macIntel && !downloads.linux && (
                        <p className="mt-5 text-center text-sm text-red-600 dark:text-red-400">
                            GitHub could not provide the download list. Try the{' '}
                            <a href="https://github.com/kutmandur/PlanetCreations/releases/latest" target="_blank" rel="noopener noreferrer" className="font-bold underline">release page</a>.
                        </p>
                    )}
                </section>

                <section id="ingame-overlay" className="scroll-mt-8">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl md:text-4xl font-bold">PlanetCreations where you build</h2>
                        <p className="mt-3 text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                            The client brings PlanetCreations into your game, understands supported local savefiles and keeps both creations and their media protected.
                        </p>
                    </div>
                    <div className="grid lg:grid-cols-3 gap-6 mb-10">
                        <article id="in-game-overlay-feature" className="relative scroll-mt-24 overflow-hidden rounded-2xl border border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/30 p-7 md:p-8 text-center shadow-md">
                            <span className="inline-flex rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">Core feature</span>
                            <div className="w-14 h-14 mx-auto mt-5 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md">
                                <Icon path={ICONS.desktop} className="w-7 h-7" />
                            </div>
                            <h3 className="mt-5 text-2xl font-bold">In-Game Overlay</h3>
                            <p className="mt-3 leading-relaxed text-gray-700 dark:text-gray-200">
                                Open the full PlanetCreations hub from a movable icon without leaving your game. Follow notifications, open Creations and manage active collaborations while you continue building.
                            </p>
                            <div className="mt-5 flex flex-wrap justify-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-200">
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Full hub in game</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Game-aware</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Collaboration controls</span>
                            </div>
                        </article>
                        <article id="savegame-backups" className="relative scroll-mt-24 overflow-hidden rounded-2xl border border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/30 p-7 md:p-8 text-center shadow-md">
                            <span className="inline-flex rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">Core feature</span>
                            <div className="w-14 h-14 mx-auto mt-5 rounded-full bg-green-600 text-white flex items-center justify-center shadow-md">
                                <Icon path={ICONS.database} className="w-7 h-7" />
                            </div>
                            <h3 className="mt-5 text-2xl font-bold">Immediate savegame backups</h3>
                            <p className="mt-3 leading-relaxed text-gray-700 dark:text-gray-200">
                                The client finds supported savegames in your configured folders, so you can protect one file or an entire selection immediately and optionally create matching separate Custom Media packages.
                            </p>
                            <div className="mt-5 flex flex-wrap justify-center gap-2 text-sm font-semibold text-green-800 dark:text-green-200">
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Individual or batch</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Version history</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Safe restore</span>
                            </div>
                        </article>
                        <article className="relative overflow-hidden rounded-2xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-fuchsia-50 dark:from-purple-950/50 dark:to-fuchsia-950/30 p-7 md:p-8 text-center shadow-md">
                            <span className="inline-flex rounded-full bg-purple-600 px-3 py-1 text-xs font-bold text-white">Core feature</span>
                            <div className="w-14 h-14 mx-auto mt-5 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-md">
                                <Icon path={ICONS.search} className="w-7 h-7" />
                            </div>
                            <h3 className="mt-5 text-2xl font-bold">Savefile intelligence</h3>
                            <p className="mt-3 leading-relaxed text-gray-700 dark:text-gray-200">
                                Analyze supported parks and blueprints for previews, required DLC, ride categories, stored test values, object counts and referenced Custom Media.
                            </p>
                            <div className="mt-5 flex flex-wrap justify-center gap-2 text-sm font-semibold text-purple-800 dark:text-purple-200">
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Sequential scanning</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Persistent cache</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Verified online stats</span>
                            </div>
                        </article>
                    </div>
                    <div className="text-center mb-8">
                        <h3 className="text-2xl font-bold">More tools around your Creations</h3>
                    </div>
                    <div className="client-feature-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FeatureCard icon={ICONS.search} accent="blue" title="Automatic File Discovery" description="Browse parks, blueprints, autosaves and Workshop files immediately while their metadata is analyzed one file at a time and cached until the save changes." />
                        <FeatureCard icon={ICONS.shieldCheck} accent="purple" badge="Verified" title="Signed Packages" description="When signed in, backups can receive a digital signature. The client verifies package integrity before restoring or installing them." />
                        <FeatureCard id="custom-media-automation" icon={ICONS.image} accent="amber" badge="New" title="Automatic Custom Media" description="Every creation backup creates or updates its media document, even when no media was selected manually, and offers a separate matching media package." />
                        <FeatureCard icon={ICONS.download} accent="cyan" title="Direct Install" description="Install supported creations from their detail page. You can send an install to a connected PC even when you are browsing the website on another device." />
                        <FeatureCard icon={ICONS.refresh} accent="rose" title="Background Queue" description="Queued installs are picked up by the desktop client. The system tray keeps notifications and background tasks available after the main window is closed." />
                        <FeatureCard id="in-game-collaboration" icon={ICONS.users} accent="green" title="In-game collaboration" description="See build locks, install the newest shared version, open the build workspace and log your build turn directly through the In-Game Overlay." />
                    </div>
                </section>

                <section id="savefile-intelligence" className="scroll-mt-8">
                    <div className="text-center mb-10">
                        <span className="inline-flex rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">New in 1.0.31</span>
                        <h2 className="mt-4 text-3xl md:text-4xl font-bold">From savefile to useful Creation data</h2>
                        <p className="mt-3 text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
                            PlanetCreations reads conservative, player-relevant values from supported Planet Coaster 2 files and keeps server-verified results separate from creator-controlled presentation.
                        </p>
                    </div>
                    <div className="client-feature-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FeatureCard icon={ICONS.image} accent="cyan" title="In-game previews" description="Use the image stored in a park or blueprint throughout the offline file picker, metadata overview and save-first Creation workflow." />
                        <FeatureCard icon={ICONS.checklist} accent="green" title="Required DLC" description="Detected DLC requirements are attached as verified metadata and can update the Creation's DLC selection when a savefile is added or replaced." />
                        <FeatureCard icon={ICONS.database} accent="blue" title="Park overview" description="Show ride totals by category together with available buildings, pools and a combined scenery-piece count in compact cards." />
                        <FeatureCard icon={ICONS.squares2x2} accent="rose" title="Per-attraction details" description="List named rides by type and display trusted stored test values when the save contains them. Unknown or calculated EFN values remain hidden unless entered by the creator." />
                        <FeatureCard icon={ICONS.edit} accent="purple" title="Save-first Creation wizard" description="Attach a local save first and prefill useful wizard fields. Creator choices stay creator-controlled; only verified DLC requirements may be refreshed by the server." />
                        <FeatureCard icon={ICONS.users} accent="amber" title="Attractions & Areas" description="Rename or hide detected rides, add custom rides, restaurants, shops and shows, and organize them into color-coded park areas for the public Ride List." />
                    </div>
                </section>

                <section className="grid lg:grid-cols-2 gap-8 items-stretch">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 md:p-8">
                        <h2 className="text-2xl font-bold text-center mb-8">Direct Install workflow</h2>
                        <WorkflowStep number="1" title="Connect the desktop client" description="Sign in with your PlanetCreations account. Each registered Windows PC can be identified by its display name." />
                        <WorkflowStep number="2" title="Choose a creation" description="Open a creation with an attached, compatible savegame package and select Direct Install." />
                        <WorkflowStep number="3" title="Select your PC" description="When browsing outside the desktop app, choose which connected client should receive the install." />
                        <WorkflowStep number="4" title="Download, verify and install" description="The client securely downloads the package, verifies it and places the creation in the correct configured game folder." last />
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 md:p-8">
                        <h2 className="text-2xl font-bold text-center mb-8">Immediate backup workflow</h2>
                        <WorkflowStep number="1" title="Select your game folder" description="Configure the location once. Files appear immediately, then metadata is analyzed sequentially and retained until a file changes or you refresh all stats." />
                        <WorkflowStep number="2" title="Back up now" description="Select one savegame or several files. Each backup also creates its Custom Media document and offers a separate matching media package." />
                        <WorkflowStep number="3" title="Keep or share the packages" description="Creation and optional media backups use the .PlanetCreations format and can be archived, restored or attached to an online Creation." />
                        <WorkflowStep number="4" title="Restore safely" description="Open the backup in the client or use the Restore tab. Signed packages are verified before any game file is replaced." last />
                    </div>
                </section>

                <section className="rounded-2xl bg-gray-800 dark:bg-gray-950 text-white p-7 md:p-10 shadow-lg">
                    <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-center">
                        <div>
                            <div className="flex items-center justify-center lg:justify-start gap-3 mb-3">
                                <div className="w-11 h-11 rounded-full bg-green-500/20 text-green-300 flex items-center justify-center">
                                    <Icon path={ICONS.desktop} className="w-6 h-6" />
                                </div>
                                <h2 className="text-2xl font-bold">Local-first, online when useful</h2>
                            </div>
                            <p className="text-center lg:text-left text-gray-300 leading-relaxed max-w-3xl">
                                Scanning and caching savefile metadata, creating local backups, managing media and restoring your own packages work locally. An internet connection is only required for account features such as server verification, signing packages, attaching backups to online Creations, Direct Install and update checks.
                            </p>
                        </div>
                        <div className="flex flex-wrap lg:flex-col justify-center gap-2 text-sm font-semibold">
                            <span className="rounded-full bg-white/10 px-4 py-2">Local file control</span>
                            <span className="rounded-full bg-white/10 px-4 py-2">Optional cloud features</span>
                            <span className="rounded-full bg-white/10 px-4 py-2">Integrity checks</span>
                        </div>
                    </div>
                </section>

                <section className="relative overflow-hidden rounded-2xl border border-red-200 dark:border-red-900 bg-gradient-to-br from-red-50 via-white to-purple-50 dark:from-red-950/30 dark:via-gray-900 dark:to-purple-950/30 p-7 md:p-10 shadow-lg">
                    <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-red-400/10 blur-3xl" aria-hidden="true" />
                    <div className="relative text-center mb-10">
                        <div className="inline-flex items-center gap-2 rounded-full bg-red-100 dark:bg-red-900/40 px-4 py-2 text-sm font-bold text-red-700 dark:text-red-300 mb-4">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            Optional streaming tools
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold">Stream Management when you want it</h2>
                        <p className="mt-3 text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
                            Streaming is an optional extension of the client, not the purpose of the In-Game Overlay. Connect OBS or Streamlabs to link a live broadcast to the Creation you are building and manage it from a dedicated window.
                        </p>
                    </div>
                    <div className="relative grid sm:grid-cols-2 gap-6">
                        <FeatureCard
                            icon={ICONS.wifi}
                            accent="purple"
                            badge="OBS & Streamlabs"
                            title="Automatic stream detection"
                            description="Connect OBS Studio through its WebSocket server or Streamlabs Desktop through its local and Remote Control APIs. The settings page guides you to every required port, IP address, password or API token."
                        />
                        <FeatureCard
                            icon={ICONS.search}
                            accent="cyan"
                            badge="Picker first"
                            title="Creation picker"
                            description="Choose your own Creation when a stream starts. Experimental Auto Mode is opt-in only and can suggest a likely match from your title, Creation names, types, categories and tags."
                        />
                        <FeatureCard
                            icon={ICONS.video}
                            accent="rose"
                            badge="Twitch + YouTube"
                            title="One dual-platform session"
                            description="Show Twitch and YouTube together on the active Creation. When OBS or Streamlabs ends the broadcast, PlanetCreations closes the complete dual-stream session."
                        />
                        <FeatureCard
                            icon={ICONS.bell}
                            accent="amber"
                            badge="Synced"
                            title="Dedicated Stream Management"
                            description="Use the always-on-top picker, live status, stream notification history and mute settings on the streaming device. Linked clients stay synchronized for remote-streaming setups."
                        />
                    </div>
                    <div className="relative mt-8 rounded-xl border border-red-200 dark:border-red-900 bg-white/80 dark:bg-red-950/20 p-6">
                        <h3 className="text-xl font-bold text-center text-gray-900 dark:text-gray-100">How the live workflow works</h3>
                        <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                            {[
                                ['1', 'Connect', 'Select OBS or Streamlabs in Desktop & Streaming settings.'],
                                ['2', 'Start streaming', 'The client detects the stream start and opens Stream Management.'],
                                ['3', 'Choose a Creation', 'Use the standard picker or opt in to Experimental Auto Mode.'],
                                ['4', 'Stop normally', 'The LIVE state and all linked outputs end with the stream.'],
                            ].map(([number, title, description]) => (
                                <div key={number} className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow-sm">
                                    <span className="w-8 h-8 mx-auto rounded-full bg-red-600 text-white flex items-center justify-center font-bold">{number}</span>
                                    <h4 className="mt-3 font-bold text-gray-900 dark:text-gray-100">{title}</h4>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section>
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-bold">Designed for everyday use</h2>
                        <p className="mt-3 text-gray-600 dark:text-gray-300">Small conveniences that keep the client ready without getting in your way.</p>
                    </div>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <FeatureCard icon={ICONS.desktop} accent="cyan" badge="Updated" title="Game-aware In-Game Overlay" description="On Windows, the In-Game Overlay appears automatically with Planet Coaster 2. On macOS and Linux it can be shown manually. Open PlanetCreations from the movable icon, drag it to reposition, and hold while scrolling to resize." />
                        <FeatureCard icon={ICONS.cog} title="Start with Windows" description="Enable automatic startup in Settings so queued installs and background notifications are available after signing in to Windows." />
                        <FeatureCard icon={ICONS.bell} accent="purple" title="System Tray" description="Closing the window can keep the client running in the tray. Open it again or quit it completely from the tray menu." />
                        <FeatureCard icon={ICONS.refresh} accent="green" title="Automatic Updates" description="The client checks published releases and can download and install updates, keeping desktop features compatible with the website." />
                    </div>
                </section>

                <section className="grid md:grid-cols-2 gap-6">
                    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6">
                        <div className="flex gap-4">
                            <Icon path={ICONS.info} className="w-7 h-7 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div>
                                <h2 className="font-bold text-lg text-amber-900 dark:text-amber-100">Automatic media detection is conservative</h2>
                                <p className="mt-2 text-sm leading-relaxed text-amber-800 dark:text-amber-200">The client records safely detected Custom Media references automatically and reports missing files. Review the media document before sharing when a creation uses unusual or indirectly referenced media.</p>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-6">
                        <div className="flex gap-4">
                            <Icon path={ICONS.shieldCheck} className="w-7 h-7 shrink-0 text-blue-600 dark:text-blue-400" />
                            <div>
                                <h2 className="font-bold text-lg text-blue-900 dark:text-blue-100">Only install files you trust</h2>
                                <p className="mt-2 text-sm leading-relaxed text-blue-800 dark:text-blue-200">A valid signature confirms integrity and origin, while unsigned packages display a warning. Review the source before restoring any unsigned backup.</p>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="text-center bg-white dark:bg-gray-800 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700 p-8 md:p-12">
                    <div className="w-16 h-16 mx-auto rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center mb-5">
                        <Icon path={ICONS.download} className="w-8 h-8" />
                    </div>
                    <h2 className="text-3xl font-bold">Ready to manage your creations?</h2>
                    <p className="mt-3 mb-7 text-gray-600 dark:text-gray-300 max-w-xl mx-auto">Jump to the downloads above and get the correct installer for your operating system.</p>
                    <button type="button" onClick={scrollToDownloads} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-6 py-3 font-bold text-white transition-colors">
                        <Icon path={ICONS.download} className="w-5 h-5" />
                        Choose your download
                    </button>
                </section>
            </div>
        </main>
    );
};

export default ClientInfoPage;
