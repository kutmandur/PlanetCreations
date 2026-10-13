import React, { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS, SOCIAL_PLATFORMS } from '../../utils/helpers';
import { getDiscordProfileUrl } from '../../utils/discordProfile';

const platform = SOCIAL_PLATFORMS.find(item => item.id === 'discord');

export default function DiscordProfileLink({ value, hasProfileBanner, themeHex }) {
    const [status, setStatus] = useState('');
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const username = String(value || '').trim();
    const href = getDiscordProfileUrl(username);
    const className = `relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:text-white ${hasProfileBanner ? 'border border-white/20 bg-black/30 text-white backdrop-blur-sm' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`;
    const hover = {
        onMouseEnter: event => { event.currentTarget.style.backgroundColor = themeHex; },
        onMouseLeave: event => { event.currentTarget.style.backgroundColor = ''; },
    };
    const copy = async () => {
        clearTimeout(timer.current);
        setStatus('');
        let copied = false;
        try { await navigator.clipboard.writeText(username); copied = true; } catch {
            const previousFocus = document.activeElement;
            const field = document.createElement('textarea');
            field.value = username;
            field.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(field);
            try { field.select(); copied = document.execCommand('copy'); } catch { /* Show failure below. */ }
            finally { field.remove(); previousFocus?.focus?.(); }
        }
        setStatus(copied ? 'Copied!' : 'Copy failed. Try again.');
        timer.current = setTimeout(() => setStatus(''), 2500);
    };
    if (href) return <a href={href} target="_blank" rel="noopener noreferrer" title="Discord" aria-label="Discord" className={className} {...hover}><Icon path={platform.icon} solid={platform.solid} className="h-5 w-5" /></a>;
    return <span className="relative inline-flex flex-shrink-0">
        <button type="button" onClick={copy} title={`Copy Discord username: ${username}`} aria-label={`Copy Discord username: ${username}`} className={className} {...hover}>
            <Icon path={status === 'Copied!' ? ICONS.check : platform.icon} solid={status === 'Copied!' ? false : platform.solid} className="h-5 w-5" />
        </button>
        <span role="status" className={status ? 'pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs font-semibold text-white shadow-lg' : 'sr-only'}>{status}</span>
    </span>;
}
