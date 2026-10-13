import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { getFeedPoolLabels, setFeedPoolLabels, useFeedPoolLabels } from './useFeedPoolLabels';
afterEach(() => { cleanup(); localStorage.clear(); });
it('defaults off and stores the preference separately per user', () => {
    expect(getFeedPoolLabels('member')).toBe(false);
    setFeedPoolLabels('member', true);
    expect(getFeedPoolLabels('member')).toBe(true);
    expect(getFeedPoolLabels('other')).toBe(false);
    setFeedPoolLabels('member', false);
    expect(getFeedPoolLabels('member')).toBe(false);
});
it('updates mounted consumers immediately and when changing accounts', () => {
    const { result, rerender } = renderHook(({ uid }) => useFeedPoolLabels(uid), { initialProps: { uid: 'member' } });
    act(() => setFeedPoolLabels('member', true));
    expect(result.current).toBe(true);
    rerender({ uid: 'other' });
    expect(result.current).toBe(false);
});
