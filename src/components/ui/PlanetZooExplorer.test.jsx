import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Explorer, { PlanetZooExplorerView } from './PlanetZooExplorer';
const animal = (id, sex, overrides = {}) => ({ id, name: id, nameSource: 'custom', species: 'TestSpecies', kind: 'habitat', sex, ageYears: 5, welfare: .9, location: 0, genes: Array(60).fill(0), colourGenes: Array(12).fill(1), grades: [12, 12, 12, 0, 0], habitats: ['habitat:1'], blockers: [], ...overrides });
const mother = animal('Mara', 1, { mother: 'Missing', father: 'Ancestor' }), father = animal('Leo', 0, { mother: 'Missing', father: 'Ancestor' });
const data = { schemaVersion: 1, animals: [mother, father, animal('Nala', 1, { species: 'OtherSpecies', habitats: [], location: 2 })], ancestors: { Mara: mother, Leo: father, Missing: { id: 'Missing', missing: true }, Ancestor: { id: 'Ancestor', name: 'Ahne', sex: 0 } }, habitats: [{ id: 'habitat:1', name: 'Habitat 1', landArea: 400, cleanliness: 1 }], species: { TestSpecies: { catalogKnown: true, fertility: .3, researchBonus: .15, morphs: [] } }, scenario: {}, warnings: [], coverage: { missingAncestors: 1 }, source: { modifiedAt: 1700000000000, gameBuild: 'Test' } };
afterEach(() => { cleanup(); delete window.electronAPI; vi.unstubAllGlobals(); });
describe('Planet Zoo explorer', () => {
    it('groups animals by habitat and actual location, and filters by name', () => {
        render(<PlanetZooExplorerView data={data} />);
        expect(screen.getByRole('heading', { name: /Habitat 1/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /Quarantine/ })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Mara' } });
        expect(screen.getByRole('button', { name: /Mara.*Open details/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Leo.*Open details/ })).not.toBeInTheDocument();
    });
    it('opens pedigree and genes, marks missing records, and escapes back to the list', () => {
        render(<PlanetZooExplorerView data={data} />);
        fireEvent.click(screen.getByRole('button', { name: /Mara.*Open details/ }));
        fireEvent.click(screen.getByRole('tab', { name: 'Pedigree' }));
        expect(screen.getByText('Missing record')).toBeInTheDocument();
        expect(screen.getAllByText('Historical record').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Ahne ♂' }));
        expect(screen.getByRole('button', { name: '← Back to pedigree of Mara' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Genes' }));
        expect(screen.getByText('Colour genome')).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Genes' }), { key: 'Escape' });
        expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
    it('predicts only a valid selected pair, shows warnings and resets both parents on a species change', () => {
        render(<PlanetZooExplorerView data={data} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Matchmaker' }));
        fireEvent.change(screen.getByLabelText('Species'), { target: { value: 'TestSpecies' } });
        fireEvent.change(screen.getByLabelText('Female'), { target: { value: 'Mara' } });
        fireEvent.change(screen.getByLabelText('Male'), { target: { value: 'Leo' } });
        expect(screen.getAllByRole('img')).toHaveLength(4);
        expect(screen.getByText(/Close relatives/)).toBeInTheDocument();
        expect(screen.getByText(/Missing ancestor records: 1/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Target score'), { target: { value: '1' } });
        expect(screen.getAllByText('Chance ≥ 100 %')).toHaveLength(4);
        expect(screen.getAllByText('< 0.1 %').length).toBeGreaterThan(0);
        fireEvent.change(screen.getByLabelText('Species'), { target: { value: 'OtherSpecies' } });
        expect(screen.getByLabelText('Female')).toHaveValue(''); expect(screen.getByLabelText('Male')).toHaveValue('');
        expect(screen.queryByText('Modelled chance per mating attempt')).not.toBeInTheDocument();
    });
    it('supports keyboard tab navigation and empty saves', () => {
        render(<PlanetZooExplorerView data={{ ...data, animals: [], habitats: [] }} />);
        expect(screen.getByText(/no saved animals yet/)).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Animals & habitats' }), { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: 'Matchmaker' })).toHaveAttribute('aria-selected', 'true');
    });
    it('loads only through the capability, retries errors, and ignores stale file responses', async () => {
        let resolveOld;
        window.electronAPI = { readPlanetZooAnalysis: vi.fn(path => path === 'old.zoo' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(data)) };
        const { rerender } = render(<Explorer filePath="old.zoo" />);
        await waitFor(() => expect(window.electronAPI.readPlanetZooAnalysis).toHaveBeenCalledWith('old.zoo'));
        rerender(<Explorer filePath="new.zoo" />);
        await screen.findByRole('searchbox');
        await act(async () => resolveOld({ ...data, animals: [] }));
        expect(screen.getByRole('button', { name: /Mara.*Open details/ })).toBeInTheDocument();
        cleanup();
        window.electronAPI.readPlanetZooAnalysis.mockRejectedValueOnce(Error('Corrupt save file')).mockResolvedValue(data);
        render(<Explorer filePath="retry.zoo" />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Corrupt save file');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await screen.findByRole('searchbox');
    });
    it('offers an explicit fallback on an older client', () => {
        render(<Explorer filePath="test.zoo" />);
        expect(screen.getByText(/This client version does not support/)).toBeInTheDocument();
    });
    it('opens a ranked partner directly in the matchmaker', async () => {
        class WorkerMock { postMessage() { queueMicrotask(() => this.onmessage({ data: { partners: [{ id: 'Leo', score: .8, coefficient: .25, missing: 1, blocked: false, warningCount: 2 }] } })); } terminate() {} }
        vi.stubGlobal('Worker', WorkerMock);
        render(<PlanetZooExplorerView data={data} />);
        fireEvent.click(screen.getByRole('button', { name: /Mara.*Open details/ }));
        fireEvent.click(screen.getByRole('tab', { name: 'Partners', exact: true }));
        fireEvent.click(await screen.findByRole('button', { name: /Leo.*Average genetic score/ }));
        expect(screen.getByRole('tab', { name: 'Matchmaker' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByLabelText('Female')).toHaveValue('Mara'); expect(screen.getByLabelText('Male')).toHaveValue('Leo');
        fireEvent.click(within(screen.getByRole('tabpanel', { name: 'Matchmaker' })).getAllByRole('button', { name: /Open animal details/ })[0]);
        fireEvent.click(screen.getByRole('button', { name: '← Back to matchmaker' }));
        expect(screen.getByLabelText('Female')).toHaveValue('Mara');
    });
});
