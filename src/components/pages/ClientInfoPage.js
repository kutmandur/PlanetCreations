import React from 'react';
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

const ClientInfoPage = () => {
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
                    <h1 className="client-hero-enter client-hero-title text-4xl md:text-6xl font-extrabold tracking-tight">Your creations, <span className="client-gradient-text">managed locally.</span></h1>
                    <p className="client-hero-enter client-hero-copy max-w-3xl mx-auto mt-6 text-lg md:text-xl leading-relaxed text-gray-200">
                        Find your game files, create secure backups, manage custom media and install shared creations directly from PlanetCreations.net.
                    </p>
                    <div className="client-hero-enter client-hero-actions mt-9 flex flex-col sm:flex-row justify-center gap-3">
                        <a href="https://github.com/kutmandur/PlanetCreations/releases/latest" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-6 py-3 font-bold text-white transition-colors shadow-lg">
                            <Icon path={ICONS.download} className="w-5 h-5" />
                            Download Latest Release
                        </a>
                        <a href="https://github.com/kutmandur/PlanetCreations" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 px-6 py-3 font-bold text-white transition-colors">
                            <Icon path={ICONS.code} className="w-5 h-5" />
                            View Source Code
                        </a>
                    </div>
                    <p className="mt-4 text-sm text-gray-400">Available for Windows 10 and Windows 11</p>
                    <div className="client-app-preview relative mt-12 max-w-3xl mx-auto rounded-xl border border-white/20 bg-gray-950/80 p-2 shadow-2xl backdrop-blur-md text-left" aria-hidden="true">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                            <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                            <span className="ml-3 text-xs text-gray-400">PlanetCreations Client</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 p-3 text-xs">
                            {['Backup', 'Restore', 'Workshop', 'Media Manager'].map((tab, index) => (
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
                        <span className="client-floating-badge client-floating-badge-one"><Icon path={ICONS.shieldCheck} className="w-4 h-4" /> Verified backup</span>
                        <span className="client-floating-badge client-floating-badge-two"><Icon path={ICONS.download} className="w-4 h-4" /> Direct Install</span>
                    </div>
                </div>
            </section>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 md:py-20 space-y-20">
                <section>
                    <div className="text-center mb-10">
                        <h2 className="text-3xl md:text-4xl font-bold">Everything in one client</h2>
                        <p className="mt-3 text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                            The desktop client connects the PlanetCreations website with the files stored by your games.
                        </p>
                    </div>
                    <div className="client-feature-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FeatureCard icon={ICONS.search} accent="blue" title="Automatic File Discovery" description="Scan configured game folders and browse parks, blueprints, autosaves, Workshop files and their available backups in one place." />
                        <FeatureCard icon={ICONS.database} accent="green" title="Backup & Restore" description="Create individual or batch backups, add notes, keep multiple versions and restore a selected version to its game folder when needed." />
                        <FeatureCard icon={ICONS.shieldCheck} accent="purple" badge="Verified" title="Signed Packages" description="When signed in, backups can receive a digital signature. The client verifies package integrity before restoring or installing them." />
                        <FeatureCard icon={ICONS.image} accent="amber" title="Custom Media Manager" description="Collect the images, videos and audio used by a creation and preserve them as a dedicated media package for later restoration or sharing." />
                        <FeatureCard icon={ICONS.download} accent="cyan" badge="New" title="Direct Install" description="Install supported creations from their detail page. You can send an install to a connected PC even when you are browsing the website on another device." />
                        <FeatureCard icon={ICONS.refresh} accent="rose" badge="New" title="Background Queue" description="Queued installs are picked up by the desktop client. The system tray keeps notifications and background tasks available after the main window is closed." />
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
                        <h2 className="text-2xl font-bold text-center mb-8">Local backup workflow</h2>
                        <WorkflowStep number="1" title="Select your game folder" description="Configure the location once. The client scans supported files and organizes them by game and file type." />
                        <WorkflowStep number="2" title="Create a backup" description="Select one or multiple creations, add an optional note and choose whether the package should be digitally signed." />
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

                <section>
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-bold">Designed for everyday use</h2>
                        <p className="mt-3 text-gray-600 dark:text-gray-300">Small conveniences that keep the client ready without getting in your way.</p>
                    </div>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <FeatureCard icon={ICONS.desktop} accent="cyan" badge="New" title="In-game Overlay" description="When Planet Coaster 2 is running, a movable PlanetCreations logo provides access to the full website without leaving the game. Hold and scroll to resize it." />
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
                    <p className="mt-3 mb-7 text-gray-600 dark:text-gray-300 max-w-xl mx-auto">Download the latest open-source PlanetCreations Client release from GitHub.</p>
                    <a href="https://github.com/kutmandur/PlanetCreations/releases/latest" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-6 py-3 font-bold text-white transition-colors">
                        <Icon path={ICONS.download} className="w-5 h-5" />
                        Download for Windows
                    </a>
                </section>
            </div>
        </main>
    );
};

export default ClientInfoPage;
