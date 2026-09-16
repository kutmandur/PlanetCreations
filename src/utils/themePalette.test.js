import { afterEach, expect, it, vi } from 'vitest';
import { extractThemePalette, paletteFromPixels } from './themePalette';

const pixels = (...groups) => new Uint8ClampedArray(groups.flatMap(([color, count]) => Array.from({ length: count }, () => color).flat()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('finds the dominant surface and a distinct saturated accent without duplicate shades', () => {
    const palette = paletteFromPixels(pixels([[35, 50, 65, 255], 500], [[38, 53, 68, 255], 200], [[245, 140, 40, 255], 100], [[250, 250, 250, 255], 80]));
    expect(palette.colors).toHaveLength(3);
    expect(palette.colors).toContain(palette.cardColor);
    expect(palette.accentColor).toBe('#f58c28');
    expect(palette.cardColor).not.toBe(palette.accentColor);
    expect(new Set(palette.colors).size).toBe(palette.colors.length);
});
it('ignores transparent pixels and isolated noise, and handles monochrome images', () => {
    const palette = paletteFromPixels(pixels([[45, 65, 85, 255], 900], [[255, 0, 0, 0], 1000], [[0, 255, 0, 255], 1]));
    expect(palette).toEqual({ colors: ['#2d4155'], cardColor: '#2d4155', accentColor: '#2d4155' });
    expect(() => paletteFromPixels(pixels([[255, 255, 255, 0], 20]))).toThrow('no visible colors');
});
it('limits varied images to six distinct suggestions', () => {
    const palette = paletteFromPixels(pixels(...[
        [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255],
        [0, 255, 255, 255], [255, 0, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255],
    ].map(color => [color, 50])));
    expect(palette.colors).toHaveLength(6);
});

function mockImage() {
    const image = { naturalWidth: 4000, naturalHeight: 2000, removeAttribute: vi.fn() };
    vi.stubGlobal('Image', vi.fn(function () { return image; }));
    return image;
}
it('uses anonymous image loading and samples at most 96×96 pixels before releasing resources', async () => {
    const image = mockImage();
    const canvas = document.createElement('canvas');
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: pixels([[20, 40, 60, 255], 10]) })) };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    const pending = extractThemePalette('https://i.postimg.cc/abc/test.png');
    expect(image.crossOrigin).toBe('anonymous');
    expect(image.referrerPolicy).toBe('no-referrer');
    image.onload();
    expect((await pending).cardColor).toBe('#14283c');
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 96, 48);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(image.removeAttribute).toHaveBeenCalledWith('src');
    expect(image.onload).toBeNull();
});
it('fails clearly for host restrictions without attempting a proxy request', async () => {
    const image = mockImage();
    const pending = extractThemePalette('https://i.postimg.cc/abc/test.png');
    const result = expect(pending).rejects.toThrow('host may restrict');
    image.onerror();
    await result;
});
it('rejects invalid origins before loading and cancels or times out pending images', async () => {
    vi.useFakeTimers();
    const image = mockImage();
    await expect(extractThemePalette('https://evil.test/photo.png')).rejects.toThrow('Direct Link');
    expect(Image).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = extractThemePalette('https://i.postimg.cc/abc/test.png', { signal: controller.signal });
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await cancelled;
    expect(image.onload).toBeNull();
    const timedOut = expect(extractThemePalette('https://i.postimg.cc/abc/test.png')).rejects.toThrow('too long');
    vi.advanceTimersByTime(15000);
    await timedOut;
    expect(vi.getTimerCount()).toBe(0);
});
