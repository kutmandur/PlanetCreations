import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Returns a CSS `bottom` value for a fixed floating button that keeps it at its
// base offset normally, but lifts it above the page <footer> when they would
// overlap (e.g. when scrolled to the bottom). Recomputes on scroll, resize and
// route change.
export function useFooterAwareBottom(baseRem = 2, gapPx = 16) {
    const [bottom, setBottom] = useState(`${baseRem}rem`);
    const location = useLocation();

    useEffect(() => {
        const basePx = baseRem * 16;
        const update = () => {
            const footer = document.querySelector('footer');
            if (!footer) { setBottom(`${basePx}px`); return; }
            const rect = footer.getBoundingClientRect();
            // How far the footer has entered the viewport from the bottom.
            const overlap = window.innerHeight - rect.top;
            setBottom(`${Math.max(basePx, overlap + gapPx)}px`);
        };
        update();
        const settle = setTimeout(update, 150); // after layout/route settles
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => {
            clearTimeout(settle);
            window.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, [baseRem, gapPx, location.pathname]);

    return bottom;
}
