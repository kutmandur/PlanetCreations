import { useEffect } from 'react';

const SELECTOR_POP_CLASS = 'pc-selector-pop';
const SELECTOR_INDICATOR =
    ':scope > .absolute.rounded-full.transition-all';

const durationToMilliseconds = (duration) => {
    const value = Number.parseFloat(duration);
    if (!Number.isFinite(value)) return 0;
    return duration.trim().endsWith('ms') ? value : value * 1000;
};

const replayAnimation = (element, className) => {
    const transitionDuration = Math.max(
        0,
        ...getComputedStyle(element).transitionDuration
            .split(',')
            .map(durationToMilliseconds),
    );
    element.style.setProperty(
        '--pc-selector-slide-duration',
        `${transitionDuration}ms`,
    );
    element.classList.remove(className);
    // Restart the one-shot animation even when tabs are changed rapidly.
    void element.offsetWidth;
    element.classList.add(className);
};

export default function useMicroInteractionFeedback() {
    useEffect(() => {
        const pendingIndicators = new Map();

        const handleClick = (event) => {
            if (!(event.target instanceof Element)) return;

            const button = event.target.closest('button');
            if (!button || button.disabled) return;

            const indicator = button.parentElement?.querySelector(
                SELECTOR_INDICATOR,
            );
            if (!indicator) return;

            const previousListener = pendingIndicators.get(indicator);
            if (previousListener) {
                indicator.removeEventListener(
                    'transitionrun',
                    previousListener,
                );
            }

            const handleTransitionRun = (transitionEvent) => {
                if (
                    transitionEvent.target !== indicator ||
                    !['left', 'width'].includes(transitionEvent.propertyName)
                ) {
                    return;
                }
                indicator.removeEventListener(
                    'transitionrun',
                    handleTransitionRun,
                );
                pendingIndicators.delete(indicator);
                replayAnimation(indicator, SELECTOR_POP_CLASS);
            };

            pendingIndicators.set(indicator, handleTransitionRun);
            indicator.addEventListener(
                'transitionrun',
                handleTransitionRun,
            );
        };

        // Capture runs before React's click handler changes the indicator
        // position, so the transition listener is ready for the first frame.
        document.addEventListener('click', handleClick, true);
        return () => {
            document.removeEventListener('click', handleClick, true);
            pendingIndicators.forEach((listener, indicator) => {
                indicator.removeEventListener('transitionrun', listener);
            });
        };
    }, []);
}
