import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from './config';
import { hydratePersonalTheme, normalizePersonalTheme, validatePersonalTheme } from '../utils/personalTheme';

// One private user-document write per explicit save; no profile/index writes.
export async function savePersonalTheme(uid, value) {
    if (!uid || auth.currentUser?.uid !== uid) throw new Error('Please sign in again before saving your theme.');
    const error = validatePersonalTheme(value);
    if (error) throw new Error(error);
    const theme = normalizePersonalTheme(value);
    await updateDoc(doc(db, 'users', uid), { personalTheme: theme });
    hydratePersonalTheme(uid, theme);
    return theme;
}
