import React, { useEffect, useState } from 'react';
import { getActivePersonalTheme, PERSONAL_THEME_EVENT } from '../../utils/personalTheme';

export default function PersonalThemeBackground() {
    const [url, setUrl] = useState(() => getActivePersonalTheme().backgroundUrl);
    const [failedUrl, setFailedUrl] = useState('');
    useEffect(() => {
        const update = () => { setUrl(getActivePersonalTheme().backgroundUrl); setFailedUrl(''); };
        update();
        window.addEventListener(PERSONAL_THEME_EVENT, update);
        return () => window.removeEventListener(PERSONAL_THEME_EVENT, update);
    }, []);
    if (!url || url === failedUrl) return null;
    return <div className="pc-personal-background" aria-hidden="true">
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
        <div className="pc-personal-background-scrim" />
    </div>;
}
