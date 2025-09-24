import { db } from './config';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

export const fetchAllCommunities = async () => {
    const q = query(collection(db, 'communitys'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// ✅ ADDED: Function to fetch a single community by its URL slug
export const fetchCommunityBySlug = async (slug) => {
    if (!slug) return null;
    const q = query(collection(db, 'communitys'), where('slug', '==', slug), limit(1));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
        throw new Error("Community not found.");
    }
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
};