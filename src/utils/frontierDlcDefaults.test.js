import { describe, it, expect } from 'vitest';
import { DLC_SEED_DATA, mergeFrontierDlcNames } from './frontierDlcDefaults';

describe('reviewed DLC defaults', () => {
    it('adds missing releases while preserving custom and existing names', () => {
        const names = mergeFrontierDlcNames('planet-coaster-2', ['Custom Pack', 'Silver Screen Pack']);
        expect(names).toContain('Spooktacular Pack');
        expect(names[0]).toBe('Custom Pack');
        expect(names.filter(name => name === 'Silver Screen Pack')).toHaveLength(1);
        expect(mergeFrontierDlcNames('planet-zoo-2')).toEqual(['Deluxe Upgrade Pack', 'Bonus Content Pack']);
    });
    it('does not invent save mappings or include standalone soundtracks', () => {
        expect(DLC_SEED_DATA['planet-zoo-2'].every(entry => entry.bit === null && entry.identifiers.length === 0)).toBe(true);
        expect(DLC_SEED_DATA['planet-coaster-2'].at(-1)).toEqual({
            name: 'Spooktacular Pack', bit: null, identifiers: ['ContentPDLC6'],
        });
        expect(mergeFrontierDlcNames('unknown', ['Custom'])).toEqual(['Custom']);
    });
});
