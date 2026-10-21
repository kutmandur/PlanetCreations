import React, { useEffect, useRef, useState } from 'react';

export default function OverlaySurface({ children }) {
    const [layout, setLayout] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const gesture = useRef(null);
    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.isGameOverlay || !api.getOverlaySurface) return undefined;
        let active = true;
        const stopLayout = api.onOverlaySurfaceChanged?.(value => { if (active) setLayout(value); });
        const stopMode = api.onOverlayModeChanged?.(value => { if (active) setExpanded(value); });
        api.getOverlaySurface().then(value => { if (active) setLayout(value); }).catch(() => {});
        api.getOverlayExpanded?.().then(value => { if (active) setExpanded(value); });
        return () => { active = false; stopLayout?.(); stopMode?.(); };
    }, []);

    if (!layout) return children;
    const stop = () => {
        if (gesture.current?.type === 'move') window.electronAPI?.endOverlayDrag?.();
        gesture.current = null;
    };
    return <div className="overlay-surface-content" style={{
        left: layout.x, top: layout.y, width: layout.width, height: layout.height,
    }} onPointerDown={event => {
        if (event.button !== 0 || !event.target.closest('.game-overlay-chrome') ||
            event.target.closest('button, input, a, select, [data-overlay-interactive]')) return;
        gesture.current = { type: 'move' };
        event.currentTarget.setPointerCapture(event.pointerId);
        window.electronAPI?.startOverlayDrag?.({ screenX: event.screenX, screenY: event.screenY });
    }} onPointerMove={event => {
        const current = gesture.current;
        if (current?.type === 'move') window.electronAPI?.moveOverlay?.({ screenX: event.screenX, screenY: event.screenY });
        if (current?.type === 'resize') window.electronAPI?.resizeOverlayPanel?.({
            width: current.width + event.screenX - current.x,
            height: current.height + event.screenY - current.y,
        });
    }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
        {children}
        {expanded && <button className="overlay-surface-resize" aria-label="Resize overlay panel" title="Drag to resize overlay panel"
            onPointerDown={event => {
                if (event.button !== 0) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                gesture.current = { type: 'resize', x: event.screenX, y: event.screenY, width: layout.width, height: layout.height };
            }} onKeyDown={event => {
                const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
                if (!delta) return;
                event.preventDefault();
                window.electronAPI?.resizeOverlayPanel?.({ width: layout.width + delta[0], height: layout.height + delta[1] });
            }}>◢</button>}
    </div>;
}
