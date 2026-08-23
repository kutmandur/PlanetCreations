import React, { useLayoutEffect, useRef, useState } from 'react';
import {
    getGameColor,
    getTextColorForBackground,
    ICONS,
    SOCIAL_PLATFORMS,
} from '../../utils/helpers';
import Icon from '../ui/Icon';
import ProfileImage from '../ui/ProfileImage';

const DESKTOP_PREVIEW_WIDTH = 1120;
const DESKTOP_PREVIEW_HEIGHT = 440;

const DesktopProfileAppearancePreview = ({
    appearance,
    bannerUrl,
    imageUrl,
    onBannerError,
    profile,
}) => {
    const previewFrameRef = useRef(null);
    const [previewScale, setPreviewScale] = useState(1);
    const hasBanner = Boolean(bannerUrl);
    const hasBio = Boolean(profile.bio?.trim());
    const favoriteGameColor = getGameColor(profile.favoriteGame);
    const followerCount = profile.followers?.length || 0;
    const followingCount = profile.following?.length || 0;
    const activeSocials = SOCIAL_PLATFORMS
        .filter(platform => profile[platform.id]?.trim())
        .slice(0, 5);

    useLayoutEffect(() => {
        const previewFrame = previewFrameRef.current;
        if (!previewFrame) return undefined;

        const updateScale = () => {
            const availableWidth = previewFrame.getBoundingClientRect().width;
            if (availableWidth <= 0) return;
            const nextScale = Math.min(1, availableWidth / DESKTOP_PREVIEW_WIDTH);
            setPreviewScale(Math.round(nextScale * 10000) / 10000);
        };

        updateScale();
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(updateScale);
            observer.observe(previewFrame);
            return () => observer.disconnect();
        }

        window.addEventListener('resize', updateScale);
        return () => window.removeEventListener('resize', updateScale);
    }, []);

    return (
        <div
            ref={previewFrameRef}
            aria-label="Desktop profile appearance preview"
            data-preview-scale={previewScale}
            className="relative w-full overflow-hidden rounded-2xl"
            style={{ aspectRatio: `${DESKTOP_PREVIEW_WIDTH} / ${DESKTOP_PREVIEW_HEIGHT}` }}
        >
            <div
                data-testid="desktop-profile-preview-canvas"
                className={`absolute left-0 top-0 h-[440px] w-[1120px] origin-top-left overflow-hidden rounded-2xl shadow-lg ${
                    hasBanner ? '' : 'bg-white dark:bg-gray-800'
                }`}
                style={
                    hasBanner
                        ? {
                            background: `linear-gradient(135deg, ${appearance.hex}, ${appearance.hoverHex})`,
                            transform: `scale(${previewScale})`,
                        }
                        : { transform: `scale(${previewScale})` }
                }
            >
                {hasBanner && (
                    <img
                        src={bannerUrl}
                        alt="Desktop banner preview"
                        onError={onBannerError}
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                )}
                {hasBanner && (
                    <div className="absolute inset-0 hidden bg-gradient-to-r from-black/75 via-black/45 to-black/65 dark:block" />
                )}

                <div className="relative flex h-full items-start gap-6 p-8">
                    <div className="w-10 flex-shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1 self-stretch">
                        <div
                            className={
                                hasBio
                                    ? 'grid h-full grid-cols-3 items-center gap-6'
                                    : 'flex h-full items-center justify-center'
                            }
                        >
                            <div
                                className={`relative mx-auto mt-12 flex w-full max-w-xs flex-col items-center rounded-[2rem] border-2 px-5 pb-6 pt-20 text-center shadow-xl backdrop-blur-md ${
                                    hasBio ? 'col-start-1' : ''
                                } ${
                                    hasBanner
                                        ? 'bg-black/35'
                                        : 'bg-gray-50/95 dark:bg-gray-900/60'
                                }`}
                                style={{ borderColor: appearance.hex }}
                            >
                                <ProfileImage
                                    src={imageUrl}
                                    alt="Desktop profile preview"
                                    className="absolute -top-16 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full border-4 bg-white object-cover shadow-xl dark:bg-gray-800"
                                    style={{ borderColor: appearance.hex }}
                                />
                                <h2
                                    className={`text-3xl font-bold ${
                                        hasBanner ? 'text-white drop-shadow-sm' : ''
                                    }`}
                                    style={hasBanner ? undefined : { color: appearance.hex }}
                                >
                                    {profile.username || 'Your profile'}
                                </h2>
                                {profile.country && (
                                    <p className={`mt-1 ${hasBanner ? 'text-white/75' : 'text-gray-500 dark:text-gray-400'}`}>
                                        {profile.country}
                                    </p>
                                )}
                                {profile.favoriteGame && (
                                    <p
                                        className="mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium capitalize shadow-sm"
                                        style={{
                                            backgroundColor: favoriteGameColor.hex,
                                            color: getTextColorForBackground(favoriteGameColor.hex),
                                        }}
                                    >
                                        {profile.favoriteGame.replace(/-/g, ' ')}
                                    </p>
                                )}

                                <div className={`mt-4 flex items-center justify-center gap-6 text-sm ${hasBanner ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                                    <span>
                                        <span className="font-bold">{followerCount}</span>{' '}
                                        <span className={hasBanner ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}>
                                            Followers
                                        </span>
                                    </span>
                                    <span>
                                        <span className="font-bold">{followingCount}</span>{' '}
                                        <span className={hasBanner ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}>
                                            Following
                                        </span>
                                    </span>
                                </div>

                                <span className={`mt-6 rounded-xl px-4 py-2 text-sm font-bold ${
                                    hasBanner
                                        ? 'border border-white/20 bg-white/15 text-white backdrop-blur-sm'
                                        : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                                }`}>
                                    Edit Profile
                                </span>
                            </div>

                            {hasBio && (
                                <div
                                    className={`col-span-2 col-start-2 w-full max-w-sm place-self-center rounded-2xl border-2 p-6 text-left shadow-lg backdrop-blur-md ${
                                        hasBanner
                                            ? 'bg-black/35 text-white'
                                            : 'bg-gray-50/90 text-gray-700 dark:bg-gray-900/60 dark:text-gray-200'
                                    }`}
                                    style={{ borderColor: appearance.hex }}
                                >
                                    <p className={`mb-2 text-xs font-bold uppercase tracking-[0.18em] ${
                                        hasBanner ? 'text-white/55' : 'text-gray-400 dark:text-gray-500'
                                    }`}>
                                        About
                                    </p>
                                    <p className={`whitespace-pre-wrap break-words leading-relaxed ${hasBanner ? 'text-white/90' : ''}`}>
                                        {profile.bio}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-shrink-0 flex-col items-center gap-2" aria-label="Profile links preview">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${
                            hasBanner
                                ? 'border border-white/20 bg-black/30 text-white backdrop-blur-sm'
                                : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                            <Icon path={ICONS.share} className="h-5 w-5" />
                        </span>
                        {activeSocials.map(platform => (
                            <span
                                key={platform.id}
                                aria-label={platform.label}
                                className={`flex h-10 w-10 items-center justify-center rounded-full ${
                                    hasBanner
                                        ? 'border border-white/20 bg-black/30 text-white backdrop-blur-sm'
                                        : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                }`}
                            >
                                <Icon path={platform.icon} solid={platform.solid} className="h-5 w-5" />
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DesktopProfileAppearancePreview;
