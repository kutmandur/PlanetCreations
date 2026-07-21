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

const GamesManager = ({ setModalMessage }) => {
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

    const openAdd = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); };
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
            setForm(null);
            setEditingId(null);
        }
    };

    const handleToggleEnabled = async (g) => {
        const nextGames = games.map((x) => (x.id === g.id ? { ...x, enabled: x.enabled === false } : x));
        await persist(nextGames);
    };

    const handleMove = async (g, dir) => {
        const sorted = [...games];
        const idx = sorted.findIndex((x) => x.id === g.id);
        const swap = idx + dir;
        if (swap < 0 || swap >= sorted.length) return;
        [sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]];
        await persist(sorted.map((x, i) => ({ ...x, order: i })));
    };

    const handleRemove = async (g) => {
        if ((counts[g.id] || 0) > 0) return;
        const nextGames = games.filter((x) => x.id !== g.id);
        if (nextGames.length === 0) { setModalMessage('At least one game must remain.'); return; }
        const nextDefault = getDefaultGameId() === g.id ? null : getDefaultGameId();
        if (await persist(nextGames, nextDefault)) {
            // Zugehörige Konfig-Docs mit abräumen (searchIndex/{id} räumt der
            // "Rebuild General Index"-Button ab — Clients dürfen dort nicht schreiben).
            try {
                await Promise.all([
                    deleteDoc(doc(db, 'categories', g.id)),
                    deleteDoc(doc(db, 'dlcs', g.id)),
                ]);
            } catch (e) {
                setModalMessage(`Game removed, but deleting categories/dlcs failed: ${e.message}`);
            }
            setConfirmRemoveId(null);
            setModalMessage(`"${g.name}" removed. Please run "Rebuild General Index" (Indexes tab) to clean up its search index.`);
        }
    };

    const handleDefaultChange = async (id) => {
        await persist(games, id);
    };

    const enabledGames = games.filter((g) => g.enabled !== false);

    return (
        <div className="max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-2xl font-bold">Games</h2>
                    <button onClick={openAdd} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">+ Add Game</button>
                </div>
                <p className="text-gray-600 text-sm mb-4">
                    Games are runtime configuration: tabs, colors, platform/mod options and
                    upload file types follow this list everywhere. Disabling hides a game
                    without touching data; removing is only possible while it has no creations.
                </p>

                <div className="flex items-center gap-3 mb-6">
                    <span className="text-sm font-semibold text-gray-700">Default game (new users, fallbacks):</span>
                    <select
                        value={getDefaultGameId()}
                        onChange={(e) => handleDefaultChange(e.target.value)}
                        disabled={saving}
                        className="p-2 border rounded-lg"
                    >
                        {enabledGames.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                    </select>
                </div>

                <div className="space-y-3">
                    {games.map((g, idx) => (
                        <div key={g.id} className={`border rounded-lg p-4 flex flex-wrap items-center gap-3 ${g.enabled === false ? 'opacity-50 bg-gray-50' : ''}`}>
                            <div className="flex flex-col gap-1">
                                <button onClick={() => handleMove(g, -1)} disabled={saving || idx === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none">▲</button>
                                <button onClick={() => handleMove(g, 1)} disabled={saving || idx === games.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none">▼</button>
                            </div>
                            <span className="w-6 h-6 rounded-full border flex-shrink-0" style={{ backgroundColor: g.color }} title={g.color}></span>
                            <div className="flex-grow min-w-[180px]">
                                <div className="font-bold text-gray-800">{g.name} <span className="text-xs font-mono text-gray-400">({g.id})</span></div>
                                <div className="text-xs text-gray-500">
                                    {g.shortName || '—'} · {g.platforms?.includes('console') ? 'PC + Console' : 'PC'} · Mods: {g.modsSupported ? 'yes' : 'no'} · Files: {(g.fileExtensions || []).join(' ') || '—'}
                                </div>
                            </div>
                            <span className="text-sm text-gray-600 whitespace-nowrap">
                                {loadingCounts ? '…' : `${counts[g.id] ?? 0} creations`}
                            </span>
                            <button onClick={() => handleToggleEnabled(g)} disabled={saving} className={`text-sm font-semibold py-1 px-3 rounded-lg ${g.enabled === false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'}`}>
                                {g.enabled === false ? 'Enable' : 'Disable'}
                            </button>
                            <button onClick={() => openEdit(g)} disabled={saving} className="text-sm font-semibold py-1 px-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800">Edit</button>
                            {confirmRemoveId === g.id ? (
                                <button onClick={() => handleRemove(g)} disabled={saving} className="text-sm font-bold py-1 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white">Really remove?</button>
                            ) : (
                                <button
                                    onClick={() => setConfirmRemoveId(g.id)}
                                    disabled={saving || loadingCounts || (counts[g.id] || 0) > 0}
                                    title={(counts[g.id] || 0) > 0 ? 'This game has creations — disable it instead.' : 'Remove permanently'}
                                    className="text-sm font-semibold py-1 px-3 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {form && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4" onClick={() => setForm(null)}>
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold">{editingId ? `Edit ${form.name || editingId}` : 'Add Game'}</h3>
                        {!editingId && (
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Id (slug, permanent)</label>
                                <input type="text" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="planet-zoo-2" className="w-full p-2 border rounded-lg font-mono" />
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Planet Zoo 2" className="w-full p-2 border rounded-lg" />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Short name (pill)</label>
                                <input type="text" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} placeholder="PZ2" className="w-full p-2 border rounded-lg" />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Color</label>
                                <div className="flex items-center gap-2">
                                    <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-10 p-0 border rounded cursor-pointer" />
                                    <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-24 p-2 border rounded-lg font-mono" />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Sharecode field name</label>
                            <input type="text" value={form.shareCodeLabel} onChange={(e) => setForm({ ...form, shareCodeLabel: e.target.value })} placeholder="Steam Sharecode" className="w-full p-2 border rounded-lg" />
                            <p className="text-xs text-gray-500 mt-1">Shown when users create or edit a creation for this game.</p>
                        </div>
                        <div className="flex gap-6">
                            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.console} onChange={(e) => setForm({ ...form, console: e.target.checked })} className="h-4 w-4 rounded" /> Console platform</label>
                            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.modsSupported} onChange={(e) => setForm({ ...form, modsSupported: e.target.checked })} className="h-4 w-4 rounded" /> Mods supported</label>
                            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded" /> Enabled</label>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">File extensions (comma-separated, for backup uploads)</label>
                            <input type="text" value={form.extensions} onChange={(e) => setForm({ ...form, extensions: e.target.value })} placeholder=".zoo2, .pz2blueprint" className="w-full p-2 border rounded-lg font-mono" />
                            <p className="text-xs text-gray-500 mt-1">Desktop client support for NEW file types requires a client update — the website works immediately.</p>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={handleFormSave} disabled={saving} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50">
                                {saving ? <Spinner size="small" /> : 'Save'}
                            </button>
                            <button onClick={() => setForm(null)} disabled={saving} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg">Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GamesManager;
