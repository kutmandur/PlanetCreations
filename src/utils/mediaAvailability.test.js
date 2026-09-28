import { getMediaFilterState, getMediaInstallAvailability } from './mediaAvailability';

const backups = {
    Park: [{ backupType: 'media', mediaSetId: 'set-1', gameId: 'planet-coaster-2' }],
};

test('reports stored media as ready to install', () => {
    expect(getMediaInstallAvailability({ assetCount: 2, storedCount: 2, mediaSetId: 'set-1' }, {}))
        .toEqual({ tone: 'ready', label: 'Ready to install · 2 files' });
});

test('points to a matching media backup when stored files are missing', () => {
    expect(getMediaInstallAvailability(
        { assetCount: 2, storedCount: 1, mediaSetId: 'set-1', gameId: 'planet-coaster-2' }, backups,
    ).tone).toBe('backup');
    expect(getMediaInstallAvailability(
        { assetCount: 2, storedCount: 0, mediaSetId: 'set-1', gameId: 'planet-zoo' }, backups,
    )).toEqual({ tone: 'partial', label: '0 of 2 files stored' });
});

test('reports creations without stored media', () => {
    expect(getMediaInstallAvailability({ assetCount: 0, storedCount: 0 }, backups).tone).toBe('none');
    expect(getMediaInstallAvailability(undefined, null).tone).toBe('none');
});

test('maps each creation to one of the three media filter states', () => {
    expect(getMediaFilterState(true, { assetCount: 0, storedCount: 0 }, {})).toBe('installed');
    expect(getMediaFilterState(false, { assetCount: 1, storedCount: 1 }, {})).toBe('available');
    expect(getMediaFilterState(false, { assetCount: 1, storedCount: 0, mediaSetId: 'set-1', gameId: 'planet-coaster-2' }, backups)).toBe('available');
    expect(getMediaFilterState(false, { assetCount: 1, storedCount: 0 }, {})).toBe('unavailable');
    expect(getMediaFilterState(false, undefined, null)).toBe('unavailable');
});