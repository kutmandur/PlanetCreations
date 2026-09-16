export const platformFromObsService = (service) => {
    if (typeof service !== 'string') return null;
    if (/twitch/i.test(service)) return 'twitch';
    if (/youtube/i.test(service)) return 'youtube';
    return null;
};
