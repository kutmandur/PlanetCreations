import { beforeEach, describe, expect, test } from 'vitest';
import {
    generalOverlayNotificationsMuted,
    readGeneralOverlayNotificationPrefs,
    readStreamSession,
    setGeneralOverlayNotificationPrefs,
    setStreamSession,
} from './streamSession';

describe('stream session client mirror', () => {
    beforeEach(() => localStorage.clear());

    test('stores only active sessions', () => {
        setStreamSession({ sessionId: 'session-1', status: 'active', creationId: 'creation-1' });
        expect(readStreamSession()?.creationId).toBe('creation-1');
        setStreamSession(null);
        expect(readStreamSession()).toBeNull();
    });

    test('general notification preferences are device local', () => {
        setGeneralOverlayNotificationPrefs({ mutedUntil: 2_000 });
        const prefs = readGeneralOverlayNotificationPrefs();
        expect(generalOverlayNotificationsMuted(prefs, 1_999)).toBe(true);
        expect(generalOverlayNotificationsMuted(prefs, 2_001)).toBe(false);
    });
});
