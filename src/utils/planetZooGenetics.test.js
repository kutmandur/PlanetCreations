import { describe, expect, it } from 'vitest';
import { traitDistribution, colourDistribution, conceptionProbability, createPedigree, pairForecast } from './planetZooGenetics';
const zeros = Array(12).fill(0), threes = Array(12).fill(3);
describe('Planet Zoo genetic forecasts', () => {
    it('retains complete haplotypes for exhibit traits', () => {
        const split = [...Array(6).fill(0), ...Array(6).fill(3)];
        const result = traitDistribution(split, split, false, .01, .01, true);
        expect(result.probabilities).toEqual([.25, 0, 0, 0, 0, 0, .5, 0, 0, 0, 0, 0, .25]);
        expect(result.mean).toBe(.5);
    });
    it('has predictable mutation-free endpoints and rejects absent or invalid genomes', () => {
        expect(traitDistribution(zeros, zeros, false, 0, 0).probabilities[12]).toBe(1);
        expect(traitDistribution(zeros, threes, true, 0, 0).probabilities[6]).toBe(1);
        expect(traitDistribution(zeros, zeros, true, 0, 0).probabilities[0]).toBe(1);
        expect(traitDistribution(zeros, [4], false)).toBeNull();
        expect(traitDistribution(undefined, zeros, false)).toBeNull();
    });
    it('includes mutation tails beyond the four-strand game preview and conserves probability', () => {
        const d = traitDistribution(zeros, zeros, false);
        expect(d.preview).toEqual([1, 1]); expect(d.probabilities[11]).toBeGreaterThan(0);
        expect(d.probabilities.reduce((a, b) => a + b)).toBeCloseTo(1, 12);
        expect(d.perfect).toBeCloseTo((1 - .01 * 2 / 3) ** 12, 12);
    });
    it('colour expression respects supported loci and priority, including linked strands', () => {
        expect(colourDistribution(zeros, zeros, [0, 2], 0, 0)[0]).toBe(1);
        expect(colourDistribution(zeros, zeros, [2], 0, 0)[2]).toBe(1);
        expect(colourDistribution(zeros, zeros, [], 0, 0)[99]).toBe(1);
        expect(colourDistribution(zeros, zeros, undefined)).toBeNull();
        const d = colourDistribution([...zeros.slice(0, 6), ...threes.slice(0, 6)], [...zeros.slice(0, 6), ...threes.slice(0, 6)], [0, 1], 0, 0);
        expect(d[0]).toBe(.25); expect(d[99]).toBe(.75); expect(d[1] || 0).toBe(0);
    });
    it('uses float32 conception arithmetic, welfare cutoff and unknown configuration', () => {
        const a = { welfare: 1, grades: [0, 0, 0, 3] };
        expect(conceptionProbability(a, a, .3, .15)).toBe(Math.fround(Math.fround(.5 + Math.fround(-.3)) + Math.fround(Math.fround(.3) + Math.fround(.15))));
        expect(conceptionProbability({ ...a, welfare: .659 }, a, .3, .3)).toBe(0);
        expect(conceptionProbability(a, a, null, .3)).toBeNull();
    });
    it('distinguishes full siblings, half siblings, parent-child, missing ancestry and cycles', () => {
        const records = { m: { id: 'm' }, f: { id: 'f' }, a: { mother: 'm', father: 'f' }, b: { mother: 'm', father: 'f' }, c: { mother: 'm', father: 'unknown' } };
        const pedigree = createPedigree(records);
        expect(pedigree('a', 'b').coefficient).toBe(.25);
        expect(pedigree('a', 'm').coefficient).toBe(.25);
        expect(pedigree('a', 'c')).toEqual({ coefficient: .125, missing: 1 });
        expect(createPedigree({ a: { mother: 'b' }, b: { father: 'a' } })('a', 'b').coefficient).toBeNull();
    });
    it('does not turn absent data into a certain match or conflate readiness with genetic traits', () => {
        const m = { id: 'm', name: 'M', species: 'Test', kind: 'habitat', sex: 1, genes: Array(60).fill(0), grades: [12, 12, 12, 0, 0], habitats: ['h'], location: 0, welfare: 1, blockers: ['contraception'] };
        const f = { ...m, id: 'f', name: 'F', sex: 0, blockers: [] };
        const data = { species: {}, ancestors: { m, f }, scenario: {} };
        const result = pairForecast(m, f, data);
        expect(result.chance).toBeNull(); expect(result.blocked).toBe(true); expect(result.traits).toHaveLength(4);
        expect(result.warnings.some(w => w.code === 'catalog')).toBe(true);
        expect(pairForecast(m, { ...f, species: 'Other' }, data)).toBeNull();
        expect(pairForecast(m, m, data)).toBeNull();
    });
});
