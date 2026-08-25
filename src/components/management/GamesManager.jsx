import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../firebase/config';
import { doc, setDoc, deleteDoc, collection, query, where, getCountFromServer } from 'firebase/firestore';
import { getDefaultGameId, saveGamesRegistry } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import Spinner from '../ui/Spinner';

// Admin-Tab "Games": Spiele als Laufzeit-Konfiguration verwalten (meta/games).
// Hinzufügen/Bearbeiten/Sortieren/Deaktivieren/Entfernen inkl. Farbe (Hex),
// Plattformen, Mod-Support und Datei-Endungen (Server-Backup-Validierung).
// Entfernen ist nur ohne vorhandene Creations möglich — sonst deaktivieren.

const EMPTY_FORM = {
    id: '', name: '', shortName: '', color: '#3B82F6',
    shareCodeLabel: 'Share Code', console: false, modsSupported: false, extensions: '', enabled: true,
};

const GamesManager = ({
    setModalMessage,
    selectedGameId,
    onSelectedGameChange,
    addGameOpen = false,
    onAddGameOpenChange,
}) => {
    const games = useGames({ includeDisabled: true });
    const [counts, setCounts] = useState({});
    const [loadingCounts, setLoadingCounts] = useState(true);
    const [form, setForm] = useState(null);          // null = kein Formular offen
    const [editingId, setEditingId] = useState(null); // id beim Bearbeiten
    const [saving, setSaving] = useState(false);
    const [confirmRemoveId, setConfirmRemoveId] = useState(null);

    // Creation-Counts pro Spiel (gate fürs Entfernen)
    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoadingCounts(true);
            try {
                const creationsCol = collection(db, 'creations');
                const entries = await Promise.all(games.map(async (g) => {
                    const snap = await getCountFromServer(query(creationsCol, where('game', '==', g.id)));
                    return [g.id, snap.data().count];
                }));
                if (mounted) setCounts(Object.fromEntries(entries));
            } catch (e) {
                if (mounted) setModalMessage(`Error loading creation counts: ${e.message}`);
            } finally {
                if (mounted) setLoadingCounts(false);
            }
        })();
        return () => { mounted = false; };
    }, [games, setModalMessage]);

    const persist = useCallback(async (nextGames, nextDefault) => {
        setSaving(true);
        try {
            await saveGamesRegistry({
                games: nextGames,
                defaultGameId: nextDefault ?? getDefaultGameId(),
            });
            return true;
        } catch (e) {
            setModalMessage(`Error saving games: ${e.message}`);
            return false;
        } finally {
            setSaving(false);
        }
    }, [setModalMessage]);

    useEffect(() => {
        if (!addGameOpen) return;
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
    }, [addGameOpen]);

    const closeForm = () => {
        const wasAdding = !editingId;
        setForm(null);
        setEditingId(null);
        if (wasAdding) onAddGameOpenChange?.(false);
    };

    const openEdit = (g) => {
        setEditingId(g.id);
        setForm({
            id: g.id, name: g.name, shortName: g.shortName || '', color: g.color || '#6B7280',
            shareCodeLabel: g.shareCodeLabel || 'Share Code',
            console: !!g.platforms?.includes('console'), modsSupported: !!g.modsSupported,
            extensions: (g.fileExtensions || []).join(', '), enabled: g.enabled !== false,
        });
    };

    const parseExtensions = (raw) => raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .map((e) => (e.startsWith('.') ? e : `.${e}`));

    const handleFormSave = async () => {
        const id = form.id.trim().toLowerCase();
        if (!editingId) {
            if (!/^[a-z0-9-]{2,50}$/.test(id)) { setModalMessage('The id must be a slug (a-z, 0-9, hyphens).'); return; }
            if (games.some((g) => g.id === id)) { setModalMessage('A game with this id already exists.'); return; }
        }
        if (!form.name.trim()) { setModalMessage('Name is required.'); return; }
        if (!/^#[0-9a-fA-F]{6}$/.test(form.color)) { setModalMessage('Color must be a #RRGGBB hex value.'); return; }

        const entry = {
            id: editingId || id,
            name: form.name.trim(),
            shortName: form.shortName.trim() || form.name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase(),
            shareCodeLabel: form.shareCodeLabel.trim() || 'Share Code',
            color: form.color,
            platforms: form.console ? ['pc', 'console'] : ['pc'],
            modsSupported: form.modsSupported,
            fileExtensions: parseExtensions(form.extensions),
            enabled: form.enabled,
            order: editingId ? (games.find((g) => g.id === editingId)?.order ?? games.length) : games.length,
        };

        const nextGames = editingId
            ? games.map((g) => (g.id === editingId ? entry : g))
            : [...games, entry];

        if (await persist(nextGames)) {
            if (!editingId) {
                // Leere Kategorien-/DLC-Docs seeden, damit die bestehende
                // Data-Management-UI für das neue Spiel sofort funktioniert.
                try {
                    await Promise.all([
                        setDoc(doc(db, 'categories', entry.id), { names: [] }, { merge: true }),
                        setDoc(doc(db, 'dlcs', entry.id), { names: [] }, { merge: true }),
                    ]);
                } catch (e) {
                    setModalMessage(`Game saved, but seeding categories/dlcs failed: ${e.message}`);
                }
            }
            closeForm();
        }
    };

    const handleToggleEnabled = async (g) => {
        const nextGames = games.map((x) => (x.id === g.id ? { ...x, enabled: x.enabled === false } : x));
        await persist(nextGames);
    };

    const handleRemove = async (g) => {
        if ((counts[g.id] || 0) > 0) return;
        const nextGames = games.filter((x) => x.id !== g.id);
        if (nextGames.length === 0) { setModalMessage('At least one game must remain.'); return; }
        const nextDefault = getDefaultGameId() === g.id ? null : getDefaultGameId();
        if (await persist(nextGames, nextDefault)) {
            // Zugehörige Konfig-Docs abräumen. State/Shards des Suchindexes räumt
            // der serverseitige Rebuild ab; Clients dürfen dort nicht schreiben.
            try {
                await Promise.all([
                    deleteDoc(doc(db, 'categories', g.id)),
                    deleteDoc(doc(db, 'dlcs', g.id)),
                ]);
            } catch (e) {
                setModalMessage(`Game removed, but deleting categories/dlcs failed: ${e.message}`);
            }
            setConfirmRemoveId(null);
            onSelectedGameChange?.(nextGames.find(game => game.enabled !== false)?.id || nextGames[0].id);
            setModalMessage(`"${g.name}" removed. Please run "Rebuild General Index" under Startpage → Search Indexes to clean up its search index.`);
        }
    };

    const handleDefaultChange = async (id) => {
        await persist(games, id);
    };

    const enabledGames = games.filter((g) => g.enabled !== false);
    const selectedGame = games.find(game => game.id === selectedGameId) || games[0];

    return (
        <div>
            <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Game Settings</h2>
                        <p className="mt-1 text-sm text-gray-600">
                            Runtime configuration for the selected game across the website and uploads.
                        </p>
                    </div>
                    {selectedGame && (
                        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-700">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedGame.color }} />
                            {selectedGame.name}
                        </div>
                    )}
                </div>

                <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-gray-200 pb-5">
                    <label htmlFor="default-game" className="text-sm font-semibold text-gray-700">Default game (new users, fallbacks):</label>
                    <select
                        id="default-game"
                        value={getDefaultGameId()}
                        onChange={(e) => handleDefaultChange(e.target.value)}
                        disabled={saving}
                        className="p-2 border rounded-lg"
                    >
                        {enabledGames.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                    </select>
                </div>

                {selectedGame ? (
                    <div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-lg bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">ID / short name</p>
                                <p className="mt-1 font-mono text-sm text-gray-700">{selectedGame.id}</p>
                                <p className="text-sm text-gray-500">{selectedGame.shortName || '—'}</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Platforms / mods</p>
                                <p className="mt-1 text-sm font-medium text-gray-700">{selectedGame.platforms?.includes('console') ? 'PC + Console' : 'PC'}</p>
                                <p className="text-sm text-gray-500">Mods: {selectedGame.modsSupported ? 'supported' : 'not supported'}</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Upload files</p>
                                <p className="mt-1 break-words font-mono text-sm text-gray-700">{(selectedGame.fileExtensions || []).join(', ') || '—'}</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Status</p>
                                <p className={`mt-1 text-sm font-semibold ${selectedGame.enabled === false ? 'text-orange-600' : 'text-green-600'}`}>
                                    {selectedGame.enabled === false ? 'Disabled' : 'Enabled'}
                                </p>
                                <p className="text-sm text-gray-500">{loadingCounts ? 'Loading creations…' : `${counts[selectedGame.id] ?? 0} creations`}</p>
                            </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-5">
                            <div className="flex-grow" />
                            <button onClick={() => handleToggleEnabled(selectedGame)} disabled={saving} className={`rounded-lg px-3 py-2 text-sm font-semibold ${selectedGame.enabled === false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'}`}>
                                {selectedGame.enabled === false ? 'Enable' : 'Disable'}
                            </button>
                            <button onClick={() => openEdit(selectedGame)} disabled={saving} className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-300">Edit settings</button>
                            {confirmRemoveId === selectedGame.id ? (
                                <button onClick={() => handleRemove(selectedGame)} disabled={saving} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700">Really remove?</button>
                            ) : (
                                <button
                                    onClick={() => setConfirmRemoveId(selectedGame.id)}
                                    disabled={saving || loadingCounts || (counts[selectedGame.id] || 0) > 0}
                                    title={(counts[selectedGame.id] || 0) > 0 ? 'This game has creations — disable it instead.' : 'Remove permanently'}
                                    className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="py-8 text-center text-gray-500">No games configured.</p>
                )}
            </div>

            {form && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeForm}>
                    <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold">{editingId ? `Edit ${form.name || editingId}` : 'Add Game'}</h3>
                        {!editingId && (
                            <div>
                                <label htmlFor="game-id" className="block text-sm font-semibold text-gray-700 mb-1">Id (slug, permanent)</label>
                                <input id="game-id" type="text" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="planet-zoo-2" className="w-full p-2 border rounded-lg font-mono" />
                            </div>
                        )}
                        <div>
                            <label htmlFor="game-name" className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                            <input id="game-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Planet Zoo 2" className="w-full p-2 border rounded-lg" />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label htmlFor="game-short-name" className="block text-sm font-semibold text-gray-700 mb-1">Short name (pill)</label>
                                <input id="game-short-name" type="text" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} placeholder="PZ2" className="w-full p-2 border rounded-lg" />
                            </div>
                            <div>
                                <label htmlFor="game-color" className="block text-sm font-semibold text-gray-700 mb-1">Color</label>
                                <div className="flex items-center gap-2">
                                    <input id="game-color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-10 p-0 border rounded cursor-pointer" />
                                    <input aria-label="Color hex value" type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-24 p-2 border rounded-lg font-mono" />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="game-sharecode-label" className="block text-sm font-semibold text-gray-700 mb-1">Sharecode field name</label>
                            <input id="game-sharecode-label" type="text" value={form.shareCodeLabel} onChange={(e) => setForm({ ...form, shareCodeLabel: e.target.value })} placeholder="Steam Sharecode" className="w-full p-2 border rounded-lg" />
                            <p className="text-xs text-gray-500 mt-1">Shown when users create or edit a creation for this game.</p>
                        </div>
                        <div className="flex gap-6">
                            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.console} onChange={(e) => setForm({ ...form, console: e.target.checked })} className="h-4 w-4 rounded" /> Console platform</label>
                            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.modsSupported} onChange={(e) => setForm({ ...form, modsSupported: e.target.checked })} className="h-4 w-4 rounded" /> Mods supported</label>
                            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded" /> Enabled</label>
                        </div>
                        <div>
                            <label htmlFor="game-file-extensions" className="block text-sm font-semibold text-gray-700 mb-1">File extensions (comma-separated, for backup uploads)</label>
                            <input id="game-file-extensions" type="text" value={form.extensions} onChange={(e) => setForm({ ...form, extensions: e.target.value })} placeholder=".zoo2, .pz2blueprint" className="w-full p-2 border rounded-lg font-mono" />
                            <p className="text-xs text-gray-500 mt-1">Desktop client support for NEW file types requires a client update — the website works immediately.</p>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={handleFormSave} disabled={saving} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50">
                                {saving ? <Spinner size="small" /> : 'Save'}
                            </button>
                            <button onClick={closeForm} disabled={saving} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg">Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GamesManager;
