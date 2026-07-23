import Fuse from 'fuse.js';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './config';

const CACHE_TTL_MS = 15 * 60 * 1000;

let cachedUsers = null;
let cacheExpiresAt = 0;
let pendingFetch = null;

export function entryToUser(id, entry) {
    return {
        id,
        username: entry.un || '',
        username_lowercase: entry.ul || (entry.un || '').toLowerCase(),
        profilePictureUrl: entry.up || null,
        avatar: entry.up || null,
        role: entry.r || 'user',
    };
}

/**
 * Loads the compact global user index with one Firestore document read.
 * A small module cache also protects non-React callers such as invite modals
 * from re-reading the document on every debounced keystroke.
 */
export async function fetchUserSearchIndex() {
    if (cachedUsers && Date.now() < cacheExpiresAt) return cachedUsers;
    if (pendingFetch) return pendingFetch;

    pendingFetch = getDoc(doc(db, 'userSearchIndex', 'all'))
        .then(snapshot => {
            const entries = snapshot.exists() ? snapshot.data().entries || {} : {};
            cachedUsers = Object.entries(entries).map(([id, entry]) => entryToUser(id, entry));
            cacheExpiresAt = Date.now() + CACHE_TTL_MS;
            return cachedUsers;
        })
        .finally(() => {
            pendingFetch = null;
        });

    return pendingFetch;
}

export function searchUserIndex(users, searchTerm, limitCount = 10) {
    const normalizedTerm = String(searchTerm || '').trim().toLowerCase();
    if (!normalizedTerm || !Array.isArray(users)) return [];

    // Preserve every result the old Firestore prefix query returned and put
    // exact/prefix matches before additional fuzzy or substring matches.
    const prefixMatches = users
        .filter(user => user.username_lowercase.startsWith(normalizedTerm))
        .sort((a, b) => {
            const aExact = a.username_lowercase === normalizedTerm ? 0 : 1;
            const bExact = b.username_lowercase === normalizedTerm ? 0 : 1;
            return aExact - bExact || a.username.localeCompare(b.username);
        });

    if (prefixMatches.length >= limitCount) {
        return prefixMatches.slice(0, limitCount);
    }

    const prefixIds = new Set(prefixMatches.map(user => user.id));
    const fuse = new Fuse(users, {
        keys: ['username', 'username_lowercase'],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: Math.min(2, normalizedTerm.length),
    });
    const fuzzyMatches = fuse.search(normalizedTerm)
        .map(result => result.item)
        .filter(user => !prefixIds.has(user.id));

    return [...prefixMatches, ...fuzzyMatches].slice(0, limitCount);
}

export async function searchUsers(searchTerm, limitCount = 10) {
    const users = await fetchUserSearchIndex();
    return searchUserIndex(users, searchTerm, limitCount);
}
