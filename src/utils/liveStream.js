// Anzeige-Logik für den Live-Status einer Creation. Bewusst ohne
// Firebase-Imports — vollständig unit-testbar und auch von feedRanking nutzbar.
//
// Das liveStream-Feld auf dem Creation-Dokument wird ausschließlich
// server-seitig geschrieben (Callables goLive/endLive + sweepLiveStreams);
// der Client entscheidet hier nur, ob ein vorhandenes Feld noch als "live"
// angezeigt wird. Die Expiry ist das letzte UI-Netz für den Fall, dass
// OBS-Ende, Sweep und Pointer alle versagen (z. B. Client-Crash offline).

export const LIVE_STREAM_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export const LIVE_PLATFORMS = {
    twitch: {
        label: 'Twitch',
        hosts: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
        placeholder: 'https://twitch.tv/yourchannel',
    },
    youtube: {
        label: 'YouTube',
        hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
        placeholder: 'https://youtube.com/watch?v=...',
    },
};

// Client-seitige Vorprüfung (autoritativ verifiziert der Server, dass der
// Stream wirklich läuft): https-Pflicht + Host muss zur Plattform passen.
export function isValidStreamUrl(platform, url) {
    const hosts = LIVE_PLATFORMS[platform]?.hosts;
    if (!hosts || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && hosts.includes(parsed.hostname.toLowerCase());
    } catch (error) {
        return false;
    }
}

const toMillis = (ts) => {
    if (!ts) return null;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return null;
};

// Ein liveStream-Feld gilt als aktiv, solange expiresAt in der Zukunft liegt
// (bzw. ersatzweise startedAt + MAX_AGE). startedAt === null ist der
// latenz-kompensierte eigene Snapshot direkt nach goLive (serverTimestamp noch
// nicht aufgelöst) und zählt als aktiv, damit der Badge nicht flackert.
// url ist bewusst NICHT Pflicht: Suchindex-Einträge tragen nur platform + expiry.
export function isLiveStreamActive(liveStream, now = Date.now()) {
    if (!liveStream || !liveStream.platform) return false;
    const expiresAt = toMillis(liveStream.expiresAt);
    if (expiresAt !== null) return expiresAt > now;
    if (!('startedAt' in liveStream)) return false;
    if (liveStream.startedAt === null) return true;
    const startedAt = toMillis(liveStream.startedAt);
    return startedAt !== null && startedAt + LIVE_STREAM_MAX_AGE_MS > now;
}

// Merkt lokal, welche Creation DIESER Client live geschaltet hat, damit das
// OBS-Stream-Ende (App.js) die richtige Session beenden kann.
export const LIVE_SESSION_KEY = 'pc.liveSession';

export function readLiveSession() {
    try {
        const raw = localStorage.getItem(LIVE_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.creationId ? parsed : null;
    } catch (error) {
        return null;
    }
}

export function setLiveSession(session) {
    try {
        if (session) {
            localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(session));
        } else {
            localStorage.removeItem(LIVE_SESSION_KEY);
        }
    } catch (error) { /* noop */ }
}
