import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
    containsBlacklistedWord,
    getGameColor,
    ICONS,
    isSafeHttpUrl,
} from '../../utils/helpers';
import { getDefaultGameId, getGame } from '../../utils/gamesRegistry';
import {
    getProfileAppearance,
    isValidProfileColor,
} from '../../utils/profileAppearance';
import useGames from '../../hooks/useGames';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import InfoBox from '../ui/InfoBox';
import ProfileImage from '../ui/ProfileImage';

const inputClass = [
    'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-gray-900',
    'placeholder:text-gray-400 transition focus:border-[--game-color]',
    'focus:outline-none focus:ring-2 focus:ring-[--game-color]/25',
    'dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100',
    'dark:placeholder:text-gray-500',
].join(' ');

const PROFILE_SECTIONS = [
    {
        id: 'profile',
        label: 'Profile',
        hint: 'Picture, bio & country',
        icon: ICONS.user,
        tint: 'bg-sky-500',
    },
    {
        id: 'social',
        label: 'Social Links',
        hint: 'Your public channels',
        icon: ICONS.share,
        tint: 'bg-violet-500',
    },
    {
        id: 'games',
        label: 'Games & DLCs',
        hint: 'Favorites & ownership',
        icon: ICONS.star,
        tint: 'bg-amber-500',
    },
];

const SOCIAL_FIELDS = [
    {
        id: 'youtube',
        label: 'YouTube',
        placeholder: 'https://youtube.com/@yourchannel',
    },
    {
        id: 'twitch',
        label: 'Twitch',
        placeholder: 'https://twitch.tv/yourchannel',
    },
    {
        id: 'instagram',
        label: 'Instagram',
        placeholder: 'https://instagram.com/yourprofile',
    },
    {
        id: 'tiktok',
        label: 'TikTok',
        placeholder: 'https://tiktok.com/@yourprofile',
    },
    {
        id: 'x',
        label: 'X',
        placeholder: 'https://x.com/yourprofile',
    },
    {
        id: 'discord',
        label: 'Discord',
        placeholder: 'Discord user ID',
        type: 'text',
    },
    {
        id: 'steam',
        label: 'Steam',
        placeholder: 'https://steamcommunity.com/id/yourprofile',
    },
    {
        id: 'website',
        label: 'Website',
        placeholder: 'https://your-website.com',
    },
];

const SettingsCard = ({ title, description, children }) => (
    <div className="rounded-2xl bg-white p-5 shadow-md dark:bg-gray-800 sm:p-8">
        <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{title}</h2>
            {description && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
            )}
        </div>
        <div className="space-y-6">{children}</div>
    </div>
);

const Field = ({ label, hint, htmlFor, children }) => (
    <div>
        <label
            className="mb-1.5 block font-semibold text-gray-700 dark:text-gray-200"
            htmlFor={htmlFor}
        >
            {label}
        </label>
        {hint && <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{hint}</p>}
        {children}
    </div>
);

const FormActions = ({ dirty, saving, onCancel }) => (
    <div className="flex flex-col-reverse gap-3 border-t border-gray-100 pt-6 dark:border-gray-700 sm:flex-row sm:justify-end">
        <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
            Cancel
        </button>
        <button
            type="submit"
            disabled={!dirty || saving}
            className="game-bg game-bg-hover flex min-w-[150px] items-center justify-center rounded-xl px-6 py-2.5 font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
        >
            {saving ? 'Saving...' : 'Save Changes'}
        </button>
    </div>
);

