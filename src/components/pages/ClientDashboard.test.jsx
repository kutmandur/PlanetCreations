import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientDashboard from './ClientDashboard';

vi.mock('../../hooks/useGames', () => ({ default: () => [
    { id: 'planet-coaster-2', name: 'Planet Coaster 2', fileExtensions: ['.park2'] },
    { id: 'planet-zoo', name: 'Planet Zoo', fileExtensions: ['.zoo', '.zooauto', '.zoo_auto', '.pzblueprint'] },
] }));
vi.mock('../../firebase/appCheck', () => ({ getAppCheckTokenIfAvailable: vi.fn() }));
vi.mock('../../firebase/config', () => ({ db: null }));
vi.mock('../../utils/frontierDlcCatalogCache', () => ({ getCachedFrontierDlcCatalogs: () => ({}) }));

const savePath = name => `C:\\Frontier Developments\\Planet Zoo\\12345678901234567\\Saves\\${name}`;
const file = (name, overrides = {}) => ({ name, path: savePath(name), size: 1024, modifiedAt: '2026-09-16T10:00:00Z', modifiedAtMs: 1000, metadataStatus: 'ready', ...overrides });
const zooMetadata = { gameId: 'planet-zoo', kind: 'park', name: 'Test zoo', park: { animalCount: 1 }, requiredDlc: 0 };
const mara = { id: 'A#1', name: 'Mara', species: 'SaltwaterCrocodile', sex: 1, kind: 'habitat', habitats: ['habitat:1'], location: 0, genes: Array(60).fill(0), colourGenes: Array(12).fill(1), grades: [12, 12, 12, 0, 0], ageYears: 5, welfare: 1, blockers: [] };
const analysis = { schemaVersion: 1, animals: [mara], ancestors: { 'A#1': mara }, habitats: [{ id: 'habitat:1', name: 'Habitat 1' }], species: {}, scenario: {}, warnings: [], coverage: { missingAncestors: 0 }, source: { modifiedAt: 1000, gameBuild: 'Test' } };
let indexed, notifyFilesChanged;

beforeEach(() => {
    indexed = { 'Planet Coaster 2': { parks: [], blueprints: [], autosaves: [] }, 'Planet Zoo': { parks: [], blueprints: [], autosaves: [] } };
    window.electronAPI = {
        getStoredPath: vi.fn().mockResolvedValue('C:\\Frontier Developments'),
        scanGames: vi.fn(async () => indexed),
        listAllBackups: vi.fn().mockResolvedValue({}),
        readPlanetZooAnalysis: vi.fn().mockResolvedValue(analysis),
        onFrontierSaveFilesChanged: vi.fn(callback => { notifyFilesChanged = callback; return vi.fn(); }),
    };
});
afterEach(() => { cleanup(); delete window.electronAPI; });

async function openZooFiles(category = 'Parks') {
    render(<ClientDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Planet Zoo', exact: true }));
    if (category !== 'Parks') fireEvent.click(screen.getByRole('button', { name: category, exact: true }));
}

describe('Planet Zoo in the Offline Manager', () => {
    it('opens animal details through View stats on demand, alongside the normal save statistics', async () => {
        indexed['Planet Zoo'].parks = [file('Test.zoo', { frontierMetadata: zooMetadata })];
        await openZooFiles();
        expect(window.electronAPI.readPlanetZooAnalysis).not.toHaveBeenCalled();
        const trigger = screen.getByRole('button', { name: 'View stats' });
        trigger.focus();
        fireEvent.click(trigger);
        expect(await screen.findByRole('tab', { name: 'Animals & habitats' })).toBeInTheDocument();
        expect(window.electronAPI.readPlanetZooAnalysis).toHaveBeenCalledWith(savePath('Test.zoo'));
        expect(screen.getByText('More zoo statistics')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Mara.*Open details/ }));
        fireEvent.click(screen.getByRole('tab', { name: 'Genes' }));
        expect(screen.getByRole('heading', { name: 'Resilience' })).toBeVisible();
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Genes' }), { key: 'Escape' });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Matchmaker' }));
        expect(screen.getByRole('combobox', { name: 'Female' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close stats' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it.each([
        ['Pending.zooauto', 'pending', undefined],
        ['Incomplete.zoo_auto', 'error', 'Metadata is unavailable'],
    ])('opens %s even before the background metadata is available', async (name, metadataStatus, frontierMetadataError) => {
        indexed['Planet Zoo'].autosaves = [file(name, { metadataStatus, frontierMetadataError })];
        await openZooFiles('Autosaves');
        fireEvent.click(screen.getByRole('button', { name: 'View stats' }));
        expect(await screen.findByRole('tab', { name: 'Matchmaker' })).toBeInTheDocument();
        expect(window.electronAPI.readPlanetZooAnalysis).toHaveBeenCalledWith(savePath(name));
        expect(screen.getByText('Zoo save')).toBeInTheDocument();
    });

    it('refreshes an open zoo when the file watcher reports a changed save', async () => {
        indexed['Planet Zoo'].parks = [file('Test.zoo', { frontierMetadata: zooMetadata })];
        await openZooFiles();
        fireEvent.click(screen.getByRole('button', { name: 'View stats' }));
        await screen.findByRole('button', { name: /Mara.*Open details/ });
        window.electronAPI.readPlanetZooAnalysis.mockResolvedValue({ ...analysis, animals: [], source: { ...analysis.source, modifiedAt: 2000 } });
        indexed = { ...indexed, 'Planet Zoo': { ...indexed['Planet Zoo'], parks: [file('Test.zoo', { frontierMetadata: zooMetadata, modifiedAtMs: 2000, size: 2048 })] } };
        await act(async () => notifyFilesChanged());
        await waitFor(() => expect(window.electronAPI.readPlanetZooAnalysis).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('This zoo has no saved animals yet')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('keeps zoo blueprints in the existing statistics view', async () => {
        indexed['Planet Zoo'].blueprints = [file('Shelter.pzblueprint', { frontierMetadata: { gameId: 'planet-zoo', kind: 'blueprint', name: 'Shelter', blueprint: { sceneryCount: 12 }, requiredDlc: 0 } })];
        await openZooFiles('Blueprints');
        fireEvent.click(screen.getByRole('button', { name: 'View stats' }));
        expect(screen.getByText('Zoo blueprint')).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Matchmaker' })).not.toBeInTheDocument();
        expect(window.electronAPI.readPlanetZooAnalysis).not.toHaveBeenCalled();
    });
});
