import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GameOverlayWidget } from './GameOverlay';

let animationFrames;

beforeEach(() => {
    localStorage.clear();
    animationFrames = new Map();
    let nextFrameId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        const id = nextFrameId++;
        animationFrames.set(id, callback);
        return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
        animationFrames.delete(id);
    });
    window.electronAPI = {
        startOverlayDrag: vi.fn(),
        moveOverlay: vi.fn(),
        endOverlayDrag: vi.fn(),
        resizeOverlay: vi.fn(),
        setOverlayExpanded: vi.fn(),
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    delete window.electronAPI;
});

function flushAnimationFrames() {
    const pending = [...animationFrames.values()];
    animationFrames.clear();
    pending.forEach(callback => callback(performance.now()));
}

test('coalesces compact overlay movement and resizing to animation frames', () => {
    render(<GameOverlayWidget />);
    const button = screen.getByRole('button', { name: 'Open PlanetCreations overlay' });

    fireEvent.pointerDown(button, { button: 0, pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(button, { pointerId: 1, screenX: 110, screenY: 112 });
    fireEvent.pointerMove(button, { pointerId: 1, screenX: 125, screenY: 130 });
    fireEvent.wheel(button, { deltaY: -10 });
    fireEvent.wheel(button, { deltaY: -10 });

    expect(window.electronAPI.moveOverlay).not.toHaveBeenCalled();
    expect(window.electronAPI.resizeOverlay).not.toHaveBeenCalled();

    flushAnimationFrames();

    expect(window.electronAPI.moveOverlay).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.moveOverlay).toHaveBeenLastCalledWith({ screenX: 125, screenY: 130 });
    expect(window.electronAPI.resizeOverlay).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.resizeOverlay).toHaveBeenCalledWith(2);

    fireEvent.pointerUp(button, { pointerId: 1, screenX: 125, screenY: 130 });
    expect(window.electronAPI.endOverlayDrag).toHaveBeenCalledTimes(1);
});

test('opens the active showcase page when the compact overlay is clicked', () => {
    const onOpen = vi.fn();
    localStorage.setItem('pc.overlayQr', JSON.stringify({
        kind: 'community-showcase',
        creationId: 'park-1',
        creationIds: ['park-1'],
        activeCreationId: 'park-1',
        title: 'Showcase Park',
        url: 'https://www.planetcreations.net/share/creation/park-1',
    }));

    render(<GameOverlayWidget onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open PlanetCreations overlay' }));

    expect(window.electronAPI.setOverlayExpanded).toHaveBeenCalledWith(true);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'community-showcase',
        creationId: 'park-1',
    }));
});
