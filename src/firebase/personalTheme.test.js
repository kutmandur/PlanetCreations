import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { updateDoc } from 'firebase/firestore';
import { auth } from './config';
import { savePersonalTheme } from './personalTheme';
import { DEFAULT_PERSONAL_THEME, getActivePersonalTheme, readCachedPersonalTheme, setPersonalThemeUser } from '../utils/personalTheme';

vi.mock('./config', () => ({ auth: { currentUser: { uid: 'alice' } }, db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn((db, ...path) => path.join('/')), updateDoc: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); auth.currentUser = { uid: 'alice' }; setPersonalThemeUser('alice'); });
afterEach(() => setPersonalThemeUser(null));

it('writes once to the private account and caches only after a successful save', async () => {
    let resolveWrite;
    updateDoc.mockReturnValueOnce(new Promise(resolve => { resolveWrite = resolve; }));
    const saving = savePersonalTheme('alice', { cardColor: '#ABCDEF' });
    expect(updateDoc).toHaveBeenCalledExactlyOnceWith('users/alice', { personalTheme: { ...DEFAULT_PERSONAL_THEME, cardColor: '#abcdef' } });
    expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
    resolveWrite();
    await saving;
    expect(readCachedPersonalTheme('alice').cardColor).toBe('#abcdef');
    expect(getActivePersonalTheme().cardColor).toBe('#abcdef');
});
it('leaves the applied theme unchanged after a failed save', async () => {
    updateDoc.mockRejectedValueOnce(new Error('Offline'));
    await expect(savePersonalTheme('alice', { cardColor: '#123456' })).rejects.toThrow('Offline');
    expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
    expect(readCachedPersonalTheme('alice')).toEqual(DEFAULT_PERSONAL_THEME);
});
it('rejects other accounts and invalid links before writing', async () => {
    await expect(savePersonalTheme('bob', {})).rejects.toThrow('sign in');
    await expect(savePersonalTheme('alice', { backgroundUrl: 'javascript:alert(1)' })).rejects.toThrow('Direct Link');
    expect(updateDoc).not.toHaveBeenCalled();
});
it('does not reapply the old account theme when a save completes after logout', async () => {
    let resolveWrite;
    updateDoc.mockReturnValueOnce(new Promise(resolve => { resolveWrite = resolve; }));
    const saving = savePersonalTheme('alice', { cardColor: '#123456' });
    auth.currentUser = null;
    setPersonalThemeUser(null);
    resolveWrite();
    await saving;
    expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
});
