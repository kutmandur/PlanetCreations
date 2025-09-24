import { db } from './config';
import { collection, query, where, orderBy, startAfter, limit, getDocs, doc, getDoc } from 'firebase/firestore';

const ITEMS_PER_PAGE = 12;

export const fetchCreations = async ({ pageParam = null, queryKey }) => {
    const [, activeTab, sortBy] = queryKey;
    const [sortField, sortDirection] = sortBy.split('_');
    let creationsQuery = query(
        collection(db, 'creations'),
        where('game', '==', activeTab),
        orderBy(sortField, sortDirection || 'desc'),
        limit(ITEMS_PER_PAGE)
    );
    if (pageParam) {
        creationsQuery = query(creationsQuery, startAfter(pageParam));
    }
    const snapshot = await getDocs(creationsQuery);
    const creations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return {
        creations,
        lastVisible: snapshot.docs[snapshot.docs.length - 1],
    };
};

// ✅ ADDED: Function to fetch a single creation document
export const fetchCreationById = async (creationId) => {
    if (!creationId) return null;
    const docRef = doc(db, 'creations', creationId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
    }
    throw new Error("Creation not found.");
};