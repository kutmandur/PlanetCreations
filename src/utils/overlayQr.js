// Shared QR state for the PlanetCreations In-Game Overlay.
// Hauptfenster und Spiel-Overlay laden dieselbe gehostete Origin und teilen sich
// daher localStorage; der BroadcastChannel dient nur als Push-Benachrichtigung.
// localStorage ist die Source of Truth — so übersteht der QR den täglichen
// Overlay-Reload (refreshHostedWebViews). Alle Zugriffe sind try/catch-gekapselt,
// damit der file://-Fallback des Overlays (kein geteilter Storage) stumm zum
// Logo degradiert statt Fehler zu werfen.

export const OVERLAY_QR_KEY = 'pc.overlayQr';
const CHANNEL_NAME = 'pc-overlay';

// Fester Origin: nie window.location verwenden, sonst landet in Dev-Builds
// localhost im QR oder Share-Link. Der serverseitige Share-Endpunkt liefert
// Link-Crawlern Creation-Metadaten und leitet Menschen zur HashRoute weiter.
const PUBLIC_ORIGIN = 'https://www.planetcreations.net';

export const buildCreationShareUrl = (creationId) =>
    `${PUBLIC_ORIGIN}/share/creation/${encodeURIComponent(creationId)}`;

// Gespeicherter Eintrag: { creationId, title, url, source: 'manual'|'goLive'|'remote'|'showcase', enabledAt }
// Showcase-Einträge ergänzen kind/communityId/creationIds/activeCreationId. Die
// drei Basisfelder bleiben absichtlich erhalten, damit das kompakte QR-Widget
// und veröffentlichte Clients weiterhin denselben Vertrag verwenden können.
// null/fehlend = Overlay zeigt das Logo.
export function readOverlayQr() {
    try {
        const raw = localStorage.getItem(OVERLAY_QR_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.creationId && parsed.url ? parsed : null;
    } catch (error) {
        return null;
    }
}

export function setOverlayQr(entry) {
    try {
        if (entry) {
            localStorage.setItem(OVERLAY_QR_KEY, JSON.stringify(entry));
        } else {
            localStorage.removeItem(OVERLAY_QR_KEY);
        }
    } catch (error) { /* Storage blockiert → Feature degradiert stumm */ }
    try {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage({ type: 'overlay-qr-changed' });
        channel.close();
    } catch (error) { /* BroadcastChannel nicht verfügbar */ }
}

// Ruft callback(entry) bei jeder Änderung auf — egal ob sie aus diesem Fenster,
// dem anderen Fenster (BroadcastChannel) oder einem anderen Tab (storage-Event)
// kommt. Es wird immer frisch aus localStorage gelesen, damit beide Signalwege
// denselben Zustand liefern. Gibt eine Unsubscribe-Funktion zurück.
export function subscribeOverlayQr(callback) {
    const notify = () => callback(readOverlayQr());
    let channel = null;
    try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = notify;
    } catch (error) { channel = null; }
    const onStorage = (event) => {
        if (!event.key || event.key === OVERLAY_QR_KEY) notify();
    };
    try { window.addEventListener('storage', onStorage); } catch (error) { /* noop */ }
    return () => {
        try { channel?.close(); } catch (error) { /* noop */ }
        try { window.removeEventListener('storage', onStorage); } catch (error) { /* noop */ }
    };
}
