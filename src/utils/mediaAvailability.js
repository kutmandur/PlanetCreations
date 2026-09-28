// Was beim Einschalten installiert werden kann, solange die Medien deinstalliert sind.
export const getMediaInstallAvailability = (availability, allBackups) => {
    const assetCount = availability?.assetCount || 0;
    const storedCount = availability?.storedCount || 0;
    if (assetCount > 0 && storedCount === assetCount) {
        return { tone: 'ready', label: `Ready to install · ${assetCount} file${assetCount === 1 ? '' : 's'}` };
    }
    const hasMatchingBackup = Boolean(availability?.mediaSetId) && Object.values(allBackups || {}).flat().some(backup =>
        backup?.backupType === 'media' && backup.mediaSetId === availability.mediaSetId &&
        (!availability.gameId || backup.gameId === availability.gameId));
    if (assetCount > 0 && hasMatchingBackup) return { tone: 'backup', label: 'Restorable from backup' };
    if (assetCount > 0) return { tone: 'partial', label: `${storedCount} of ${assetCount} files stored` };
    return { tone: 'none', label: 'No media stored' };
};

// Die drei Filterzustände im Media Manager. "backup" zählt als installierbar,
// weil der Schalter die Medien dann aus dem passenden Backup wiederherstellt.
export const MEDIA_STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'Show All (Default)' },
    { value: 'installed', label: 'Installed' },
    { value: 'available', label: 'Ready to install' },
    { value: 'unavailable', label: 'No media available' },
];

export const getMediaFilterState = (isInstalled, availability, allBackups) => {
    if (isInstalled) return 'installed';
    const { tone } = getMediaInstallAvailability(availability, allBackups);
    return tone === 'ready' || tone === 'backup' ? 'available' : 'unavailable';
};

// Dunkle Töne für den hellen Offline Manager, helle Töne im Dark Mode. Bei Custom
// Themes überschreibt .pc-status-text die Textfarbe; der Punkt trägt dann die Farbe.
export const MEDIA_AVAILABILITY_STYLES = {
    ready: { text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
    backup: { text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
    partial: { text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
    none: { text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-400' },
};
