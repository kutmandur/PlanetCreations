const RESIZE_SETTLE_DELAY_MS = 120;
const RESIZING_CLASS = 'pc-window-resizing';

export function installWindowResizeMotionGuard(
    targetWindow = window,
    root = document.documentElement,
    settleDelayMs = RESIZE_SETTLE_DELAY_MS,
) {
    let settleTimer = null;
    let resizing = false;

    const finishResize = () => {
        settleTimer = null;
        resizing = false;
        root.classList.remove(RESIZING_CLASS);
    };

    const handleResize = () => {
        if (!resizing) {
            resizing = true;
            root.classList.add(RESIZING_CLASS);
        }
        if (settleTimer !== null) targetWindow.clearTimeout(settleTimer);
        settleTimer = targetWindow.setTimeout(finishResize, settleDelayMs);
    };

    targetWindow.addEventListener('resize', handleResize, { passive: true });

    return () => {
        targetWindow.removeEventListener('resize', handleResize);
        if (settleTimer !== null) targetWindow.clearTimeout(settleTimer);
        finishResize();
    };
}
