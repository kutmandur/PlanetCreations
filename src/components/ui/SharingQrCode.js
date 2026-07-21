import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import template from '../../assets/qr-share-template.png';
import Spinner from './Spinner';

// Branded, fully client-side sharing QR code. Composes the static template PNG +
// a dynamic QR code (of `url`) + `name` on a canvas. Nothing is uploaded — the PNG
// only ever exists in the browser. The preview is an <img> of the composed PNG so
// a browser right-click → "Save image as" grabs the full image.

// Template is 1254×1254. Coordinates measured from the template: the white QR
// frame is centered at (627, 562); the green separator line is at y≈1084.
const TEMPLATE_SIZE = 1254;
const QR = { cx: 627, cy: 562, size: 470 };
const NAME_BAND = { cx: 627, top: 1094, width: 928, height: 118 };
const NAME_COLOR = '#2b6cb0';
const FONT_STACK = `'Poppins', 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif`;

// Only offer the native share sheet on touch/mobile devices — on desktop the
// button should always start a normal file download, not open the OS share menu.
const isMobileDevice = () => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return true;
    return (navigator.maxTouchPoints || 0) > 1
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
};

const sanitizeFilename = (name) =>
    (name || 'planetcreations')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60) || 'planetcreations';

const wrapLines = (ctx, text, maxWidth, fontSize) => {
    ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
    const words = String(text).trim().split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (!cur || ctx.measureText(test).width <= maxWidth) cur = test;
        else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
};

const fitName = (ctx, text, maxWidth, maxHeight, maxFont = 88, minFont = 24) => {
    for (let fs = maxFont; fs >= minFont; fs -= 2) {
        const lineHeight = fs * 1.18;
        const lines = wrapLines(ctx, text, maxWidth, fs);
        if (lines.length <= 2 &&
            lines.every((l) => ctx.measureText(l).width <= maxWidth) &&
            lines.length * lineHeight <= maxHeight) {
            return { lines, fontSize: fs, lineHeight };
        }
    }
    const lineHeight = minFont * 1.18;
    const lines = wrapLines(ctx, text, maxWidth, minFont).slice(0, 2);
    return { lines, fontSize: minFont, lineHeight };
};

const SharingQrCode = ({
    url,
    name,
    fileLabel,
    heading = 'Share via QR Code',
    previewClassName = 'max-w-[160px]',
    containerClassName = 'mt-4',
    copyLabel = 'Copy Link',
}) => {
    const offscreenRef = useRef(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [errorMsg, setErrorMsg] = useState('');
    const [copied, setCopied] = useState(false);
    const copyTimerRef = useRef(null);

    useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

    useEffect(() => {
        let cancelled = false;
        if (!url) { setStatus('error'); return; }

        const compose = async () => {
            setStatus('loading');
            try {
                if (document.fonts?.ready) { try { await document.fonts.ready; } catch (e) { /* ignore */ } }

                const canvas = document.createElement('canvas');
                canvas.width = TEMPLATE_SIZE;
                canvas.height = TEMPLATE_SIZE;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('2D canvas context unavailable');

                const bg = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = template;
                });
                if (cancelled) return;
                ctx.clearRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
                ctx.drawImage(bg, 0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);

                const qrDataUrl = await QRCode.toDataURL(url, {
                    errorCorrectionLevel: 'H',
                    margin: 2,
                    width: QR.size,
                    color: { dark: '#000000', light: '#ffffff' },
                });
                if (cancelled) return;
                const qrImg = await new Promise((resolve, reject) => {
                    const im = new Image();
                    im.onload = () => resolve(im);
                    im.onerror = reject;
                    im.src = qrDataUrl;
                });
                if (cancelled) return;
                ctx.drawImage(qrImg, QR.cx - QR.size / 2, QR.cy - QR.size / 2, QR.size, QR.size);

                const label = (name || '').trim();
                if (label) {
                    const { lines, fontSize, lineHeight } = fitName(ctx, label, NAME_BAND.width, NAME_BAND.height);
                    ctx.fillStyle = NAME_COLOR;
                    ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const bandCenterY = NAME_BAND.top + NAME_BAND.height / 2;
                    const totalH = lines.length * lineHeight;
                    lines.forEach((line, i) => {
                        const y = bandCenterY - totalH / 2 + lineHeight * (i + 0.5);
                        ctx.fillText(line, NAME_BAND.cx, y);
                    });
                }

                if (!cancelled) {
                    offscreenRef.current = canvas;
                    setPreviewUrl(canvas.toDataURL('image/png'));
                    setStatus('ready');
                }
            } catch (err) {
                console.error('QR sharing image failed:', err);
                if (!cancelled) {
                    setErrorMsg(err?.message ? String(err.message) : String(err));
                    setStatus('error');
                }
            }
        };

        compose();
        return () => { cancelled = true; };
    }, [url, name]);

    const handleDownload = () => {
        const canvas = offscreenRef.current;
        if (!canvas || status !== 'ready') return;
        canvas.toBlob(async (blob) => {
            if (!blob) { setStatus('error'); return; }
            const filename = `${sanitizeFilename(fileLabel || name)}-planetcreations-qr.png`;
            // Mobile only: native share sheet. Desktop always falls through to download.
            if (isMobileDevice()) {
                try {
                    const file = new File([blob], filename, { type: 'image/png' });
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({ files: [file], title: name || 'PlanetCreations' });
                        return;
                    }
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
        }, 'image/png');
    };

    const handleCopyLink = async () => {
        if (!url) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                // Fallback für Kontexte ohne Clipboard-API (z. B. kein HTTPS)
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            setCopied(true);
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Copy link failed:', e);
        }
    };

    if (status === 'error') {
        return (
            <div className={containerClassName}>
                {heading && <p className="text-sm font-bold text-gray-600 mb-1">{heading}</p>}
                <p className="text-sm text-gray-500">The QR code could not be generated.</p>
                {errorMsg && <p className="text-xs text-gray-400 mt-1 break-words">{errorMsg}</p>}
            </div>
        );
    }

    return (
        <div className={containerClassName}>
            {heading && <p className="text-sm font-bold text-gray-600 mb-2">{heading}</p>}
            <div className={`relative mx-auto ${previewClassName}`}>
                {previewUrl && (
                    <img
                        src={previewUrl}
                        alt={`Sharing QR code for ${name || 'PlanetCreations'}`}
                        className="w-full h-auto rounded-lg"
                    />
                )}
                {status === 'loading' && (
                    <div className="flex items-center justify-center aspect-square">
                        <Spinner size="small" />
                    </div>
                )}
            </div>
            <button
                onClick={handleDownload}
                disabled={status !== 'ready'}
                className="w-full mt-3 py-2 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold disabled:opacity-50 transition-colors"
            >
                Download QR Code
            </button>
            <button
                onClick={handleCopyLink}
                disabled={!url}
                className={`w-full mt-2 py-2 px-4 rounded-lg font-semibold disabled:opacity-50 transition-colors ${copied ? 'bg-green-100 text-green-700' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
            >
                {copied ? 'Link copied!' : copyLabel}
            </button>
        </div>
    );
};

export default SharingQrCode;
