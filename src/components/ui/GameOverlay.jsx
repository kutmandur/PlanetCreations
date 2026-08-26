import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';
import { readOverlayQr, subscribeOverlayQr } from '../../utils/overlayQr';
import { composeSharingQrCanvas } from './SharingQrCode';
import CollaborationOverlayControls from '../collaboration/CollaborationOverlayControls';

export const GameOverlayWidget = ({ unreadCount = 0, activeGameId = null, onOpen = null }) => {
    const [dragging, setDragging] = useState(false);
    const [overlayQr, setOverlayQrState] = useState(() => readOverlayQr());
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const movedRef = useRef(false);
    const startRef = useRef({ x: 0, y: 0 });
    const draggingRef = useRef(false);
    const pendingMoveRef = useRef(null);
    const moveFrameRef = useRef(null);
    const resizeStepsRef = useRef(0);
    const resizeFrameRef = useRef(null);

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
        const flushMove = () => {
            moveFrameRef.current = null;
            if (!pendingMoveRef.current) return;
            window.electronAPI?.moveOverlay?.(pendingMoveRef.current);
            pendingMoveRef.current = null;
        };
        const stopDragging = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            setDragging(false);
            if (moveFrameRef.current !== null) {
                window.cancelAnimationFrame(moveFrameRef.current);
                flushMove();
            }
            window.electronAPI?.endOverlayDrag?.();
        };
        window.addEventListener('mouseup', stopDragging);
        window.addEventListener('blur', stopDragging);
        return () => {
            window.removeEventListener('mouseup', stopDragging);
            window.removeEventListener('blur', stopDragging);
            if (moveFrameRef.current !== null) window.cancelAnimationFrame(moveFrameRef.current);
            if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
        };
    }, []);

    const handleMouseDown = (event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        startRef.current = { x: event.screenX, y: event.screenY };
        movedRef.current = false;
        draggingRef.current = true;
        setDragging(true);
        window.electronAPI?.startOverlayDrag?.({ screenX: event.screenX, screenY: event.screenY });
    };

    const handleMouseMove = (event) => {
        if (!draggingRef.current) return;
        if (Math.abs(event.screenX - startRef.current.x) > 3 || Math.abs(event.screenY - startRef.current.y) > 3) movedRef.current = true;
        pendingMoveRef.current = { screenX: event.screenX, screenY: event.screenY };
        if (moveFrameRef.current === null) {
            moveFrameRef.current = window.requestAnimationFrame(() => {
                moveFrameRef.current = null;
                if (pendingMoveRef.current) window.electronAPI?.moveOverlay?.(pendingMoveRef.current);
                pendingMoveRef.current = null;
            });
        }
    };

    const handleMouseUp = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        setDragging(false);
        if (moveFrameRef.current !== null) {
            window.cancelAnimationFrame(moveFrameRef.current);
            moveFrameRef.current = null;
        }
        if (pendingMoveRef.current) window.electronAPI?.moveOverlay?.(pendingMoveRef.current);
        pendingMoveRef.current = null;
        window.electronAPI?.endOverlayDrag?.();
    };

    const handleWheel = (event) => {
        if (!draggingRef.current) return;
        event.preventDefault();
        resizeStepsRef.current += event.deltaY < 0 ? 1 : -1;
        if (resizeFrameRef.current === null) {
            resizeFrameRef.current = window.requestAnimationFrame(() => {
                resizeFrameRef.current = null;
                const steps = resizeStepsRef.current;
                resizeStepsRef.current = 0;
                if (steps !== 0) window.electronAPI?.resizeOverlay?.(steps);
            });
        }
    };

    const handleClick = () => {
        if (!movedRef.current) {
            window.electronAPI?.setOverlayExpanded?.(true);
            onOpen?.(overlayQr);
        }
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
                    : `${activeGameId ? 'Game detected. ' : ''}Drag to move. Hold and scroll to resize. Click to open PlanetCreations.`}
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

export const GameOverlayChrome = ({
    user,
    activeGameId,
    currentPath,
    onOpenCollaboration,
    setModalMessage,
}) => {
    return (
        <div className="game-overlay-chrome">
            <span className="flex items-center gap-2 font-semibold text-sm">
                <img src="logo.png" alt="" className="w-6 h-6 rounded-full" draggable="false" />
                In-Game Overlay
            </span>
            <CollaborationOverlayControls
                user={user}
                activeGameId={activeGameId}
                currentPath={currentPath}
                onOpenCollaboration={onOpenCollaboration}
                setModalMessage={setModalMessage}
            />
            <button className="game-overlay-collapse" type="button" onClick={() => window.electronAPI?.setOverlayExpanded?.(false)} title="Collapse overlay" aria-label="Collapse overlay">
                <Icon path={ICONS.chevronDown} className="w-5 h-5" />
            </button>
        </div>
    );
};
