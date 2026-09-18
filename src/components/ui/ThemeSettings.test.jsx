import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ThemeSettings from './ThemeSettings';
import PersonalThemeBackground from './PersonalThemeBackground';
import { savePersonalTheme } from '../../firebase/personalTheme';
import { DEFAULT_PERSONAL_THEME, getActivePersonalTheme, hydratePersonalTheme, normalizePersonalTheme, setPersonalThemeUser } from '../../utils/personalTheme';
import { extractThemePalette } from '../../utils/themePalette';

vi.mock('../../firebase/personalTheme', () => ({ savePersonalTheme: vi.fn() }));
vi.mock('../../utils/themePalette', () => ({ extractThemePalette: vi.fn() }));
const user = { uid: 'alice' };
beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); setPersonalThemeUser(user.uid);
    savePersonalTheme.mockImplementation(async (uid, value) => {
        const theme = normalizePersonalTheme(value);
        hydratePersonalTheme(uid, theme);
        return theme;
    });
});
afterEach(() => { cleanup(); setPersonalThemeUser(null); });

it('keeps draft edits and previews local, then saves once when requested', async () => {
    render(<ThemeSettings user={user} />);
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Card color'), { target: { value: '#123456' } });
    fireEvent.change(screen.getByLabelText('Background image'), { target: { value: 'https://i.postimg.cc/abc/photo.jpg' } });
    expect(document.querySelector('.pc-theme-preview img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview background' }));
    expect(document.querySelector('.pc-theme-preview img')).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(savePersonalTheme).not.toHaveBeenCalled();
    expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }));
    await screen.findByText(/Theme saved/);
    expect(savePersonalTheme).toHaveBeenCalledTimes(1);
    expect(getActivePersonalTheme().cardColor).toBe('#123456');
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeDisabled();
});
it('blocks invalid URLs and keeps reset as an unsaved draft', async () => {
    hydratePersonalTheme(user.uid, { cardColor: '#123456' });
    render(<ThemeSettings user={user} />);
    fireEvent.change(screen.getByLabelText('Background image'), { target: { value: 'https://postimg.cc/abc' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Direct Link');
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(savePersonalTheme).not.toHaveBeenCalled();
    expect(getActivePersonalTheme().cardColor).toBe('#123456');
    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }));
    await screen.findByText(/Theme saved/);
    expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
});

