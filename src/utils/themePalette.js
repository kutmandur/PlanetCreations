import { normalizeBackgroundUrl } from './personalTheme';

const distance = (a, b) => Math.hypot(...a.map((channel, index) => channel - b[index]));
const saturation = rgb => (Math.max(...rgb) - Math.min(...rgb)) / Math.max(1, ...rgb);
const toHex = rgb => '#' + rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');

// A small histogram, weighted by opacity, keeps extraction predictable and cheap.
// Nearby shades are grouped; rare single-pixel noise is not suggested as an accent.
export function paletteFromPixels(pixels) {
    const buckets = new Map();
    let total = 0;
    for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
        const weight = pixels[offset + 3] / 255;
        if (weight < .5) continue;
        const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
        const key = (rgb[0] >> 4) * 256 + (rgb[1] >> 4) * 16 + (rgb[2] >> 4);
        const bucket = buckets.get(key) || { count: 0, sum: [0, 0, 0] };
        bucket.count += weight;
        rgb.forEach((channel, index) => { bucket.sum[index] += channel * weight; });
        buckets.set(key, bucket);
        total += weight;
    }
    if (!total) throw new Error('This image has no visible colors to suggest.');
    const allColors = [...buckets.values()].map(bucket => ({ count: bucket.count, rgb: bucket.sum.map(n => Math.round(n / bucket.count)) }))
        .sort((a, b) => b.count - a.count);
    const dominant = allColors[0];
    const candidates = allColors.filter(color => color.count >= total * .002).slice(0, 128);
    const selected = [dominant];
    while (selected.length < 6) {
        let best = null;
        let bestScore = 0;
        for (const candidate of candidates) {
            const separation = Math.min(...selected.map(color => distance(color.rgb, candidate.rgb)));
            if (separation < 44) continue;
            const score = Math.sqrt(candidate.count / total) * (0.3 + saturation(candidate.rgb)) * separation;
            if (score > bestScore) { best = candidate; bestScore = score; }
        }
        if (!best) break;
        selected.push(best);
    }
    const accent = selected.slice(1).sort((a, b) => (
        (0.3 + saturation(b.rgb)) * distance(dominant.rgb, b.rgb) * Math.sqrt(b.count) -
        (0.3 + saturation(a.rgb)) * distance(dominant.rgb, a.rgb) * Math.sqrt(a.count)
    ))[0] || dominant;
    return { colors: selected.map(color => toHex(color.rgb)), cardColor: toHex(dominant.rgb), accentColor: toHex(accent.rgb) };
}

// No proxy, upload, AI call, Firestore read or persisted image cache. The host must
// permit canvas access through CORS; the normal background remains usable if not.
export function extractThemePalette(url, { signal } = {}) {
    const safeUrl = normalizeBackgroundUrl(url);
    if (!safeUrl) return Promise.reject(new Error('Enter a valid Postimages Direct Link first.'));
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
        const image = new Image();
        let finished = false;
        const finish = (error, result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            image.onload = null;
            image.onerror = null;
            image.removeAttribute('src');
            if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
        const timeout = setTimeout(() => finish(new Error('The image took too long to load. Please try again.')), 15000);
        signal?.addEventListener('abort', abort, { once: true });
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.onload = () => {
            let canvas;
            try {
                if (!image.naturalWidth || !image.naturalHeight) throw new Error('The image could not be decoded.');
                const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
                canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) throw new Error('Color extraction is unavailable on this device.');
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                finish(null, paletteFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data));
            } catch (error) {
                finish(error.name === 'SecurityError' ? new Error('The image host does not allow color extraction. You can still choose colors manually.') : error);
            } finally {
                if (canvas) { canvas.width = 0; canvas.height = 0; }
            }
        };
        image.onerror = () => finish(new Error('The image could not be analyzed. Check the Direct Link or choose colors manually; the host may restrict image analysis.'));
        image.src = safeUrl;
    });
}
