import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// The app scrolls inside <main>, so browser window scroll restoration cannot help.
export default function useRouteScrollRestoration() {
    const { key } = useLocation();
    const navigationType = useNavigationType();
    const positions = useRef(new Map());
    const [element, setElement] = useState(null);

    useLayoutEffect(() => {
        if (!element) return undefined;
        const target = navigationType === 'POP' ? positions.current.get(key) || 0 : 0;
        let restoring = target > 0;
        let lastPosition = target;
        let frame;
        const restore = () => {
            if (!restoring) return;
            // Clamping to the current bottom also activates the list's load-more sentinel.
            element.scrollTop = target;
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(restore);
        };
        const onScroll = () => {
            if (!restoring) lastPosition = element.scrollTop;
        };
        const stop = () => {
            restoring = false;
            lastPosition = element.scrollTop;
            cancelAnimationFrame(frame);
        };
        const onKey = event => {
            if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) stop();
        };
        element.scrollTop = target;
        // Async page data, further pages and late image sizes can all change the height.
        const mutations = new MutationObserver(schedule);
        mutations.observe(element, { childList: true, subtree: true });
        element.addEventListener('load', schedule, true);
        element.addEventListener('scroll', onScroll, { passive: true });
        element.addEventListener('wheel', stop, { passive: true });
        element.addEventListener('touchstart', stop, { passive: true });
        element.addEventListener('pointerdown', stop, { passive: true });
        window.addEventListener('keydown', onKey);
        const timer = setTimeout(stop, 15000);
        return () => {
            positions.current.set(key, restoring ? target : lastPosition);
            clearTimeout(timer);
            cancelAnimationFrame(frame);
            mutations.disconnect();
            element.removeEventListener('load', schedule, true);
            element.removeEventListener('scroll', onScroll);
            element.removeEventListener('wheel', stop);
            element.removeEventListener('touchstart', stop);
            element.removeEventListener('pointerdown', stop);
            window.removeEventListener('keydown', onKey);
        };
    }, [element, key, navigationType]);

    return setElement;
}
