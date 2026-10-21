import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import OverlaySurface from './OverlaySurface';

afterEach(() => { delete window.electronAPI; });

test('legacy bridges keep their original layout', () => {
    const { container } = render(<OverlaySurface><p>Content</p></OverlaySurface>);
    expect(container.querySelector('.overlay-surface-content')).toBeNull();
    expect(screen.getByText('Content')).toBeVisible();
});

test('native layout positions content, preserves controls, and supports keyboard resizing', async () => {
    let onLayout, onMode;
    const stopLayout = vi.fn(), stopMode = vi.fn();
    window.electronAPI = {
        isGameOverlay: true,
        getOverlaySurface: vi.fn().mockResolvedValue({ x: 60, y: 80, width: 600, height: 500 }),
        getOverlayExpanded: vi.fn().mockResolvedValue(true),
        onOverlaySurfaceChanged: callback => { onLayout = callback; return stopLayout; },
        onOverlayModeChanged: callback => { onMode = callback; return stopMode; },
        startOverlayDrag: vi.fn(), resizeOverlayPanel: vi.fn(),
    };
    const { container, unmount } = render(<OverlaySurface><div className="game-overlay-chrome"><button>Action</button></div></OverlaySurface>);
    const resize = await screen.findByRole('button', { name: 'Resize overlay panel' });
    expect(container.firstChild).toHaveStyle({ left: '60px', top: '80px', width: '600px' });
    fireEvent.keyDown(resize, { key: 'ArrowRight' });
    expect(window.electronAPI.resizeOverlayPanel).toHaveBeenCalledWith({ width: 616, height: 500 });
    fireEvent.pointerDown(screen.getByText('Action'));
    expect(window.electronAPI.startOverlayDrag).not.toHaveBeenCalled();
    act(() => { onLayout({ x: 100, y: 200, width: 120, height: 120 }); onMode(false); });
    expect(container.firstChild).toHaveStyle({ left: '100px', width: '120px' });
    expect(screen.queryByRole('button', { name: 'Resize overlay panel' })).toBeNull();
    unmount();
    expect(stopLayout).toHaveBeenCalled();
    expect(stopMode).toHaveBeenCalled();
});
