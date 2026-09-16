import {test, expect, vi} from 'vitest';
import {reloadAfterChunkFailure} from './chunkRecovery';

test('a missing chunk reloads once across page instances, then allows a later retry', () => {
    const values = new Map();
    const sessionStorage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)};
    const first = {sessionStorage, location: {reload: vi.fn()}};
    expect(reloadAfterChunkFailure({browserWindow: first, now: 20000})).toBe(true);
    const next = {sessionStorage, location: {reload: vi.fn()}};
    expect(reloadAfterChunkFailure({browserWindow: next, now: 20001})).toBe(false);
    expect(next.location.reload).not.toHaveBeenCalled();
    expect(reloadAfterChunkFailure({browserWindow: next, now: 30001})).toBe(true);
});

test('blocked or silently discarded session storage cannot cause an endless reload', () => {
    const reload = vi.fn();
    expect(reloadAfterChunkFailure({browserWindow: {get sessionStorage() {throw Error('blocked');}, location: {reload}}})).toBe(false);
    expect(reloadAfterChunkFailure({browserWindow: {sessionStorage: {getItem: () => null, setItem: () => {}}, location: {reload}}})).toBe(false);
    expect(reload).not.toHaveBeenCalled();
});
