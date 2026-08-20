import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installWindowResizeMotionGuard } from './windowResizeMotion';

describe('window resize motion guard', () => {
    let cleanup;

    beforeEach(() => {
        vi.useFakeTimers();
        cleanup = installWindowResizeMotionGuard(window, document.documentElement, 120);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    test('suppresses motion until resizing has settled', () => {
        window.dispatchEvent(new Event('resize'));
        expect(document.documentElement).toHaveClass('pc-window-resizing');

        vi.advanceTimersByTime(119);
        expect(document.documentElement).toHaveClass('pc-window-resizing');

        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(119);
        expect(document.documentElement).toHaveClass('pc-window-resizing');

        vi.advanceTimersByTime(1);
        expect(document.documentElement).not.toHaveClass('pc-window-resizing');
    });

    test('cleanup removes the class and listener', () => {
        window.dispatchEvent(new Event('resize'));
        cleanup();
        cleanup = () => {};

        expect(document.documentElement).not.toHaveClass('pc-window-resizing');
        window.dispatchEvent(new Event('resize'));
        expect(document.documentElement).not.toHaveClass('pc-window-resizing');
    });
});
