import React, { useEffect, useRef, useState } from 'react';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
    containsBlacklistedWord,
    getGameColor,
    getTextColorForBackground,
    ICONS,
    isSafeHttpUrl,
    SOCIAL_PLATFORMS,
} from '../../utils/helpers';
import { getDefaultGameId, getGame } from '../../utils/gamesRegistry';
import { getProfileAppearance, isValidProfileColor } from '../../utils/profileAppearance';
import { getPersonalizationConsent } from '../../utils/interestTracker';
import {
    openDiscordLink,
    unlinkDiscordAccount,
} from '../../firebase/discord';
import useGames from '../../hooks/useGames';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';
import InfoBox from '../ui/InfoBox';
import ProfileImage from '../ui/ProfileImage';
import PersonalizationSettings from '../ui/PersonalizationSettings';
import NotificationSettings from '../ui/NotificationSettings';
import logo from '../../assets/logo.png';

const inputClass = [
    'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-gray-900',
    'placeholder:text-gray-400 transition focus:border-[--game-color]',
    'focus:outline-none focus:ring-2 focus:ring-[--game-color]/25',
    'dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
].join(' ');

const STEPS = [
    { id: 'profile', label: 'Profile', blurb: 'Bio, country & favorite game' },
    { id: 'appearance', label: 'Appearance', blurb: 'Color, picture & banners' },
    { id: 'feed', label: 'Feed', blurb: 'Personalized recommendations' },
    { id: 'discord', label: 'Discord', blurb: 'Sync ranks & communities' },
    { id: 'notifications', label: 'Notifications', blurb: 'Choose what you hear about' },
];

const DISCORD_ICON = SOCIAL_PLATFORMS.find((p) => p.id === 'discord');
const Field = ({ label, hint, htmlFor, children }) => (
    <div>
        <label className="mb-1.5 block text-center font-semibold text-gray-700 dark:text-gray-200" htmlFor={htmlFor}>
            {label}
        </label>
        {hint && <p className="mb-2 text-center text-sm text-gray-500 dark:text-gray-400">{hint}</p>}
        {children}
    </div>
);

