import React, { useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const FeatureCard = ({ icon, title, description, accent = 'blue', badge }) => {
    const accents = {
        blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
        green: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300',
        purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300',
        amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
        cyan: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-300',
        rose: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'
    };

    return (
        <article className="client-feature-card relative overflow-hidden bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 text-center transition-all duration-300 hover:-translate-y-2 hover:shadow-xl">
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

const DownloadCard = ({ title, subtitle, detail, icon, accent, href, loading, recommended, note }) => (
    <article className={`relative rounded-xl border-2 bg-white dark:bg-gray-800 p-6 text-center shadow-md transition-all hover:-translate-y-1 hover:shadow-xl ${recommended ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'}`}>
        {recommended && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                Recommended for this device
            </span>
        )}
        <div className={`w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center ${accent}`}>
            <Icon path={icon} className="w-7 h-7" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="mt-1 font-semibold text-gray-700 dark:text-gray-200">{subtitle}</p>
        <p className="mt-2 min-h-[2.5rem] text-sm text-gray-500 dark:text-gray-400">{detail}</p>
        {href ? (
            <a href={href} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-5 py-3 font-bold text-white transition-colors">
                <Icon path={ICONS.download} className="w-5 h-5" />
                Download
            </a>
        ) : (
            <span className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700 px-5 py-3 font-bold text-gray-500 dark:text-gray-300">
                {loading ? 'Finding latest download…' : 'Download unavailable'}
            </span>
        )}
        {note && <p className="mt-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{note}</p>}
    </article>
);

const ClientInfoPage = () => {
    const [downloads, setDownloads] = useState({
        loading: true,
        version: null,
        windows: null,
        macArm64: null,
        macIntel: null,
        linux: null,
    });

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

    const platform = typeof navigator === 'undefined' ? '' : `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
    const recommendedPlatform = platform.includes('mac') ? 'mac' : platform.includes('win') ? 'windows' : platform.includes('linux') ? 'linux' : null;

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
                        Open the PlanetCreations hub without leaving the game, keep your collaborations and notifications close, and create an immediate backup of a detected savegame whenever you need one.
                    </p>
                    <div className="client-hero-enter client-hero-actions mt-9 flex flex-col sm:flex-row justify-center gap-3">
                        <a href="#client-downloads" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-6 py-3 font-bold text-white transition-colors shadow-lg">
                            <Icon path={ICONS.download} className="w-5 h-5" />
                            Download Latest Release
                        </a>
                        <a href="https://github.com/kutmandur/PlanetCreations" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 px-6 py-3 font-bold text-white transition-colors">
                            <Icon path={ICONS.code} className="w-5 h-5" />
                            View Source Code
                        </a>
                    </div>
                    <p className="mt-4 text-sm text-gray-400">Available for Windows, Apple Silicon and Intel Macs, and Linux</p>
                    <div className="client-app-preview relative mt-12 max-w-3xl mx-auto rounded-xl border border-white/20 bg-gray-950/80 p-2 shadow-2xl backdrop-blur-md text-left" aria-hidden="true">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                            <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                            <span className="ml-3 text-xs text-gray-400">PlanetCreations Client</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 p-3 text-xs">
                            {['PlanetCreations', 'Savegame Backup', 'Collaborations', 'Notifications'].map((tab, index) => (
                                <div key={tab} className={`rounded-md px-2 py-2 text-center ${index === 0 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>{tab}</div>
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
                        <span className="client-floating-badge client-floating-badge-one"><Icon path={ICONS.desktop} className="w-4 h-4" /> In-Game Overlay</span>
                        <span className="client-floating-badge client-floating-badge-two"><Icon path={ICONS.shieldCheck} className="w-4 h-4" /> Savegame backed up</span>
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
                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
                        <DownloadCard
                            title="Windows"
                            subtitle="Windows 10 & 11"
                            detail="Standard setup installer (.exe) with automatic updates."
                            icon={ICONS.desktop}
                            accent="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
                            href={downloads.windows}
                            loading={downloads.loading}
                            recommended={recommendedPlatform === 'windows'}
                            note="Currently unsigned: Windows SmartScreen may show a warning before the first installation."
                        />
                        <DownloadCard
                            title="macOS"
                            subtitle="Apple Silicon"
                            detail="For Macs with an M1, M2, M3, M4 or newer Apple chip (.dmg)."
                            icon={ICONS.desktop}
                            accent="bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                            href={downloads.macArm64}
                            loading={downloads.loading}
                            note="Currently unsigned: macOS may require removing the quarantine attribute before first launch."
                        />
                        <DownloadCard
                            title="macOS"
                            subtitle="Intel (x64)"
                            detail="For Intel-based 64-bit Macs (.dmg)."
                            icon={ICONS.desktop}
                            accent="bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                            href={downloads.macIntel}
                            loading={downloads.loading}
                            note="Currently unsigned: macOS may require removing the quarantine attribute before first launch."
                        />
                        <DownloadCard
                            title="Linux"
                            subtitle="64-bit Linux"
                            detail="Portable AppImage — download, make executable and launch."
                            icon={ICONS.code}
                            accent="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            href={downloads.linux}
                            loading={downloads.loading}
                            recommended={recommendedPlatform === 'linux'}
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
                            The client brings the PlanetCreations experience into your game and keeps your local savegames protected. These are its two central jobs.
                        </p>
                    </div>
                    <div className="grid lg:grid-cols-2 gap-6 mb-10">
                        <article className="relative overflow-hidden rounded-2xl border border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/30 p-7 md:p-8 text-center shadow-md">
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
                        <article className="relative overflow-hidden rounded-2xl border border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/30 p-7 md:p-8 text-center shadow-md">
                            <span className="inline-flex rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">Core feature</span>
                            <div className="w-14 h-14 mx-auto mt-5 rounded-full bg-green-600 text-white flex items-center justify-center shadow-md">
                                <Icon path={ICONS.database} className="w-7 h-7" />
                            </div>
                            <h3 className="mt-5 text-2xl font-bold">Immediate savegame backups</h3>
                            <p className="mt-3 leading-relaxed text-gray-700 dark:text-gray-200">
                                The client finds supported savegames in your configured folders, so you can protect one save or an entire selection immediately. Keep multiple versions and restore the one you need later.
                            </p>
                            <div className="mt-5 flex flex-wrap justify-center gap-2 text-sm font-semibold text-green-800 dark:text-green-200">
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Individual or batch</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Version history</span>
                                <span className="rounded-full bg-white/70 dark:bg-white/10 px-3 py-1.5">Safe restore</span>
                            </div>
                        </article>
                    </div>
                    <div className="text-center mb-8">
                        <h3 className="text-2xl font-bold">More tools around your Creations</h3>
                    </div>
                    <div className="client-feature-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FeatureCard icon={ICONS.search} accent="blue" title="Automatic File Discovery" description="Scan configured game folders and browse parks, blueprints, autosaves, Workshop files and their available backups in one place." />
                        <FeatureCard icon={ICONS.shieldCheck} accent="purple" badge="Verified" title="Signed Packages" description="When signed in, backups can receive a digital signature. The client verifies package integrity before restoring or installing them." />
                        <FeatureCard icon={ICONS.image} accent="amber" title="Custom Media Manager" description="Collect the images, videos and audio used by a creation and preserve them as a dedicated media package for later restoration or sharing." />
                        <FeatureCard icon={ICONS.download} accent="cyan" badge="New" title="Direct Install" description="Install supported creations from their detail page. You can send an install to a connected PC even when you are browsing the website on another device." />
                        <FeatureCard icon={ICONS.refresh} accent="rose" badge="New" title="Background Queue" description="Queued installs are picked up by the desktop client. The system tray keeps notifications and background tasks available after the main window is closed." />
                        <FeatureCard icon={ICONS.users} accent="green" badge="New" title="In-game collaboration" description="See build locks, install the newest shared version, open the build workspace and log your build turn directly through the In-Game Overlay." />
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
                        <WorkflowStep number="1" title="Select your game folder" description="Configure the location once. The client scans supported files and organizes them by game and file type." />
                        <WorkflowStep number="2" title="Back up now" description="Select one savegame or several files, add an optional note and create the backup immediately. When signed in, you can also request a digital signature." />
                        <WorkflowStep number="3" title="Keep or share the package" description="Backups use the .PlanetCreations format and can be archived privately, attached to an online creation or shared directly." />
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
                                Scanning files, creating local backups, managing media and restoring your own packages work locally. An internet connection is only required for account features such as signing packages, attaching backups to online creations, Direct Install from the website and checking for updates.
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
                                <h2 className="font-bold text-lg text-amber-900 dark:text-amber-100">Custom media is selected manually</h2>
                                <p className="mt-2 text-sm leading-relaxed text-amber-800 dark:text-amber-200">The client cannot reliably know which media belongs to a creation. Use the Media Manager to select the relevant files before creating a media package.</p>
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
                    <a href="#client-downloads" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-6 py-3 font-bold text-white transition-colors">
                        <Icon path={ICONS.download} className="w-5 h-5" />
                        Choose your download
                    </a>
                </section>
            </div>
        </main>
    );
};

export default ClientInfoPage;
