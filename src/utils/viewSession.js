let memoryToken;
export function getViewSessionToken() {
    try {
        const existing = sessionStorage.getItem('creation-view-session-v2');
        if (/^[a-f0-9]{64}$/.test(existing || '')) return existing;
    } catch { /* Private browsing may deny persistent storage. */ }
    memoryToken ||= [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem('creation-view-session-v2', memoryToken); } catch { /* Session memory still deduplicates. */ }
    return memoryToken;
}