// Live-Vorschau, die das echte Profil-Layout (ProfilePage-Header) spiegelt.
const ProfilePreview = ({ appearance, username, country, favoriteGame, bio, avatarUrl, bannerUrl, followers, following }) => {
    const [bannerFailed, setBannerFailed] = useState(false);
    useEffect(() => setBannerFailed(false), [bannerUrl]);
    const hasBio = Boolean(bio?.trim());
    const hasBanner = Boolean(bannerUrl && !bannerFailed);
    const favColor = getGameColor(favoriteGame);
    return (
        <div
            className={`relative min-h-[22rem] overflow-hidden rounded-2xl shadow-lg ${hasBanner ? '' : 'bg-white dark:bg-gray-800'}`}
            style={hasBanner ? { background: `linear-gradient(135deg, ${appearance.hex}, ${appearance.hoverHex})` } : undefined}
        >
            {hasBanner && (
                <img
                    src={bannerUrl}
                    alt=""
                    onError={() => setBannerFailed(true)}
                    className="absolute inset-0 h-full w-full object-cover"
                />
            )}
            {hasBanner && <div className="absolute inset-0 hidden bg-gradient-to-r from-black/75 via-black/45 to-black/65 dark:block" />}

            <div className="relative flex min-h-[22rem] items-start gap-3 p-5 sm:gap-6 sm:p-8">
                <div className="hidden w-10 flex-shrink-0 sm:block" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <div className={hasBio ? 'grid items-center gap-6 lg:grid-cols-3' : 'flex items-center justify-center'}>
                        <div
                            className={`relative mx-auto mt-10 flex w-full max-w-xs flex-col items-center rounded-[2rem] border-2 px-5 pb-6 pt-20 text-center shadow-xl backdrop-blur-md sm:mt-12 lg:mx-0 ${hasBio ? 'lg:col-start-1' : ''} ${hasBanner ? 'bg-black/35' : 'bg-gray-50/95 dark:bg-gray-900/60'}`}
                            style={{ borderColor: appearance.hex }}
                        >
                            <ProfileImage
                                src={avatarUrl}
                                alt="Profile"
                                className="absolute -top-14 left-1/2 h-28 w-28 -translate-x-1/2 rounded-full border-4 bg-white object-cover shadow-xl dark:bg-gray-800 sm:-top-16 sm:h-32 sm:w-32"
                                style={{ borderColor: appearance.hex }}
                            />
                            <h2 className={`text-3xl font-bold ${hasBanner ? 'text-white drop-shadow-sm' : 'game-text'}`}>
                                {username}
                            </h2>
                            {country?.trim() && (
                                <p className={`mt-1 ${hasBanner ? 'text-white/75' : 'text-gray-500 dark:text-gray-400'}`}>{country}</p>
                            )}
                            {favoriteGame && (
                                <p
                                    className="mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium capitalize shadow-sm"
                                    style={{ backgroundColor: favColor.hex, color: getTextColorForBackground(favColor.hex) }}
                                >
                                    {getGame(favoriteGame)?.name || favoriteGame.replace(/-/g, ' ')}
                                </p>
                            )}
                            <div className={`mt-4 flex items-center justify-center gap-6 text-sm ${hasBanner ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                                <span>
                                    <span className="font-bold">{followers}</span>{' '}
                                    <span className={hasBanner ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}>Followers</span>
                                </span>
                                <span>
                                    <span className="font-bold">{following}</span>{' '}
                                    <span className={hasBanner ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}>Following</span>
                                </span>
                            </div>
                            <div className="mt-6">
                                <span className={`rounded-xl px-4 py-2 text-sm font-bold ${hasBanner ? 'border border-white/20 bg-white/15 text-white backdrop-blur-sm' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                                    Edit Profile
                                </span>
                            </div>
                        </div>

                        {hasBio && (
                            <div
                                className={`w-full max-w-sm place-self-center rounded-2xl border-2 p-5 text-left shadow-lg backdrop-blur-md sm:p-6 lg:col-span-2 lg:col-start-2 ${hasBanner ? 'bg-black/35 text-white' : 'bg-gray-50/90 text-gray-700 dark:bg-gray-900/60 dark:text-gray-200'}`}
                                style={{ borderColor: appearance.hex }}
                            >
                                <p className={`mb-2 text-xs font-bold uppercase tracking-[0.18em] ${hasBanner ? 'text-white/55' : 'text-gray-400 dark:text-gray-500'}`}>
                                    About
                                </p>
                                <p className={`whitespace-pre-wrap leading-relaxed ${hasBanner ? 'text-white/90' : ''}`}>{bio}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Erstlogin-Onboarding im Stil des Creation-Wizards. Startet mit einer reinen
// Willkommensseite, führt dann durch Profil, Appearance (Farbe/Bilder mit
// Live-Preview), Feed, Discord und Notifications. Ersetzt die alten Popovers.
const ProfileSetupWizard = ({
    user,
    userProfile,
    setModalMessage,
    setConfirmation,
    blacklist = [],
    leaveSignal = 0,
    onConsent,
    onComplete,
}) => {
    const games = useGames();

    const [started, setStarted] = useState(false);
    const [activeStep, setActiveStep] = useState('profile');
    const [mobileOpen, setMobileOpen] = useState(false);
    const [completedSteps, setCompletedSteps] = useState([]);
    const [saving, setSaving] = useState(false);
    const [showSkipInfo, setShowSkipInfo] = useState(false);
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

    // Wie der Game-Selector auf der Startseite: animierter Glider unter dem
    // aktiven Spiel-Pill.
    const gameTabRefs = useRef([]);
    const [gameGliderStyle, setGameGliderStyle] = useState({});

    const [form, setForm] = useState(() => ({
        profilePictureUrl: userProfile?.profilePictureUrl || '',
        profileBannerUrl: userProfile?.profileBannerUrl || '',
        profileMobileBannerUrl: userProfile?.profileMobileBannerUrl || '',
        bio: userProfile?.bio || '',
        country: userProfile?.country || '',
        favoriteGame: getGame(userProfile?.favoriteGame) ? userProfile.favoriteGame : getDefaultGameId(),
        profileColor: isValidProfileColor(userProfile?.profileColor) ? userProfile.profileColor : '',
    }));

    const [linkedDiscord, setLinkedDiscord] = useState(() =>
        userProfile?.discordId && userProfile?.discordUsername
            ? { id: userProfile.discordId, username: userProfile.discordUsername }
            : null
    );

    // Der Header-Guard in App.js signalisiert per Zähler, dass der Nutzer den
    // Wizard verlassen möchte — dann erst nachfragen.
    const isInitialLeaveSignal = useRef(true);
    useEffect(() => {
        if (isInitialLeaveSignal.current) {
            isInitialLeaveSignal.current = false;
            return;
        }
        setShowLeaveConfirm(true);
    }, [leaveSignal]);

    // Live-Status der Discord-Verknüpfung (OAuth läuft in neuem Tab).
    useEffect(() => {
        if (!user) return undefined;
        const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
            const data = snap.data();
            if (data?.discordId && data?.discordUsername) {
                setLinkedDiscord({ id: data.discordId, username: data.discordUsername });
            } else {
                setLinkedDiscord(null);
            }
        });
        return unsubscribe;
    }, [user]);

    // Glider unter dem gewählten Favorite-Game positionieren (nach Render/Layout).
    useEffect(() => {
        const timer = setTimeout(() => {
            const index = games.findIndex((game) => game.id === form.favoriteGame);
            const node = gameTabRefs.current[index];
            if (node) setGameGliderStyle({ left: node.offsetLeft, width: node.offsetWidth });
        }, 50);
        return () => clearTimeout(timer);
    }, [games, form.favoriteGame, activeStep, started, mobileOpen]);

    const username = userProfile?.username || 'Creator';
    const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

    const hasCustomColor = isValidProfileColor(form.profileColor);
    const gameHex = getGameColor(form.favoriteGame || getDefaultGameId()).hex;
    const appearance = getProfileAppearance(hasCustomColor ? form.profileColor : gameHex);
    const accent = appearance.hex;

    const activeStepIndex = STEPS.findIndex((s) => s.id === activeStep);
    const isLastStep = activeStepIndex === STEPS.length - 1;

    const scrollToTop = () => {
        window.requestAnimationFrame(() => {
            document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
        });
    };

    const goToStep = (stepId) => {
        setActiveStep(stepId);
        setMobileOpen(true);
        scrollToTop();
    };

    const validateStep = (stepId) => {
        if (stepId === 'profile' && containsBlacklistedWord(form.bio, blacklist)) {
            return 'Your bio contains a forbidden word.';
        }
        if (stepId === 'appearance') {
            if (form.profilePictureUrl.trim() && !isSafeHttpUrl(form.profilePictureUrl)) {
                return 'The profile picture must be a valid http(s) URL.';
            }
            if (form.profileBannerUrl.trim() && !isSafeHttpUrl(form.profileBannerUrl)) {
                return 'The profile banner must be a valid http(s) URL.';
            }
            if (form.profileMobileBannerUrl.trim() && !isSafeHttpUrl(form.profileMobileBannerUrl)) {
                return 'The mobile profile banner must be a valid http(s) URL.';
            }
            if (form.profileColor && !isValidProfileColor(form.profileColor)) {
                return 'Please choose a valid profile color.';
            }
        }
        return null;
    };

    const buildPayload = () => ({
        profilePictureUrl: form.profilePictureUrl.trim(),
        profileBannerUrl: form.profileBannerUrl.trim(),
        profileMobileBannerUrl: form.profileMobileBannerUrl.trim(),
        bio: form.bio,
        country: form.country.trim(),
        favoriteGame: form.favoriteGame,
        profileColor: hasCustomColor ? form.profileColor : '',
        needsProfileSetup: false,
    });

    const finish = async () => {
        for (const step of STEPS) {
            const error = validateStep(step.id);
            if (error) {
                setStarted(true);
                goToStep(step.id);
                setModalMessage(error);
                return;
            }
        }
        setSaving(true);
        try {
            const payload = buildPayload();
            await setDoc(doc(db, 'profiles', user.uid), payload, { merge: true });
            if (onConsent) onConsent(getPersonalizationConsent() === true);
            if (onComplete) onComplete(payload);
        } catch (error) {
            setModalMessage(`Could not save your profile: ${error.message}`);
            setSaving(false);
        }
    };

    // Wizard schließen ohne Zwang, Felder zu speichern. Die Personalisierungs-
    // Entscheidung wird trotzdem festgehalten.
    const skipWizard = async () => {
        setSaving(true);
        try {
            await setDoc(doc(db, 'profiles', user.uid), { needsProfileSetup: false }, { merge: true });
            if (onConsent) onConsent(getPersonalizationConsent() === true);
            if (onComplete) onComplete({ needsProfileSetup: false });
        } catch (error) {
            setModalMessage(`Could not skip setup: ${error.message}`);
            setSaving(false);
        }
    };

    const goNext = () => {
        const error = validateStep(activeStep);
        if (error) {
            setCompletedSteps((prev) => prev.filter((id) => id !== activeStep));
            setModalMessage(error);
            return;
        }
        setCompletedSteps((prev) => (prev.includes(activeStep) ? prev : [...prev, activeStep]));
        if (isLastStep) {
            finish();
        } else {
            goToStep(STEPS[activeStepIndex + 1].id);
        }
    };

    const goBack = () => {
        if (activeStepIndex > 0) {
            goToStep(STEPS[activeStepIndex - 1].id);
        } else {
            setStarted(false);
            scrollToTop();
        }
    };

    const handleLinkDiscord = async () => {
        try {
            await openDiscordLink();
        } catch (error) {
            setModalMessage(`Could not start Discord linking: ${error.message}`);
        }
    };

    const handleUnlinkDiscord = () => {
        setConfirmation?.({
            message: 'Unlink your Discord account? Your ranks will no longer be synced.',
            onConfirm: async () => {
                try {
                    await unlinkDiscordAccount();
                    setModalMessage('Discord account has been unlinked.');
                } catch (error) {
                    setModalMessage(`Error unlinking account: ${error.message}`);
                }
            },
        });
    };

    const renderStep = () => {
        switch (activeStep) {
            case 'profile':
                return (
                    <div className="space-y-6">
                        <Field label="Favorite game" hint="Sets your default profile color and the game shown first.">
                            <div className="flex justify-center">
                                <div className="relative flex items-center overflow-x-auto rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-700">
                                    <div
                                        className="absolute h-full rounded-full transition-all duration-500 ease-in-out"
                                        style={{ ...gameGliderStyle, backgroundColor: getGameColor(form.favoriteGame).hex }}
                                    />
                                    {games.map((game, index) => (
                                        <button
                                            key={game.id}
                                            type="button"
                                            ref={(el) => (gameTabRefs.current[index] = el)}
                                            onClick={() => setField('favoriteGame', game.id)}
                                            className={`relative z-10 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-300 sm:px-6 sm:text-base ${
                                                form.favoriteGame === game.id
                                                    ? 'text-white'
                                                    : 'text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white'
                                            }`}
                                        >
                                            {game.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </Field>
                        <Field label="Bio" hint="Introduce yourself and the creations you enjoy." htmlFor="setup-bio">
                            <textarea
                                id="setup-bio"
                                value={form.bio}
                                onChange={(e) => setField('bio', e.target.value)}
                                rows="4"
                                className={`${inputClass} resize-y`}
                                placeholder="Tell the community about yourself..."
                            />
                        </Field>
                        <Field label="Country" hint="Optional. This appears publicly on your profile." htmlFor="setup-country">
                            <input
                                type="text"
                                id="setup-country"
                                value={form.country}
                                onChange={(e) => setField('country', e.target.value)}
                                className={inputClass}
                                placeholder="e.g. Switzerland"
                            />
                        </Field>
                    </div>
                );

            case 'appearance':
                return (
                    <div className="space-y-6">
                        <div>
                            <p className="mb-2 text-center text-sm font-semibold text-gray-700 dark:text-gray-200">Live preview</p>
                            <ProfilePreview
                                appearance={appearance}
                                username={username}
                                country={form.country}
                                favoriteGame={form.favoriteGame}
                                bio={form.bio}
                                avatarUrl={form.profilePictureUrl.trim()}
                                bannerUrl={(form.profileBannerUrl.trim() || form.profileMobileBannerUrl.trim())}
                                followers={userProfile?.followers?.length || 0}
                                following={userProfile?.following?.length || 0}
                            />
                        </div>

                        <Field label="Profile color" hint="Used for profile accents. Follow your favorite game or pick a custom color.">
                            <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                                <input
                                    type="checkbox"
                                    checked={!hasCustomColor}
                                    onChange={(e) => setField('profileColor', e.target.checked ? '' : gameHex)}
                                    className="h-4 w-4 rounded border-gray-300"
                                    style={{ accentColor: gameHex }}
                                />
                                <span>
                                    <span className="block font-semibold text-gray-700 dark:text-gray-200">Use favorite game color</span>
                                    <span className="block text-sm text-gray-500 dark:text-gray-400">
                                        Automatically follows {getGame(form.favoriteGame)?.name || 'the game'}.
                                    </span>
                                </span>
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="color"
                                    value={appearance.hex}
                                    onChange={(e) => setField('profileColor', e.target.value)}
                                    disabled={!hasCustomColor}
                                    className="h-12 w-20 cursor-pointer rounded-xl border border-gray-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700"
                                />
                                <div
                                    className="flex h-12 flex-grow items-center justify-center rounded-xl font-mono font-bold text-white shadow-sm"
                                    style={{ backgroundColor: appearance.hex }}
                                >
                                    {appearance.hex.toUpperCase()}
                                </div>
                            </div>
                        </Field>

                        <Field
                            label="Profile picture URL"
                            hint="Use a direct link to a square image for the best result."
                            htmlFor="setup-avatar"
                        >
                            <input
                                type="url"
                                inputMode="url"
                                id="setup-avatar"
                                value={form.profilePictureUrl}
                                onChange={(e) => setField('profilePictureUrl', e.target.value)}
                                className={inputClass}
                                placeholder="https://..."
                            />
                            <InfoBox />
                        </Field>
                        <Field
                            label="Profile banner URL"
                            hint="Recommended size: 1600 × 600 px. Keep important details near the center."
                            htmlFor="setup-banner"
                        >
                            <input
                                type="url"
                                inputMode="url"
                                id="setup-banner"
                                value={form.profileBannerUrl}
                                onChange={(e) => setField('profileBannerUrl', e.target.value)}
                                className={inputClass}
                                placeholder="https://..."
                            />
                            <InfoBox />
                        </Field>
                        <Field
                            label="Mobile profile banner URL"
                            hint="Optional. Recommended size: 1080 × 1920 px (9:16). Falls back to the desktop banner."
                            htmlFor="setup-mobile-banner"
                        >
                            <input
                                type="url"
                                inputMode="url"
                                id="setup-mobile-banner"
                                value={form.profileMobileBannerUrl}
                                onChange={(e) => setField('profileMobileBannerUrl', e.target.value)}
                                className={inputClass}
                                placeholder="https://..."
                            />
                            <InfoBox />
                        </Field>
                    </div>
                );

            case 'feed':
                return (
                    <PersonalizationSettings
                        user={user}
                        setModalMessage={setModalMessage}
                        setConfirmation={setConfirmation}
                        embedded
                    />
                );

            case 'discord':
                return (
                    <div className="space-y-4">
                        <div className="text-center">
                            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow">
                                <Icon path={DISCORD_ICON?.icon || ICONS.share} solid className="h-7 w-7" />
                            </span>
                            <p className="text-gray-500 dark:text-gray-400">
                                Linking your Discord account lets PlanetCreations sync your community ranks and
                                suggest communities that belong to the Discord servers <strong>you are already a
                                member of</strong>. This is optional and you can unlink anytime.
                            </p>
                        </div>
                        {linkedDiscord ? (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-l-4 border-green-400 bg-green-50 p-4 dark:bg-green-950/30">
                                <p className="font-semibold text-green-800 dark:text-green-300">
                                    Linked to{' '}
                                    <span className="rounded-full bg-green-200 px-3 py-1 font-bold text-green-900 dark:bg-green-800 dark:text-green-100">
                                        {linkedDiscord.username}
                                    </span>
                                </p>
                                <button
                                    type="button"
                                    onClick={handleUnlinkDiscord}
                                    className="rounded-lg bg-red-500 px-4 py-2 font-bold text-white transition hover:bg-red-600"
                                >
                                    Unlink
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handleLinkDiscord}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 font-bold text-white transition hover:bg-indigo-600"
                            >
                                <Icon path={DISCORD_ICON?.icon || ICONS.share} solid className="h-5 w-5" />
                                Link with Discord
                            </button>
                        )}
                    </div>
                );

            case 'notifications':
                return <NotificationSettings user={user} setModalMessage={setModalMessage} embedded />;

            default:
                return null;
        }
    };

    // --- Welcome screen ---------------------------------------------------
    if (!started) {
        return (
            <div className="min-h-full bg-gray-100 py-8 dark:bg-gray-900 sm:py-12" style={appearance.style}>
                <div className="mx-auto max-w-2xl px-4">
                    <div className="overflow-hidden rounded-3xl bg-white shadow-xl dark:bg-gray-800">
                        <div
                            className="px-6 py-10 text-center text-white"
                            style={{ background: `linear-gradient(135deg, ${appearance.hex}, ${appearance.hoverHex})` }}
                        >
                            <img src={logo} alt="PlanetCreations" className="mx-auto h-16 w-auto drop-shadow" />
                            <h1 className="mt-6 text-3xl font-bold drop-shadow-sm">Welcome, {username}!</h1>
                            <p className="mx-auto mt-3 max-w-md text-white/85">
                                Let&apos;s make PlanetCreations yours. This short wizard helps you set up your
                                profile, personalize your feed and connect the extras.
                            </p>
                        </div>

                        <div className="space-y-3 px-6 py-6 sm:px-8">
                            {STEPS.map((step) => (
                                <div key={step.id} className="flex items-center gap-3">
                                    <span
                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white"
                                        style={{ backgroundColor: appearance.hex }}
                                    >
                                        <Icon path={ICONS.check} className="h-5 w-5" />
                                    </span>
                                    <span>
                                        <span className="block font-semibold text-gray-800 dark:text-gray-100">{step.label}</span>
                                        <span className="block text-sm text-gray-500 dark:text-gray-400">{step.blurb}</span>
                                    </span>
                                </div>
                            ))}
                            <p className="rounded-xl bg-gray-50 p-3 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                                Every step is optional — you can skip anything and change it all later from
                                <strong> Edit Profile</strong> on your profile page and in <strong>Settings</strong>.
                            </p>
                        </div>

                        <div className="flex flex-col gap-3 px-6 pb-8 sm:flex-row-reverse sm:px-8">
                            <button
                                type="button"
                                onClick={() => {
                                    setStarted(true);
                                    setActiveStep('profile');
                                    setMobileOpen(true);
                                    scrollToTop();
                                }}
                                style={{ backgroundColor: appearance.hex }}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl px-6 py-3 font-bold text-white transition hover:brightness-95"
                            >
                                Start wizard
                                <Icon path={ICONS.chevronRight} className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowSkipInfo(true)}
                                className="flex-1 rounded-xl border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                                Skip wizard
                            </button>
                        </div>
                    </div>
                </div>

                {renderSkipInfo()}
                {renderLeaveConfirm()}
            </div>
        );
    }

    // --- Wizard steps -----------------------------------------------------
    return (
        <div className="min-h-full bg-gray-100 dark:bg-gray-900" style={appearance.style}>
            <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
                <div className="mb-6 text-center">
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 sm:text-3xl">Set up your profile</h1>
                    <p className="mt-2 text-gray-500 dark:text-gray-400">Every step is optional. You can change all of this later.</p>
                </div>

                <div className="lg:flex lg:items-start lg:gap-6">
                    <nav className={`${mobileOpen ? 'hidden' : 'block'} lg:block lg:w-64 lg:flex-shrink-0`}>
                        <div className="rounded-2xl bg-white p-2 shadow-md dark:bg-gray-800">
                            {STEPS.map((step, index) => {
                                const active = step.id === activeStep;
                                const completed = completedSteps.includes(step.id) && !validateStep(step.id);
                                return (
                                    <button
                                        key={step.id}
                                        type="button"
                                        onClick={() => goToStep(step.id)}
                                        style={active ? { backgroundColor: accent, color: '#fff' } : undefined}
                                        className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors last:mb-0 ${
                                            active ? '' : 'text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        <span
                                            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                                                completed
                                                    ? 'bg-green-500 text-white'
                                                    : active
                                                        ? 'bg-white/20'
                                                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                                            }`}
                                        >
                                            {completed ? '✓' : index + 1}
                                        </span>
                                        <span className="min-w-0 flex-grow truncate text-sm font-semibold">{step.label}</span>
                                        <Icon path={ICONS.chevronRight} className={`h-4 w-4 flex-shrink-0 lg:hidden ${active ? 'text-white' : 'text-gray-300'}`} />
                                    </button>
                                );
                            })}
                        </div>
                    </nav>

                    <section className={`${mobileOpen ? 'block' : 'hidden'} mt-4 min-w-0 flex-1 lg:mt-0 lg:block`}>
                        <button
                            type="button"
                            onClick={() => setMobileOpen(false)}
                            className="mb-3 flex items-center gap-1 font-semibold lg:hidden"
                            style={{ color: accent }}
                        >
                            <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                            All steps
                        </button>

                        <div className="space-y-6 rounded-2xl bg-white p-6 shadow-md dark:bg-gray-800 sm:p-8">
                            <div className="relative flex items-center justify-center">
                                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{STEPS[activeStepIndex].label}</h2>
                                <span className="absolute right-0 text-sm text-gray-400">{activeStepIndex + 1} / {STEPS.length}</span>
                            </div>

                            {renderStep()}

                            <div className="flex items-center gap-3 border-t border-gray-100 pt-6 dark:border-gray-700">
                                <button
                                    type="button"
                                    onClick={goBack}
                                    disabled={saving}
                                    style={{ backgroundColor: accent }}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-bold text-white transition hover:brightness-95 disabled:opacity-50 sm:px-5"
                                >
                                    <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                                    Back
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowSkipInfo(true)}
                                    disabled={saving}
                                    style={{ backgroundColor: accent }}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-bold text-white transition hover:brightness-95 disabled:opacity-50 sm:px-5"
                                >
                                    Skip wizard
                                </button>
                                <button
                                    type="button"
                                    onClick={goNext}
                                    disabled={saving}
                                    style={{ backgroundColor: accent }}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-bold text-white transition hover:brightness-95 disabled:opacity-50 sm:px-5"
                                >
                                    {saving ? <Spinner size="small" /> : isLastStep ? 'Finish' : (
                                        <>
                                            Next
                                            <Icon path={ICONS.chevronRight} className="h-5 w-5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            {renderSkipInfo()}
            {renderLeaveConfirm()}
        </div>
    );

    function renderSkipInfo() {
        if (!showSkipInfo) return null;
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">Skip profile setup?</h3>
                    <p className="mt-3 text-gray-600 dark:text-gray-300">
                        No problem — every part of this is optional. You can set it all up later using the
                        <strong> Edit Profile</strong> button on your profile page, and manage your feed, Discord
                        and notification preferences in <strong>Settings</strong>.
                    </p>
                    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
                        <button
                            type="button"
                            onClick={() => setShowSkipInfo(false)}
                            disabled={saving}
                            className="rounded-xl border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            Continue setup
                        </button>
                        <button
                            type="button"
                            onClick={skipWizard}
                            disabled={saving}
                            style={{ backgroundColor: accent }}
                            className="flex items-center justify-center rounded-xl px-6 py-2.5 font-bold text-white transition hover:brightness-95 disabled:opacity-50"
                        >
                            {saving ? <Spinner size="small" /> : 'Skip anyway'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    function renderLeaveConfirm() {
        if (!showLeaveConfirm) return null;
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">Leave profile setup?</h3>
                    <p className="mt-3 text-gray-600 dark:text-gray-300">
                        You&apos;re in the middle of setting up your profile. You can finish it later from
                        <strong> Edit Profile</strong> and <strong>Settings</strong> — do you want to leave now?
                    </p>
                    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
                        <button
                            type="button"
                            onClick={() => setShowLeaveConfirm(false)}
                            disabled={saving}
                            className="rounded-xl border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            Keep setting up
                        </button>
                        <button
                            type="button"
                            onClick={skipWizard}
                            disabled={saving}
                            className="flex items-center justify-center rounded-xl bg-red-500 px-6 py-2.5 font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
                        >
                            {saving ? <Spinner size="small" /> : 'Leave setup'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
};

export default ProfileSetupWizard;
