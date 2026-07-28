import { getFunctions, httpsCallable } from 'firebase/functions';

export const isDiscordAuthorizationUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
            url.hostname === 'discord.com' &&
            url.pathname === '/api/oauth2/authorize';
    } catch (error) {
        return false;
    }
};

export const requestDiscordLinkUrl = async () => {
    const startDiscordLink = httpsCallable(getFunctions(), 'startDiscordLink');
    const result = await startDiscordLink();
    const authUrl = result?.data?.authUrl;
    if (!isDiscordAuthorizationUrl(authUrl)) {
        throw new Error('The server returned an invalid Discord authorization URL.');
    }
    return authUrl;
};

export const openDiscordLink = async () => {
    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    const pendingWindow = isElectron
        ? null
        : window.open('about:blank', '_blank');
    if (pendingWindow) {
        pendingWindow.opener = null;
        pendingWindow.document.title = 'Connecting Discord…';
        pendingWindow.document.body.textContent =
            'Preparing the secure Discord connection…';
    }
    try {
        const authUrl = await requestDiscordLinkUrl();
        if (isElectron) {
            window.open(authUrl, '_blank', 'noopener,noreferrer');
        } else if (pendingWindow && !pendingWindow.closed) {
            pendingWindow.location.replace(authUrl);
        } else {
            window.location.assign(authUrl);
        }
    } catch (error) {
        pendingWindow?.close();
        throw error;
    }
};

export const unlinkDiscordAccount = async () => {
    const unlinkDiscord = httpsCallable(
        getFunctions(),
        'unlinkDiscordAccount',
    );
    const result = await unlinkDiscord();
    return result.data;
};
