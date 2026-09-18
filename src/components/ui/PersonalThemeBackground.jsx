import React, { useEffect, useState } from 'react';
import { getActivePersonalTheme, PERSONAL_THEME_EVENT, resolvePersonalThemeBackground } from '../../utils/personalTheme';

const PORTRAIT_QUERY = '(orientation: portrait)';
const isPortrait = () => window.matchMedia?.(PORTRAIT_QUERY).matches ?? window.innerHeight >= window.innerWidth;

export default function PersonalThemeBackground() {
    const [theme, setTheme] = useState(getActivePersonalTheme);
    const [portrait, setPortrait] = useState(isPortrait);
    const [failedUrls, setFailedUrls] = useState([]);
    useEffect(() => {
        const update = () => { setTheme(getActivePersonalTheme()); setFailedUrls([]); };
        update();
        window.addEventListener(PERSONAL_THEME_EVENT, update);
        return () => window.removeEventListener(PERSONAL_THEME_EVENT, update);
    }, []);
    useEffect(() => {
        // Match the window's aspect ratio, not device type or screen rotation.
        // This also covers narrow desktop windows without polling or cloud I/O.
        const media = window.matchMedia?.(PORTRAIT_QUERY);
        const update = () => setPortrait(media ? media.matches : isPortrait());
        update();
        if (media) {
            media.addEventListener('change', update);
            return () => media.removeEventListener('change', update);
        }
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);
    const url = resolvePersonalThemeBackground(theme, portrait, failedUrls);
    if (!url) return null;
    return <div className="pc-personal-background" aria-hidden="true">
        <img key={url} src={url} alt="" referrerPolicy="no-referrer"
            onError={() => setFailedUrls(previous => previous.includes(url) ? previous : [...previous, url])} />
        <div className="pc-personal-background-scrim" />
    </div>;
}
