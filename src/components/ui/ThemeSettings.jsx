import React, { useEffect, useRef, useState } from 'react';
import { savePersonalTheme } from '../../firebase/personalTheme';
import {
    DEFAULT_PERSONAL_THEME, PERSONAL_THEME_EVENT, getActivePersonalTheme, getPersonalThemeUser,
    normalizePersonalTheme, readCachedPersonalTheme, readableThemeText, resolvePersonalThemeBackground, resolvePersonalThemeColors, validatePersonalTheme,
} from '../../utils/personalTheme';
import InfoBox from './InfoBox';
import { extractThemePalette } from '../../utils/themePalette';

const sameTheme = (a, b) => ['backgroundUrl', 'portraitBackgroundUrl', 'cardColor', 'accentColor', 'adaptToColorScheme'].every(key => a[key] === b[key]);

function ThemeColorField({ label, value, fallback, onChange }) {
    const id = `theme-${label.toLowerCase().replaceAll(' ', '-')}`;
    return <div>
        <label htmlFor={id} className="block text-sm font-semibold mb-2">{label}</label>
        <div className="flex items-center gap-2">
            <input type="color" aria-label={`${label} picker`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : fallback}
                onChange={event => onChange(event.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded border p-1" />
            <input id={id} type="text" value={value} placeholder="Default" maxLength={7} spellCheck={false}
                onChange={event => onChange(event.target.value)} className="min-w-0 w-full rounded-lg border p-2 font-mono text-sm" />
            <button type="button" onClick={() => onChange('')} disabled={!value}
                className="text-sm underline disabled:opacity-40">Default</button>
        </div>
    </div>;
}

export default function ThemeSettings({ user }) {
    const [form, setForm] = useState(() => {
        const theme = getPersonalThemeUser() === user.uid ? getActivePersonalTheme() : readCachedPersonalTheme(user.uid);
        return { saved: theme, draft: theme };
    });
    const [previewTheme, setPreviewTheme] = useState(form.saved);
    const [previewFormat, setPreviewFormat] = useState('landscape');
    const [failedPreviewUrls, setFailedPreviewUrls] = useState([]);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [message, setMessage] = useState('');
    const [saveError, setSaveError] = useState('');
    const [palette, setPalette] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [paletteError, setPaletteError] = useState('');
    const [paletteSource, setPaletteSource] = useState('backgroundUrl');
    const analysisRef = useRef(null);

    useEffect(() => {
        const update = event => {
            if (event.detail?.uid !== user.uid) return;
            const theme = normalizePersonalTheme(event.detail.theme);
            setForm(previous => ({ saved: theme, draft: sameTheme(previous.draft, previous.saved) ? theme : previous.draft }));
        };
        window.addEventListener(PERSONAL_THEME_EVENT, update);
        return () => window.removeEventListener(PERSONAL_THEME_EVENT, update);
    }, [user.uid]);

    const { draft, saved } = form;
    const dirty = !sameTheme(draft, saved);
    useEffect(() => {
        if (!dirty) { setPreviewTheme(saved); setFailedPreviewUrls([]); }
    }, [saved.backgroundUrl, saved.portraitBackgroundUrl, dirty]);
    const validationError = validatePersonalTheme(draft);
    const normalized = normalizePersonalTheme(draft);
    const portraitPreview = previewFormat === 'portrait';
    const previewUrl = resolvePersonalThemeBackground(previewTheme, portraitPreview, failedPreviewUrls);
    const imageError = failedPreviewUrls.includes(resolvePersonalThemeBackground(previewTheme, portraitPreview));
    const paletteField = normalized[paletteSource] ? paletteSource : normalized.backgroundUrl ? 'backgroundUrl'
        : normalized.portraitBackgroundUrl ? 'portraitBackgroundUrl' : 'backgroundUrl';
    const paletteUrl = normalized[paletteField];
    useEffect(() => {
        analysisRef.current?.abort();
        analysisRef.current = null;
        setAnalyzing(false);
        setPalette(null);
        setPaletteError('');
        return () => analysisRef.current?.abort();
    }, [paletteUrl]);
    const edit = (field, value) => {
        setForm(previous => ({ ...previous, draft: { ...previous.draft, [field]: value } }));
        setMessage('');
        setSaveError('');
    };
    const showPreview = () => {
        setPreviewTheme(normalized);
        setFailedPreviewUrls([]);
    };
    const suggestColors = async () => {
        if (!paletteUrl || analysisRef.current) return;
        const controller = new AbortController();
        analysisRef.current = controller;
        setAnalyzing(true);
        setPaletteError('');
        try {
            const result = await extractThemePalette(paletteUrl, { signal: controller.signal });
            if (controller.signal.aborted) return;
            setPalette(result);
            setPreviewFormat(paletteField === 'portraitBackgroundUrl' ? 'portrait' : 'landscape');
            showPreview();
        } catch (error) {
            if (!controller.signal.aborted) setPaletteError(error.message);
        } finally {
            if (analysisRef.current === controller) { analysisRef.current = null; setAnalyzing(false); }
        }
    };
    const useSuggestedColors = () => {
        setForm(previous => ({ ...previous, draft: { ...previous.draft, cardColor: palette.cardColor, accentColor: palette.accentColor } }));
        setMessage('Suggested colors selected. Save theme to apply.');
        setSaveError('');
    };
    const handleSave = async event => {
        event.preventDefault();
        if (!dirty || validationError || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setSaveError('');
        setMessage('');
        try {
            const theme = await savePersonalTheme(user.uid, draft);
            setForm({ saved: theme, draft: theme });
            setPreviewTheme(theme);
            setFailedPreviewUrls([]);
            setMessage('Theme saved. It is available in the browser and desktop client with your account.');
        } catch (error) {
            setSaveError(`Could not save your theme: ${error.message}`);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return <section className="pc-theme-card bg-white p-6 rounded-lg shadow-md" aria-labelledby="theme-settings-heading">
        <h2 id="theme-settings-heading" className="text-2xl font-bold mb-2">Themes</h2>
        <p className="text-gray-600 mb-5">Personalize the browser and desktop client while signed in. Save your changes to apply them and sync them with your account.</p>
        <form onSubmit={handleSave}>
            <fieldset disabled={saving} className="min-w-0 space-y-5">
                <div>
                    <label htmlFor="theme-background" className="block text-sm font-semibold mb-2">Background image</label>
                    <input id="theme-background" type="url" value={draft.backgroundUrl} maxLength={2048} spellCheck={false}
                        onChange={event => edit('backgroundUrl', event.target.value)} placeholder="https://i.postimg.cc/…/image.jpg"
                        aria-describedby="theme-background-help" className="w-full rounded-lg border p-3 text-sm" />
                    <p id="theme-background-help" className="text-xs text-gray-500 mt-2">Paste a Postimages Direct Link. Used in landscape and whenever no portrait image is set. Leave empty to use the default background.</p>
                    <InfoBox />
                </div>
                <div>
                    <label htmlFor="theme-portrait-background" className="block text-sm font-semibold mb-2">Portrait background image</label>
                    <input id="theme-portrait-background" type="url" value={draft.portraitBackgroundUrl} maxLength={2048} spellCheck={false}
                        onChange={event => edit('portraitBackgroundUrl', event.target.value)} placeholder="https://i.postimg.cc/…/portrait.jpg"
                        aria-describedby="theme-portrait-background-help" className="w-full rounded-lg border p-3 text-sm" />
                    <p id="theme-portrait-background-help" className="text-xs text-gray-500 mt-2">Optional Postimages Direct Link for portrait windows, including phones and narrow desktop windows. Switching is automatic when you rotate or resize. If empty or unavailable, the background image above is used.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <ThemeColorField label="Card color" value={draft.cardColor} fallback="#ffffff" onChange={value => edit('cardColor', value)} />
                    <ThemeColorField label="Accent color" value={draft.accentColor} fallback="#2563eb" onChange={value => edit('accentColor', value)} />
                </div>
                <div className="rounded-lg border p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={draft.adaptToColorScheme} onChange={event => edit('adaptToColorScheme', event.target.checked)}
                            aria-describedby="theme-color-scheme-help" className="mt-1 h-4 w-4 shrink-0 accent-blue-600" />
                        <span className="font-semibold">Adapt colors to light and dark mode</span>
                    </label>
                    <p id="theme-color-scheme-help" className="mt-2 text-xs text-gray-500">Use lighter cards in light mode and darker cards in dark mode, with matching accents and readable text. Your original colors stay saved. When unchecked, both modes use your exact colors.</p>
                </div>
                <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-semibold">Colors from your background</h3>
                        <button type="button" onClick={suggestColors} disabled={!paletteUrl || analyzing || Boolean(palette)}
                            className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
                            {analyzing ? 'Finding colors…' : 'Suggest colors from image'}
                        </button>
                    </div>
                    {normalized.portraitBackgroundUrl && <label className="block text-sm">
                        <span className="block font-semibold mb-1">Image for color suggestions</span>
                        <select value={paletteField} onChange={event => setPaletteSource(event.target.value)} className="w-full rounded-lg border p-2">
                            <option value="backgroundUrl" disabled={!normalized.backgroundUrl}>Background image</option>
                            <option value="portraitBackgroundUrl">Portrait background image</option>
                        </select>
                    </label>}
                    <p className="text-xs text-gray-500">Find a matching card color and a contrasting accent, or pick individual colors below. Suggestions stay in the preview until you save.</p>
                    {analyzing && <p role="status" className="text-sm">Analyzing your background image…</p>}
                    {paletteError && <p role="alert" className="text-sm">{paletteError}</p>}
                    {palette && <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-label="Suggested image colors">
                            {palette.colors.map(hex => <div key={hex} className="overflow-hidden rounded-lg border">
                                <div className="px-2 py-3 text-center text-xs font-mono" style={{ backgroundColor: hex, color: readableThemeText(hex) }}>{hex}</div>
                                <div className="flex divide-x text-xs">
                                    <button type="button" aria-label={`Use ${hex} for cards`} onClick={() => edit('cardColor', hex)} className="flex-1 p-2 hover:bg-gray-100">Card</button>
                                    <button type="button" aria-label={`Use ${hex} as accent`} onClick={() => edit('accentColor', hex)} className="flex-1 p-2 hover:bg-gray-100">Accent</button>
                                </div>
                            </div>)}
                        </div>
                        <button type="button" onClick={useSuggestedColors} className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-gray-100">Use suggested combination</button>
                    </>}
                </div>
                <p className="text-xs text-gray-500">Colors apply to general cards. Game, community and status colors keep their meaning. Light/dark mode remains available in the top bar.</p>
                <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <h3 className="font-semibold">Preview</h3>
                        <button type="button" onClick={showPreview} disabled={Boolean(validationError)} className="text-sm underline disabled:opacity-40">Preview background</button>
                    </div>
                    <div role="group" aria-label="Preview format" className="flex flex-wrap gap-2 mb-3">
                        {['landscape', 'portrait'].map(format => <button key={format} type="button" aria-pressed={previewFormat === format}
                            onClick={() => { setPreviewFormat(format); showPreview(); }}
                            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${previewFormat === format ? 'pc-theme-action bg-blue-600 text-white' : 'hover:bg-gray-100'}`}>
                            {format === 'portrait' ? 'Portrait' : 'Landscape'}
                        </button>)}
                    </div>
                    <div className={draft.adaptToColorScheme ? 'grid gap-3 sm:grid-cols-2' : ''}>
                        {(draft.adaptToColorScheme ? ['light', 'dark'] : ['current']).map(mode => {
                            const colors = resolvePersonalThemeColors(normalized, mode);
                            const cardColor = colors.cardColor || (mode === 'current' ? undefined : mode === 'dark' ? '#1f2937' : '#ffffff');
                            const accentColor = colors.accentColor;
                            return <div key={mode} role="group" aria-label={mode === 'current' ? 'Theme preview' : `${mode === 'dark' ? 'Dark' : 'Light'} mode preview`}
                                className="pc-theme-preview relative isolate overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-900 p-4 sm:p-6 mx-auto w-full flex flex-col justify-center"
                                style={{ aspectRatio: portraitPreview ? '9 / 16' : '16 / 9', maxWidth: portraitPreview ? '20rem' : '36rem', minHeight: '15rem',
                                    ...(mode === 'current' ? {} : { backgroundColor: mode === 'dark' ? '#111827' : '#f3f4f6' }) }}>
                                {previewUrl && <img key={previewUrl} src={previewUrl} alt="" referrerPolicy="no-referrer"
                                    onError={() => setFailedPreviewUrls(previous => previous.includes(previewUrl) ? previous : [...previous, previewUrl])} className="absolute inset-0 -z-10 h-full w-full object-cover" />}
                                {mode !== 'current' && <p className="inline-block rounded px-2 py-1 text-xs font-semibold mb-3"
                                    style={{ backgroundColor: mode === 'dark' ? '#111827' : '#f3f4f6', color: mode === 'dark' ? '#ffffff' : '#111827' }}>{mode === 'dark' ? 'Dark mode' : 'Light mode'}</p>}
                                <div className="pc-theme-preview-card mx-auto max-w-sm rounded-lg p-5 shadow-lg"
                                    style={{ backgroundColor: cardColor, color: cardColor ? readableThemeText(cardColor) : undefined,
                                        borderTop: `3px solid ${accentColor || 'transparent'}` }}>
                                    <h4 className="font-bold text-lg">Your creations, your style</h4>
                                    <p className="text-sm mt-2 mb-4">Text adjusts to your card color for readability.</p>
                                    <span className="pc-theme-preview-action inline-block rounded-lg px-3 py-2 text-sm font-semibold"
                                        style={{ backgroundColor: accentColor || undefined, color: accentColor ? readableThemeText(accentColor) : undefined }}>Accent preview</span>
                                </div>
                            </div>;
                        })}
                    </div>
                    {imageError && <p className="text-sm mt-2" role="status">The image could not be loaded. Check the Direct Link or try the preview again. {previewUrl ? 'The standard background image is shown instead.' : 'The default background is shown instead.'}</p>}
                </div>
                {(validationError || saveError) && <p role="alert" className="text-sm">{validationError || saveError}</p>}
                {message && <p role="status" className="text-sm">{message}</p>}
                <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" disabled={!dirty || Boolean(validationError)} className="pc-theme-action bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                        {saving ? 'Saving…' : 'Save theme'}
                    </button>
                    <button type="button" onClick={() => { setForm(previous => ({ ...previous, draft: { ...DEFAULT_PERSONAL_THEME } })); setPreviewTheme(DEFAULT_PERSONAL_THEME); setFailedPreviewUrls([]); setMessage('Defaults selected. Save theme to apply.'); setSaveError(''); }}
                        className="rounded-lg border px-4 py-2.5 text-sm hover:bg-gray-100">Reset to defaults</button>
                </div>
            </fieldset>
        </form>
    </section>;
}
