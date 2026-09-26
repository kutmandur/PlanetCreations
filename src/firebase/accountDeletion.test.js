import {beforeEach, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({call: vi.fn(), signOut: vi.fn(), terminate: vi.fn(), clear: vi.fn(), snapshots: vi.fn()}));
vi.mock('./config', () => ({auth: {currentUser: {uid: 'departing'}}, db: {}}));
vi.mock('firebase/functions', () => ({getFunctions: () => ({}), httpsCallable: () => mocks.call}));
vi.mock('firebase/auth', () => ({signOut: mocks.signOut}));
vi.mock('firebase/firestore', () => ({terminate: mocks.terminate, clearIndexedDbPersistence: mocks.clear}));
vi.mock('./indexSnapshotCache', () => ({clearIndexSnapshots: mocks.snapshots}));
import {communityDeletionWarning, requestAccountDeletion, DELETION_RECEIPT_KEY} from './accountDeletion';
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
it('names the communities and explains ownership transfer and preservation of foreign creations', () => {
    const warning = communityDeletionWarning([{id: 'one', name: 'My community'}]);
    expect(warning).toContain('My community');
    expect(warning).toContain('Community Settings');
    expect(warning).toContain("Other users' creations will be kept");
});
it('a lost response preserves the receipt for retry and does not pretend the account was deleted', async () => {
    mocks.call.mockRejectedValue(new Error('network unavailable'));
    await expect(requestAccountDeletion([{id: 'one', name: 'Community'}])).rejects.toThrow('network unavailable');
    const receipt = localStorage.getItem(DELETION_RECEIPT_KEY);
    expect(receipt).toMatch(/^[a-f0-9]{64}$/);
    await expect(requestAccountDeletion([{id: 'one', name: 'Community'}])).rejects.toThrow();
    expect(mocks.call).toHaveBeenLastCalledWith({protocolVersion: 2, receipt, confirmedCommunityIds: ['one']});
    expect(mocks.signOut).not.toHaveBeenCalled();
});