it('previews both formats and saves the optional portrait image only on explicit save', async () => {
    const backgroundUrl = 'https://i.postimg.cc/abc/wide.jpg';
    const portraitBackgroundUrl = 'https://i.postimg.cc/abc/tall.jpg';
    hydratePersonalTheme(user.uid, { backgroundUrl });
    render(<ThemeSettings user={user} />);
    fireEvent.change(screen.getByLabelText('Portrait background image'), { target: { value: portraitBackgroundUrl } });
    expect(document.querySelector('.pc-theme-preview img')).toHaveAttribute('src', backgroundUrl);
    act(() => hydratePersonalTheme(user.uid, { backgroundUrl, cardColor: '#123456' }));
    expect(screen.getByLabelText('Portrait background image')).toHaveValue(portraitBackgroundUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Portrait', exact: true }));
    expect(document.querySelector('.pc-theme-preview img')).toHaveAttribute('src', portraitBackgroundUrl);
    expect(screen.getByRole('button', { name: 'Portrait', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Landscape', exact: true }));
    expect(document.querySelector('.pc-theme-preview img')).toHaveAttribute('src', backgroundUrl);
    expect(savePersonalTheme).not.toHaveBeenCalled();
    expect(getActivePersonalTheme().portraitBackgroundUrl).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }));
    await screen.findByText(/Theme saved/);
    expect(savePersonalTheme).toHaveBeenCalledExactlyOnceWith(user.uid, expect.objectContaining({ backgroundUrl, portraitBackgroundUrl }));
    expect(getActivePersonalTheme().portraitBackgroundUrl).toBe(portraitBackgroundUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByLabelText('Portrait background image')).toHaveValue('');
    expect(getActivePersonalTheme().portraitBackgroundUrl).toBe(portraitBackgroundUrl);
});

it('rejects invalid portrait links and previews a standard-image fallback after a load error', () => {
    const backgroundUrl = 'https://i.postimg.cc/abc/wide.jpg';
    hydratePersonalTheme(user.uid, { backgroundUrl });
    render(<ThemeSettings user={user} />);
    fireEvent.change(screen.getByLabelText('Portrait background image'), { target: { value: 'https://postimg.cc/gallery' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Portrait background');
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Portrait background image'), { target: { value: 'https://i.postimg.cc/abc/tall.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Portrait', exact: true }));
    fireEvent.error(document.querySelector('.pc-theme-preview img'));
    expect(document.querySelector('.pc-theme-preview img')).toHaveAttribute('src', backgroundUrl);
    expect(screen.getByRole('status')).toHaveTextContent('standard background image is shown instead');
});

it('extracts colors from the selected portrait image and cancels work when the source changes', async () => {
    const portraitBackgroundUrl = 'https://i.postimg.cc/abc/tall.jpg';
    hydratePersonalTheme(user.uid, { backgroundUrl: 'https://i.postimg.cc/abc/wide.jpg', portraitBackgroundUrl });
    extractThemePalette.mockResolvedValueOnce({ colors: ['#123456'], cardColor: '#123456', accentColor: '#abcdef' });
    render(<ThemeSettings user={user} />);
    fireEvent.change(screen.getByLabelText('Image for color suggestions'), { target: { value: 'portraitBackgroundUrl' } });
    expect(extractThemePalette).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest colors from image' }));
    await screen.findByRole('button', { name: 'Use suggested combination' });
    expect(extractThemePalette).toHaveBeenCalledWith(portraitBackgroundUrl, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(document.querySelector('.pc-theme-preview img')).toHaveAttribute('src', portraitBackgroundUrl);
    fireEvent.change(screen.getByLabelText('Image for color suggestions'), { target: { value: 'backgroundUrl' } });
    expect(screen.queryByRole('button', { name: 'Use suggested combination' })).not.toBeInTheDocument();
    expect(savePersonalTheme).not.toHaveBeenCalled();
});
it('preserves the draft after failed saves and remote updates', async () => {
    render(<ThemeSettings user={user} />);
    fireEvent.change(screen.getByLabelText('Card color'), { target: { value: '#123456' } });
    act(() => hydratePersonalTheme(user.uid, { cardColor: '#abcdef' }));
    expect(screen.getByLabelText('Card color')).toHaveValue('#123456');
    savePersonalTheme.mockRejectedValueOnce(new Error('Permission denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
    expect(screen.getByLabelText('Card color')).toHaveValue('#123456');
    expect(getActivePersonalTheme().cardColor).toBe('#abcdef');
});
it('shows remote settings when no unsaved draft exists and handles unavailable images', async () => {
    render(<><ThemeSettings user={user} /><PersonalThemeBackground /></>);
    act(() => hydratePersonalTheme(user.uid, { backgroundUrl: 'https://i.postimg.cc/abc/photo.jpg' }));
    expect(screen.getByLabelText('Background image')).toHaveValue('https://i.postimg.cc/abc/photo.jpg');
    await waitFor(() => expect(document.querySelector('.pc-theme-preview img')).not.toBeNull());
    fireEvent.error(document.querySelector('.pc-theme-preview img'));
    expect(screen.getByRole('status')).toHaveTextContent('could not be loaded');
    fireEvent.error(document.querySelector('.pc-personal-background img'));
    expect(document.querySelector('.pc-personal-background')).toBeNull();
    act(() => setPersonalThemeUser(null));
    expect(document.querySelector('.pc-personal-background')).toBeNull();
});
it('suggests image colors on demand and stages a combination without saving', async () => {
    extractThemePalette.mockResolvedValueOnce({ colors: ['#123456', '#ffaa00'], cardColor: '#123456', accentColor: '#ffaa00' });
    render(<ThemeSettings user={user} />);
    expect(screen.getByRole('button', { name: 'Suggest colors from image' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Background image'), { target: { value: 'https://i.postimg.cc/abc/photo.jpg' } });
    expect(extractThemePalette).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest colors from image' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use suggested combination' }));
    expect(screen.getByLabelText('Card color')).toHaveValue('#123456');
    expect(screen.getByLabelText('Accent color')).toHaveValue('#ffaa00');
    expect(savePersonalTheme).not.toHaveBeenCalled();
    expect(getActivePersonalTheme()).toEqual(DEFAULT_PERSONAL_THEME);
    fireEvent.click(screen.getByRole('button', { name: 'Use #123456 as accent' }));
    expect(screen.getByLabelText('Accent color')).toHaveValue('#123456');
    expect(extractThemePalette).toHaveBeenCalledTimes(1);
});
it('discards a late palette after the image URL changes', async () => {
    let resolvePalette;
    extractThemePalette.mockReturnValueOnce(new Promise(resolve => { resolvePalette = resolve; }));
    render(<ThemeSettings user={user} />);
    fireEvent.change(screen.getByLabelText('Background image'), { target: { value: 'https://i.postimg.cc/abc/old.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest colors from image' }));
    fireEvent.change(screen.getByLabelText('Background image'), { target: { value: 'https://i.postimg.cc/abc/new.jpg' } });
    expect(extractThemePalette.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolvePalette({ colors: ['#123456'], cardColor: '#123456', accentColor: '#123456' }));
    expect(screen.queryByRole('button', { name: 'Use suggested combination' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Card color')).toHaveValue('');
});
it('keeps manual selection and saving available when extraction fails', async () => {
    extractThemePalette.mockRejectedValueOnce(new Error('Image unavailable'));
    render(<ThemeSettings user={user} />);
    fireEvent.change(screen.getByLabelText('Background image'), { target: { value: 'https://i.postimg.cc/abc/photo.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest colors from image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Image unavailable');
    fireEvent.change(screen.getByLabelText('Card color'), { target: { value: '#123456' } });
    expect(screen.getByRole('button', { name: 'Save theme' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Suggest colors from image' })).toBeEnabled();
});

it('previews light/dark variants locally and saves the opt-in with original colors', async () => {
    hydratePersonalTheme(user.uid, { cardColor: '#123456', accentColor: '#abcdef' });
    render(<ThemeSettings user={user} />);
    const toggle = screen.getByRole('checkbox', { name: 'Adapt colors to light and dark mode' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    const light = screen.getByRole('group', { name: 'Light mode preview' });
    const dark = screen.getByRole('group', { name: 'Dark mode preview' });
    expect(light.querySelector('.pc-theme-preview-card').style.backgroundColor).not.toBe(dark.querySelector('.pc-theme-preview-card').style.backgroundColor);
    expect(savePersonalTheme).not.toHaveBeenCalled();
    expect(getActivePersonalTheme().adaptToColorScheme).toBe(false);
    // A refreshed account snapshot must not discard a pending checkbox change.
    act(() => hydratePersonalTheme(user.uid, { cardColor: '#123456', accentColor: '#abcdef' }));
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save theme' }));
    await screen.findByText(/Theme saved/);
    expect(savePersonalTheme).toHaveBeenCalledExactlyOnceWith(user.uid, expect.objectContaining({ cardColor: '#123456', accentColor: '#abcdef', adaptToColorScheme: true }));
    expect(screen.getByLabelText('Card color')).toHaveValue('#123456');
    expect(screen.getByLabelText('Accent color')).toHaveValue('#abcdef');
    fireEvent.click(toggle);
    expect(screen.queryByRole('group', { name: 'Dark mode preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Theme preview' })).toBeVisible();
    expect(getActivePersonalTheme().adaptToColorScheme).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(toggle).not.toBeChecked();
});
