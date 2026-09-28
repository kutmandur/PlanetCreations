import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SharingQrCode from './SharingQrCode';

vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,qr' } }));

const SHOWCASE_URL = 'https://www.planetcreations.net/showcase/showcase-1';

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        clearRect() {}, drawImage() {}, fillText() {}, measureText: () => ({ width: 10 }),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,composed');
    vi.stubGlobal('Image', class {
        set src(value) { this._src = value; setTimeout(() => this.onload?.()); }
        get src() { return this._src; }
    });
    document.execCommand = vi.fn(() => true);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

test('copies the showcase landing page link through the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<SharingQrCode url={SHOWCASE_URL} name="Jungle" copyLabel="Copy Showcase Link" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Copy Showcase Link' }));

    expect(await screen.findByRole('button', { name: 'Link copied!' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(SHOWCASE_URL);
});

test('falls back to a copy command when the desktop client denies clipboard access', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    let copiedValue = null;
    document.execCommand = vi.fn(() => { copiedValue = document.activeElement?.value ?? document.querySelector('textarea')?.value; return true; });
    render(<SharingQrCode url={SHOWCASE_URL} name="Jungle" copyLabel="Copy Showcase Link" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Copy Showcase Link' }));

    expect(await screen.findByRole('button', { name: 'Link copied!' })).toBeInTheDocument();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(copiedValue).toBe(SHOWCASE_URL);
    expect(document.querySelector('textarea')).toBeNull();
});
