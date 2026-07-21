// Zentrale App-Refresh-Helfer.
//
// scheduleDataRefresh(): Wird nach dem Speichern/Löschen von Creations, Events
// und Communitys aufgerufen und markiert ALLE React-Query-Caches als stale —
// aktive Seiten (z. B. die Startseite) refetchen sofort, inaktive beim nächsten
// Besuch. Die Verzögerung gibt den serverseitigen Index-Triggern
// (syncCreationToSearchIndex & Co.) Zeit, die Index-Dokumente zu aktualisieren,
// bevor neu gelesen wird. Mehrere Aufrufe kurz nacheinander werden zu einem
// Refresh zusammengefasst.
//
// hardReloadApp(): Manueller Voll-Reload (Navbar-Button) — im Desktop-Client
// unter Umgehung des HTTP-Caches (stale index.html auf IONOS), im Browser ein
// normaler Reload. Ersetzt das Schließen/Neuöffnen der Anwendung.

let registeredClient = null;
let refreshTimer = null;

export const registerQueryClient = (queryClient) => {
    registeredClient = queryClient;
};

export const scheduleDataRefresh = (delayMs = 2500) => {
    if (!registeredClient) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        // Manuell per setQueryData gepflegte Caches (creationCache.js) haben
        // keine queryFn — invalidate ließe sie bestehen, weil die Seiten sie
        // per getQueryData lesen. Sie müssen entfernt werden, damit beim
        // nächsten Seitenaufruf frisch geladen wird.
        for (const key of ['homeCreations', 'communityCreations', 'communityCreationMeta', 'creation']) {
            registeredClient.removeQueries({ queryKey: [key] });
        }
        registeredClient.invalidateQueries();
    }, delayMs);
};

export const hardReloadApp = () => {
    if (window.electronAPI?.reloadWindow) {
        window.electronAPI.reloadWindow().catch(() => window.location.reload());
    } else {
        window.location.reload();
    }
};
