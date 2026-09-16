const memory = new Map();
const database = () => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const request = indexedDB.open('planetcreations-index-snapshots-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(null);
});
export async function readIndexSnapshot(key) {
    if (memory.has(key)) return memory.get(key);
    let db;
    try {
        db = await database();
        if (!db) return null;
        return await new Promise((resolve, reject) => {
            const request = db.transaction('snapshots').objectStore('snapshots').get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch { return null; } finally { db?.close(); }
}
export async function saveIndexSnapshot(key, value) {
    memory.delete(key); memory.set(key, value);
    while (memory.size > 8) memory.delete(memory.keys().next().value);
    let db;
    try {
        db = await database(); if (!db) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction('snapshots', 'readwrite');
            const store = tx.objectStore('snapshots');
            store.put(value, key);
            const keys = store.getAllKeys();
            keys.onsuccess = () => { for (const old of keys.result.filter(k => k !== key).slice(0, Math.max(0, keys.result.length - 30))) store.delete(old); };
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
    } catch { /* A full/disabled cache must not prevent loading the complete index. */ }
    finally { db?.close(); }
}
