const noopSubscription = () => () => {};

/**
 * Browser-only desktop bridge used by the local Firebase E2E setup.
 *
 * It is unreachable in production and requires both the emulator build flag
 * and an explicit URL query parameter, for example:
 *   http://127.0.0.1:3100/?e2eDesktop=overlay#/collaboration/example
 */
export const installDesktopE2EShim = () => {
    if (
        process.env.NODE_ENV === 'production' ||
        process.env.REACT_APP_USE_FIREBASE_EMULATORS !== 'true' ||
        typeof window === 'undefined' ||
        window.electronAPI
    ) {
        return;
    }

    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get('e2eDesktop') !== 'overlay') return;

    const gameId = parameters.get('e2eGame') || 'planet-coaster-2';
    const saveAgeMs = Math.max(
        0,
        Number(parameters.get('e2eSaveAgeMs')) || 0,
    );
    let overlayExpanded = true;

    window.electronAPI = {
        isElectron: true,
        isGameOverlay: true,
        getActiveGame: async () => gameId,
        onActiveGameChanged: noopSubscription,
        onOverlayModeChanged: (listener) => {
            listener(overlayExpanded);
            return () => {};
        },
        setOverlayExpanded: async (expanded) => {
            overlayExpanded = Boolean(expanded);
            return overlayExpanded;
        },
        onUpdateInfoAvailable: noopSubscription,
        onUpdateDownloaded: noopSubscription,
        onBackupImportStatus: noopSubscription,
        onNavigateToRoute: noopSubscription,
        startOverlayDrag: () => {},
        moveOverlay: () => {},
        endOverlayDrag: () => {},
        resizeOverlay: () => {},
        getLatestCollaborationFile: async (_requestedGameId, expectedFileName) => {
            const modifiedAtMs = Date.now() - saveAgeMs;
            return {
                success: true,
                filePath: `C:\\E2E\\${expectedFileName || 'E2E-Coaster.park2'}`,
                fileName: expectedFileName || 'E2E-Coaster.park2',
                fileSize: 4_194_304,
                modifiedAt: new Date(modifiedAtMs).toISOString(),
                modifiedAtMs,
                ageMs: saveAgeMs,
                stale: saveAgeMs > 2 * 60 * 1000,
                nameMatchesExpected: true,
            };
        },
    };
};
