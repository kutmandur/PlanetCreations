import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';

export const GameOverlayWidget = ({ unreadCount = 0 }) => {
    const [dragging, setDragging] = useState(false);
    const movedRef = useRef(false);
    const startRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const stopDragging = () => {
            setDragging(false);
            window.electronAPI?.endOverlayDrag?.();
        };
        window.addEventListener('mouseup', stopDragging);
        window.addEventListener('blur', stopDragging);
        return () => {
            window.removeEventListener('mouseup', stopDragging);
            window.removeEventListener('blur', stopDragging);
        };
    }, []);

    const handleMouseDown = (event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        startRef.current = { x: event.screenX, y: event.screenY };
        movedRef.current = false;
        setDragging(true);
        window.electronAPI?.startOverlayDrag?.({ screenX: event.screenX, screenY: event.screenY });
    };

    const handleMouseMove = (event) => {
        if (!dragging) return;
        if (Math.abs(event.screenX - startRef.current.x) > 3 || Math.abs(event.screenY - startRef.current.y) > 3) movedRef.current = true;
        window.electronAPI?.moveOverlay?.({ screenX: event.screenX, screenY: event.screenY });
    };

    const handleMouseUp = () => {
        setDragging(false);
        window.electronAPI?.endOverlayDrag?.();
    };

    const handleWheel = (event) => {
        if (!dragging) return;
        event.preventDefault();
        window.electronAPI?.resizeOverlay?.(event.deltaY < 0 ? 1 : -1);
    };

    const handleClick = () => {
        if (!movedRef.current) window.electronAPI?.setOverlayExpanded?.(true);
    };

    return (
        <div className="game-overlay-stage">
            <button
                type="button"
                className={`game-overlay-logo ${dragging ? 'is-dragging' : ''} ${unreadCount > 0 ? 'has-notifications' : ''}`}
                onPointerDown={handleMouseDown}
                onPointerMove={handleMouseMove}
                onPointerUp={handleMouseUp}
                onWheel={handleWheel}
                onClick={handleClick}
                title="Drag to move. Hold and scroll to resize. Click to open PlanetCreations."
                aria-label="Open PlanetCreations overlay"
            >
                <img src="logo.png" alt="" draggable="false" />
                {unreadCount > 0 && (
                    <span className="game-overlay-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
            </button>
        </div>
    );
};

export const GameOverlayChrome = () => {
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        const stopDragging = () => {
            setDragging(false);
            window.electronAPI?.endOverlayDrag?.();
        };
        window.addEventListener('mouseup', stopDragging);
        window.addEventListener('blur', stopDragging);
        return () => {
            window.removeEventListener('mouseup', stopDragging);
            window.removeEventListener('blur', stopDragging);
        };
    }, []);

    return (
        <div
            className="game-overlay-chrome"
            onPointerDown={(event) => {
                if (event.button !== 0 || event.target.closest('button')) return;
                setDragging(true);
                window.electronAPI?.startOverlayDrag?.({ screenX: event.screenX, screenY: event.screenY });
            }}
            onPointerMove={(event) => {
                if (dragging) window.electronAPI?.moveOverlay?.({ screenX: event.screenX, screenY: event.screenY });
            }}
            onPointerUp={() => {
                setDragging(false);
                window.electronAPI?.endOverlayDrag?.();
            }}
        >
            <span className="flex items-center gap-2 font-semibold text-sm">
                <img src="logo.png" alt="" className="w-6 h-6 rounded-full" draggable="false" />
                In-game Overlay
            </span>
            <button type="button" onClick={() => window.electronAPI?.setOverlayExpanded?.(false)} title="Collapse overlay" aria-label="Collapse overlay">
                <Icon path={ICONS.chevronDown} className="w-5 h-5" />
            </button>
        </div>
    );
};
