import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';
import { readOverlayQr, subscribeOverlayQr } from '../../utils/overlayQr';
import { composeSharingQrCanvas } from './SharingQrCode';

export const GameOverlayWidget = ({ unreadCount = 0 }) => {
    const [dragging, setDragging] = useState(false);
    const [overlayQr, setOverlayQrState] = useState(() => readOverlayQr());
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const movedRef = useRef(false);
    const startRef = useRef({ x: 0, y: 0 });

    useEffect(() => subscribeOverlayQr(setOverlayQrState), []);

    // Das voll assemblierte Sharing-Bild (Template + QR + Creation-Name) einmal
    // in voller Auflösung (1254px) komponieren und vom Browser herunterskalieren
    // lassen — bleibt beim Puck-Resize scharf, ohne pro Resize neu zu rendern.
    useEffect(() => {
        let cancelled = false;
        if (!overlayQr?.url) {
            setQrDataUrl(null);
            return undefined;
        }
        composeSharingQrCanvas(overlayQr.url, overlayQr.title || '')
            .then((canvas) => { if (!cancelled) setQrDataUrl(canvas.toDataURL('image/png')); })
            .catch(() => { if (!cancelled) setQrDataUrl(null); });
        return () => { cancelled = true; };
    }, [overlayQr?.url, overlayQr?.title]);

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
                title={qrDataUrl && overlayQr
                    ? `QR code for "${overlayQr.title || 'your creation'}" — scan to open it. Drag to move. Hold and scroll to resize (bigger scans easier). Click to open PlanetCreations.`
                    : 'Drag to move. Hold and scroll to resize. Click to open PlanetCreations.'}
                aria-label="Open PlanetCreations overlay"
            >
                {qrDataUrl && overlayQr ? (
                    <img src={qrDataUrl} alt="" draggable="false" className="game-overlay-qr" />
                ) : (
                    <img src="logo.png" alt="" draggable="false" />
                )}
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