const EditProfilePage = ({ user, setModalMessage, blacklist }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profileData, setProfileData] = useState(null);
    const [initialProfileData, setInitialProfileData] = useState(null);
    const [allDlcs, setAllDlcs] = useState({});
    const [selectedGameForDlc, setSelectedGameForDlc] = useState(getDefaultGameId());
    const [activeSectionId, setActiveSectionId] = useState('profile');
    const [mobileSectionOpen, setMobileSectionOpen] = useState(false);
    const [profileBannerFailed, setProfileBannerFailed] = useState(false);
    const navigate = useNavigate();
    const games = useGames();

    const selectedGameColor = getGameColor(selectedGameForDlc);
    const hasCustomProfileColor = isValidProfileColor(profileData?.profileColor);
    const color = getProfileAppearance(
        hasCustomProfileColor ? profileData.profileColor : selectedGameColor.hex
    );
    const selectedGame = getGame(selectedGameForDlc);
    const selectedGameDlcs = allDlcs[selectedGameForDlc] || [];
    const ownedDlcsForSelectedGame = profileData?.ownedDlcs?.[selectedGameForDlc] || [];
    const platformPreference =
        profileData?.platformPreferences?.[selectedGameForDlc] || 'pc';
    const isDirty = useMemo(
        () => JSON.stringify(profileData) !== JSON.stringify(initialProfileData),
        [initialProfileData, profileData]
    );

    useEffect(() => {
        let cancelled = false;

        const fetchData = async () => {
            if (!user) {
                navigate('/login');
                return;
            }

            try {
                const [profileSnap, dlcSnapshot] = await Promise.all([
                    getDoc(doc(db, 'profiles', user.uid)),
                    getDocs(collection(db, 'dlcs')),
                ]);
                if (cancelled) return;

                const storedProfile = profileSnap.exists()
                    ? profileSnap.data()
                    : {
                        username: 'New User',
                        favoriteGame: getDefaultGameId(),
                        ownedDlcs: {},
                        platformPreferences: {},
                    };
                const nextProfile = {
                    ...storedProfile,
                    profileColor: isValidProfileColor(storedProfile.profileColor)
                        ? storedProfile.profileColor
                        : '',
                };
                const nextSelectedGame = getGame(nextProfile.favoriteGame)
                    ? nextProfile.favoriteGame
                    : getDefaultGameId();
                const dlcData = {};
                dlcSnapshot.forEach((dlcDoc) => {
                    dlcData[dlcDoc.id] = dlcDoc.data().names || [];
                });

                setProfileData(nextProfile);
                setInitialProfileData(nextProfile);
                setSelectedGameForDlc(nextSelectedGame);
                setAllDlcs(dlcData);
            } catch (error) {
                setModalMessage(`Could not load your profile: ${error.message}`);
                navigate(`/profile/${user.uid}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchData();
        return () => {
            cancelled = true;
        };
    }, [navigate, setModalMessage, user]);

    useEffect(() => {
        setProfileBannerFailed(false);
    }, [profileData?.profileBannerUrl]);

    const openSection = (sectionId) => {
        setActiveSectionId(sectionId);
        setMobileSectionOpen(true);
    };

    const handleChange = (event) => {
        const { name, value } = event.target;
        setProfileData((current) => ({ ...current, [name]: value }));
    };

    const handleFavoriteGame = () => {
        setProfileData((current) => ({
            ...current,
            favoriteGame: selectedGameForDlc,
        }));
    };

    const handleDlcChange = (dlcName) => {
        setProfileData((current) => {
            const currentDlcs = current.ownedDlcs?.[selectedGameForDlc] || [];
            const nextDlcs = currentDlcs.includes(dlcName)
                ? currentDlcs.filter((dlc) => dlc !== dlcName)
                : [...currentDlcs, dlcName];

            return {
                ...current,
                ownedDlcs: {
                    ...current.ownedDlcs,
                    [selectedGameForDlc]: nextDlcs,
                },
            };
        });
    };

    const handlePlatformPreferenceChange = () => {
        setProfileData((current) => {
            const currentPreference =
                current.platformPreferences?.[selectedGameForDlc] || 'pc';
            const nextPreference = currentPreference === 'pc' ? 'console' : 'pc';
            return {
                ...current,
                platformPreferences: {
                    ...current.platformPreferences,
                    [selectedGameForDlc]: nextPreference,
                },
            };
        });
    };

    const focusSection = (sectionId) => {
        setActiveSectionId(sectionId);
        setMobileSectionOpen(true);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!profileData || saving || !isDirty) return;

        if (containsBlacklistedWord(profileData.bio, blacklist)) {
            focusSection('profile');
            setModalMessage('Your bio contains a forbidden word.');
            return;
        }

        if (
            profileData.profilePictureUrl?.trim() &&
            !isSafeHttpUrl(profileData.profilePictureUrl)
        ) {
            focusSection('profile');
            setModalMessage('The profile picture must be a valid http(s) URL.');
            return;
        }

        if (
            profileData.profileBannerUrl?.trim() &&
            !isSafeHttpUrl(profileData.profileBannerUrl)
        ) {
            focusSection('profile');
            setModalMessage('The profile banner must be a valid http(s) URL.');
            return;
        }

        if (
            profileData.profileColor &&
            !isValidProfileColor(profileData.profileColor)
        ) {
            focusSection('profile');
            setModalMessage('Please choose a valid profile color.');
            return;
        }

        const invalidSocialField = SOCIAL_FIELDS.find(
            (field) =>
                field.type !== 'text' &&
                profileData[field.id]?.trim() &&
                !isSafeHttpUrl(profileData[field.id])
        );
        if (invalidSocialField) {
            focusSection('social');
            setModalMessage(`${invalidSocialField.label} must be a valid http(s) URL.`);
            return;
        }

        setSaving(true);
        try {
            await setDoc(doc(db, 'profiles', user.uid), profileData, { merge: true });
            setInitialProfileData(profileData);
            setModalMessage('Profile updated successfully!');
            navigate(`/profile/${user.uid}`);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    if (loading || !profileData) return <Spinner />;

    const profileImageUrl = profileData.profilePictureUrl?.trim();
    const profileBannerUrl = profileData.profileBannerUrl?.trim();

    return (
        <div
            className="mx-auto mt-10 max-w-6xl p-4 sm:p-8"
            style={color.style}
        >
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 sm:text-4xl">
                    Edit Profile
                </h1>
                <p className="mt-2 text-gray-500 dark:text-gray-400">
                    Choose what other creators see and tailor the games shown across PlanetCreations.
                </p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="lg:flex lg:items-start lg:gap-6">
                <nav
                    aria-label="Profile settings"
                    className={`${mobileSectionOpen ? 'hidden' : 'block'} lg:block lg:w-72 lg:flex-shrink-0`}
                >
                    <div className="rounded-2xl bg-white p-2 shadow-md dark:bg-gray-800">
                        {PROFILE_SECTIONS.map((section) => {
                            const isActive = section.id === activeSectionId;
                            return (
                                <button
                                    key={section.id}
                                    type="button"
                                    onClick={() => openSection(section.id)}
                                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors last:mb-0 ${
                                        isActive
                                            ? 'lg:bg-[--game-color] lg:text-white'
                                            : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    <span
                                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white ${section.tint}`}
                                    >
                                        <Icon path={section.icon} className="h-5 w-5" />
                                    </span>
                                    <span className="min-w-0 flex-grow">
                                        <span className="block font-semibold leading-tight">
                                            {section.label}
                                        </span>
                                        <span
                                            className={`block truncate text-xs ${
                                                isActive
                                                    ? 'text-gray-400 lg:text-white/80'
                                                    : 'text-gray-400 dark:text-gray-500'
                                            }`}
                                        >
                                            {section.hint}
                                        </span>
                                    </span>
                                    <Icon
                                        path={ICONS.chevronRight}
                                        className="h-4 w-4 flex-shrink-0 text-gray-300 lg:hidden"
                                    />
                                </button>
                            );
                        })}
                    </div>
                </nav>

                <section
                    className={`${mobileSectionOpen ? 'block' : 'hidden'} min-w-0 flex-1 lg:block`}
                >
                    <button
                        type="button"
                        onClick={() => setMobileSectionOpen(false)}
                        className="game-text mb-3 flex items-center gap-1 font-semibold lg:hidden"
                    >
                        <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                        Edit Profile
                    </button>

                    {activeSectionId === 'profile' && (
                        <SettingsCard
                            title="Profile"
                            description="Your public appearance, introduction and location."
                        >
                            <div
                                className="relative min-h-48 overflow-hidden rounded-2xl border border-gray-200 shadow-sm dark:border-gray-700"
                                style={{
                                    background: `linear-gradient(135deg, ${color.hex}, ${color.hoverHex})`,
                                }}
                            >
                                {profileBannerUrl && !profileBannerFailed && (
                                    <img
                                        src={profileBannerUrl}
                                        alt=""
                                        onError={() => setProfileBannerFailed(true)}
                                        className="absolute inset-0 h-full w-full object-cover"
                                    />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/55" />
                                <div className="relative flex min-h-48 items-end gap-4 p-5 text-white">
                                    <ProfileImage
                                        src={profileImageUrl}
                                        alt="Profile preview"
                                        className="h-20 w-20 flex-shrink-0 rounded-2xl border-4 bg-white object-cover shadow-lg"
                                        style={{ borderColor: color.hex }}
                                    />
                                    <div className="min-w-0">
                                        <p className="truncate text-xl font-bold">
                                            {profileData.username || 'Your profile'}
                                        </p>
                                        <p className="mt-1 text-sm text-white/75">
                                            Profile appearance preview
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <Field
                                label="Profile color"
                                hint="Used for profile accents and controls. Without a custom color, the active game's color is used."
                                htmlFor="profileColor"
                            >
                                <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                                    <input
                                        type="checkbox"
                                        checked={!hasCustomProfileColor}
                                        onChange={(event) =>
                                            setProfileData((current) => ({
                                                ...current,
                                                profileColor: event.target.checked
                                                    ? ''
                                                    : selectedGameColor.hex,
                                            }))
                                        }
                                        className="h-4 w-4 rounded border-gray-300"
                                        style={{ accentColor: selectedGameColor.hex }}
                                    />
                                    <span>
                                        <span className="block font-semibold text-gray-700 dark:text-gray-200">
                                            Use active game color
                                        </span>
                                        <span className="block text-sm text-gray-500 dark:text-gray-400">
                                            Automatically follows the selected game.
                                        </span>
                                    </span>
                                </label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="color"
                                        name="profileColor"
                                        id="profileColor"
                                        value={color.hex}
                                        onChange={handleChange}
                                        disabled={!hasCustomProfileColor}
                                        className="h-12 w-20 cursor-pointer rounded-xl border border-gray-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700"
                                    />
                                    <div
                                        className="flex h-12 flex-grow items-center justify-center rounded-xl font-mono font-bold text-white shadow-sm"
                                        style={{ backgroundColor: color.hex }}
                                    >
                                        {color.hex.toUpperCase()}
                                    </div>
                                </div>
                                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                                    {hasCustomProfileColor
                                        ? 'Using your custom profile color.'
                                        : `Following ${selectedGame?.name || 'the active game'} color.`}
                                </p>
                            </Field>

                            <Field
                                label="Profile banner URL"
                                hint="Recommended size: 1600 × 600 px. Keep important details near the center because the image may be cropped."
                                htmlFor="profileBannerUrl"
                            >
                                <input
                                    type="url"
                                    inputMode="url"
                                    name="profileBannerUrl"
                                    id="profileBannerUrl"
                                    value={profileData.profileBannerUrl || ''}
                                    onChange={handleChange}
                                    className={inputClass}
                                    placeholder="https://..."
                                />
                                <InfoBox />
                            </Field>

                            <Field
                                label="Profile picture URL"
                                hint="Use a direct link to a square image for the best result."
                                htmlFor="profilePictureUrl"
                            >
                                <input
                                    type="url"
                                    inputMode="url"
                                    name="profilePictureUrl"
                                    id="profilePictureUrl"
                                    value={profileData.profilePictureUrl || ''}
                                    onChange={handleChange}
                                    className={inputClass}
                                    placeholder="https://..."
                                />
                                <InfoBox />
                            </Field>

                            <Field
                                label="Bio"
                                hint="Introduce yourself and the kinds of creations you enjoy."
                                htmlFor="bio"
                            >
                                <textarea
                                    name="bio"
                                    id="bio"
                                    value={profileData.bio || ''}
                                    onChange={handleChange}
                                    rows="5"
                                    className={`${inputClass} resize-y`}
                                    placeholder="Tell the community about yourself..."
                                />
                            </Field>

                            <Field
                                label="Country"
                                hint="Optional. This appears publicly on your profile."
                                htmlFor="country"
                            >
                                <input
                                    type="text"
                                    name="country"
                                    id="country"
                                    value={profileData.country || ''}
                                    onChange={handleChange}
                                    className={inputClass}
                                    placeholder="e.g. Switzerland"
                                />
                            </Field>

                            <FormActions
                                dirty={isDirty}
                                saving={saving}
                                onCancel={() => navigate(`/profile/${user.uid}`)}
                            />
                        </SettingsCard>
                    )}

                    {activeSectionId === 'social' && (
                        <SettingsCard
                            title="Social Links"
                            description="Help visitors find your channels and creator profiles."
                        >
                            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                {SOCIAL_FIELDS.map((field) => (
                                    <Field
                                        key={field.id}
                                        label={field.label}
                                        htmlFor={field.id}
                                    >
                                        <input
                                            type={field.type || 'url'}
                                            inputMode={field.type === 'text' ? 'text' : 'url'}
                                            name={field.id}
                                            id={field.id}
                                            value={profileData[field.id] || ''}
                                            onChange={handleChange}
                                            className={inputClass}
                                            placeholder={field.placeholder}
                                        />
                                    </Field>
                                ))}
                            </div>

                            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                                Only add links you want to display publicly. You can remove a link at any time by clearing its field.
                            </div>

                            <FormActions
                                dirty={isDirty}
                                saving={saving}
                                onCancel={() => navigate(`/profile/${user.uid}`)}
                            />
                        </SettingsCard>
                    )}

                    {activeSectionId === 'games' && (
                        <SettingsCard
                            title="Games & DLCs"
                            description="Set your favorite game, default platform and owned DLCs."
                        >
                            <div>
                                <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                                    Select a game
                                </p>
                                <div
                                    className="grid w-full gap-1 rounded-2xl bg-gray-100 p-1 dark:bg-gray-900/60"
                                    style={{
                                        gridTemplateColumns: `repeat(${Math.max(games.length, 1)}, minmax(0, 1fr))`,
                                    }}
                                >
                                    {games.map((game) => {
                                        const isSelected = selectedGameForDlc === game.id;
                                        return (
                                            <button
                                                key={game.id}
                                                type="button"
                                                onClick={() => setSelectedGameForDlc(game.id)}
                                                style={
                                                    isSelected
                                                        ? { backgroundColor: getGameColor(game.id).hex }
                                                        : undefined
                                                }
                                                className={`min-w-0 rounded-xl px-2 py-2.5 text-center text-xs font-semibold transition sm:text-sm ${
                                                    isSelected
                                                        ? 'text-white shadow-sm'
                                                        : 'text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'
                                                }`}
                                            >
                                                <span className="block truncate">{game.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div
                                className="grid gap-4 md:grid-cols-2"
                                style={selectedGameColor.style}
                            >
                                <button
                                    type="button"
                                    onClick={handleFavoriteGame}
                                    aria-pressed={profileData.favoriteGame === selectedGameForDlc}
                                    className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
                                        profileData.favoriteGame === selectedGameForDlc
                                            ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                                            : 'border-gray-200 hover:border-red-200 hover:bg-red-50/50 dark:border-gray-700 dark:hover:border-red-900 dark:hover:bg-red-950/20'
                                    }`}
                                >
                                    <span
                                        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                                            profileData.favoriteGame === selectedGameForDlc
                                                ? 'bg-red-500 text-white'
                                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                                        }`}
                                    >
                                        <Icon
                                            path={ICONS.heart}
                                            solid={profileData.favoriteGame === selectedGameForDlc}
                                            className="h-5 w-5"
                                        />
                                    </span>
                                    <span>
                                        <span className="block font-bold text-gray-800 dark:text-gray-100">
                                            Favorite game
                                        </span>
                                        <span className="block text-sm text-gray-500 dark:text-gray-400">
                                            {profileData.favoriteGame === selectedGameForDlc
                                                ? `${selectedGame?.name || 'This game'} is your favorite`
                                                : `Make ${selectedGame?.name || 'this game'} your favorite`}
                                        </span>
                                    </span>
                                </button>

                                {selectedGame?.platforms?.includes('console') ? (
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={platformPreference === 'console'}
                                        onClick={handlePlatformPreferenceChange}
                                        className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 p-4 text-left transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                                    >
                                        <span>
                                            <span className="block font-bold text-gray-800 dark:text-gray-100">
                                                Default platform
                                            </span>
                                            <span className="block text-sm text-gray-500 dark:text-gray-400">
                                                {platformPreference === 'pc' ? 'PC' : 'Console'}
                                            </span>
                                        </span>
                                        <span
                                            className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors ${
                                                platformPreference === 'console'
                                                    ? 'bg-green-500'
                                                    : 'bg-blue-500'
                                            }`}
                                        >
                                            <span
                                                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                                    platformPreference === 'console'
                                                        ? 'translate-x-6'
                                                        : 'translate-x-1'
                                                }`}
                                            />
                                        </span>
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                            <Icon path={ICONS.desktop} className="h-5 w-5" />
                                        </span>
                                        <span>
                                            <span className="block font-bold text-gray-800 dark:text-gray-100">
                                                Default platform
                                            </span>
                                            <span className="block text-sm text-gray-500 dark:text-gray-400">
                                                PC
                                            </span>
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
                                <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
                                    <div>
                                        <h3 className="font-bold text-gray-800 dark:text-gray-100">
                                            Owned DLCs
                                        </h3>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {selectedGame?.name || 'Selected game'}
                                        </p>
                                    </div>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600 shadow-sm dark:bg-gray-700 dark:text-gray-200">
                                        {ownedDlcsForSelectedGame.length}/{selectedGameDlcs.length}
                                    </span>
                                </div>

                                {selectedGameDlcs.length > 0 ? (
                                    <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto p-3 sm:grid-cols-2">
                                        {selectedGameDlcs.map((dlc) => (
                                            <label
                                                key={dlc}
                                                className="flex cursor-pointer items-center rounded-xl p-3 text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 rounded border-gray-300"
                                                    style={{ accentColor: selectedGameColor.hex }}
                                                    checked={ownedDlcsForSelectedGame.includes(dlc)}
                                                    onChange={() => handleDlcChange(dlc)}
                                                />
                                                <span className="ml-3 text-sm font-medium">{dlc}</span>
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
                                        No DLCs are listed for this game yet.
                                    </p>
                                )}
                            </div>

                            <FormActions
                                dirty={isDirty}
                                saving={saving}
                                onCancel={() => navigate(`/profile/${user.uid}`)}
                            />
                        </SettingsCard>
                    )}
                </section>
            </form>
        </div>
    );
};

export default EditProfilePage;
