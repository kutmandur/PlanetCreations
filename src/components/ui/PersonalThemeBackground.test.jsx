import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PersonalThemeBackground from './PersonalThemeBackground';
import { hydratePersonalTheme, setPersonalThemeUser } from '../../utils/personalTheme';

const backgroundUrl = 'https://i.postimg.cc/abc/wide.jpg';
const portraitBackgroundUrl = 'https://i.postimg.cc/abc/tall.jpg';
let media, change;
beforeEach(() => {
    localStorage.clear();
    setPersonalThemeUser('alice');
    media = {
        matches: false,
        addEventListener: vi.fn((event, listener) => { change = listener; }),
        removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(() => { cleanup(); setPersonalThemeUser(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const image = () => document.querySelector('.pc-personal-background img');
const rotate = portrait => act(() => { media.matches = portrait; change(); });

it('switches one image on window orientation changes without writing theme settings', () => {
    hydratePersonalTheme('alice', { backgroundUrl, portraitBackgroundUrl });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(<PersonalThemeBackground />);
    expect(image()).toHaveAttribute('src', backgroundUrl);
    expect(document.querySelectorAll('.pc-personal-background img')).toHaveLength(1);
    rotate(true);
    expect(image()).toHaveAttribute('src', portraitBackgroundUrl);
    expect(image()).toHaveAttribute('referrerpolicy', 'no-referrer');
    rotate(false);
    expect(image()).toHaveAttribute('src', backgroundUrl);
    expect(write).not.toHaveBeenCalled();
    expect(window.matchMedia).toHaveBeenCalledWith('(orientation: portrait)');
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', change);
});

it('uses the standard background when the portrait image is missing or fails to load', () => {
    media.matches = true;
    hydratePersonalTheme('alice', { backgroundUrl });
    render(<PersonalThemeBackground />);
    expect(image()).toHaveAttribute('src', backgroundUrl);
    act(() => hydratePersonalTheme('alice', { backgroundUrl, portraitBackgroundUrl }));
    expect(image()).toHaveAttribute('src', portraitBackgroundUrl);
    fireEvent.error(image());
    expect(image()).toHaveAttribute('src', backgroundUrl);
    fireEvent.error(image());
    expect(image()).toBeNull();
    rotate(false);
    rotate(true);
    expect(image()).toBeNull();
});

it('supports a portrait-only background and clears it when the user signs out', () => {
    hydratePersonalTheme('alice', { portraitBackgroundUrl });
    render(<PersonalThemeBackground />);
    expect(image()).toBeNull();
    rotate(true);
    expect(image()).toHaveAttribute('src', portraitBackgroundUrl);
    act(() => setPersonalThemeUser(null));
    expect(image()).toBeNull();
});
