// Analytical port of the native-backed research. No RNG state is inferred.
export const TRAITS = [
    { id: 'size', label: 'Size', group: 0, max: 12 },
    { id: 'longevity', label: 'Longevity', group: 1, max: 12 },
    { id: 'fertility', label: 'Fertility', group: 3, max: 6 },
    { id: 'immunity', label: 'Immunity', group: 4, max: 6 },
];
export const MORPHS = ['Albino', 'Erythristic', 'Leucistic', 'Melanistic', 'Xanthic', 'Piebald'];
export const BLOCKERS = { pregnant: 'Already pregnant', infertile: 'Not currently fertile', contraception: 'Contraception active', failedConception: 'Saved conception block', interbirth: 'Interbirth period', lowWelfare: 'Welfare below 66 %', infection: 'Infection', injury: 'Injury prevents mating' };
export const LOCATIONS = ['In habitat', 'Veterinary surgery', 'Quarantine', 'Free roaming', 'Being transported', 'Trade centre'];
const valid = g => Array.isArray(g) && g.length === 12 && g.every(x => Number.isInteger(x) && x >= 0 && x < 4);
export function traitGenes(a, trait) { return a.kind === 'exhibit' ? a[`${trait.id}Genes`] : a.genes?.slice(trait.group * 12, trait.group * 12 + 12); }
export function traitGrade(a, trait) { return a.grades?.[trait.group] ?? null; }
export function speciesLabel(s = '') { return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); }

export function traitDistribution(m, f, diversity, mutation = 0.01, crossover = 0.01, exhibit = false) {
    if (!valid(m) || !valid(f) || ![mutation, crossover].every(p => Number.isFinite(p) && p >= 0 && p <= 1)) return null;
    const max = diversity ? 6 : 12, probabilities = Array(max + 1).fill(0), preview = [];
    for (let ms = 0; ms < 2; ms++) for (let fs = 0; fs < 2; fs++) {
        let score = 0;
        for (let i = 0; i < 6; i++) score += diversity ? Number(m[ms * 6 + i] !== f[fs * 6 + i]) : Number(m[ms * 6 + i] < 2) + Number(f[fs * 6 + i] < 2);
        preview.push(score); if (exhibit) probabilities[score] += 0.25;
    }
    if (!exhibit) {
        let state = Array.from({ length: 4 }, () => Array(max + 1).fill(0)); for (const strand of state) strand[0] = 0.25;
        const alleles = g => Array.from({ length: 4 }, (_, i) => i === g ? 1 - mutation : mutation / 3);
        for (let i = 0; i < 6; i++) {
            const next = Array.from({ length: 4 }, () => Array(max + 1).fill(0));
            for (let s = 0; s < 4; s++) {
                const ms = s >> 1, fs = s & 1, ma = alleles(m[ms * 6 + i]), fa = alleles(f[fs * 6 + i]);
                const equal = ma.reduce((sum, p, j) => sum + p * fa[j], 0), mp = ma[0] + ma[1], fp = fa[0] + fa[1];
                const increments = diversity ? [equal, 1 - equal] : [(1 - mp) * (1 - fp), mp * (1 - fp) + (1 - mp) * fp, mp * fp];
                for (let score = 0; score <= max; score++) if (state[s][score]) for (let d = 0; d < increments.length; d++) {
                    if (score + d > max) continue;
                    for (let ns = 0; ns < 4; ns++) {
                        const p = i === 5 ? Number(s === ns) : (ms === (ns >> 1) ? 1 - crossover : crossover) * (fs === (ns & 1) ? 1 - crossover : crossover);
                        next[ns][score + d] += state[s][score] * increments[d] * p;
                    }
                }
            }
            state = next;
        }
        for (let score = 0; score <= max; score++) probabilities[score] = state.reduce((sum, s) => sum + s[score], 0);
    }
    const quantile = q => { let sum = 0; for (let i = 0; i <= max; i++) { sum += probabilities[i]; if (sum >= q - 1e-12) return i / max; } return 1; };
    return { probabilities, max, mean: probabilities.reduce((sum, p, i) => sum + p * i / max, 0), p10: quantile(0.1), p90: quantile(0.9), perfect: probabilities[max], preview: [Math.min(...preview) / max, Math.max(...preview) / max] };
}
export function colourDistribution(m, f, supported, mutation = 0.01, crossover = 0.01) {
    if (!valid(m) || !valid(f) || !Array.isArray(supported)) return null;
    const gametes = genes => {
        let state = Array(128).fill(0); state[0] = state[64] = 0.5;
        for (let locus = 0; locus < 6; locus++) {
            const next = Array(128).fill(0);
            for (let s = 0; s < 2; s++) for (let mask = 0; mask < 64; mask++) {
                const base = state[s * 64 + mask]; if (!base) continue;
                const pZero = genes[s * 6 + locus] === 0 ? 1 - mutation : mutation / 3;
                for (let zero = 0; zero < 2; zero++) for (let ns = 0; ns < 2; ns++) {
                    const p = locus === 5 ? Number(ns === s) : ns === s ? 1 - crossover : crossover;
                    next[ns * 64 + (zero ? mask | (1 << locus) : mask)] += base * (zero ? pZero : 1 - pZero) * p;
                }
            }
            state = next;
        }
        return state.slice(0, 64).map((p, mask) => p + state[mask + 64]);
    };
    const ma = gametes(m), fa = gametes(f), result = { 99: 0 };
    const loci = [...supported].sort((a, b) => a - b);
    const expression = Array.from({length: 64}, (_, mask) => loci.find(i => mask & (1 << i)) ?? 99);
    for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) { const locus = expression[a & b]; result[locus] = (result[locus] || 0) + ma[a] * fa[b]; }
    return result;
}
export function currentMorph(a, rules) {
    if (!valid(a.colourGenes) || !Array.isArray(rules?.morphs)) return null;
    return [...rules.morphs].sort((x, y) => x - y).find(i => a.colourGenes[i] === 0 && a.colourGenes[i + 6] === 0) ?? 99;
}
export function conceptionProbability(m, f, speciesFertility, bonus) {
    const mw = m.welfare, fw = f.welfare, mg = m.grades?.[3], fg = f.grades?.[3];
    if (![mw, fw, mg, fg, speciesFertility, bonus].every(x => typeof x === 'number' && Number.isFinite(x)) || mw < 0 || mw > 1 || fw < 0 || fw > 1 || ![mg, fg].every(x => Number.isInteger(x) && x >= 0 && x <= 6)) return null;
    const f32 = Math.fround;
    if (Math.min(f32(mw), f32(fw)) < f32(0.66)) return 0;
    const genetic = f32(f32(f32(f32(mg * f32(mw)) + f32(fg * f32(fw))) / 12) + f32(-0.3));
    return Math.max(0, Math.min(1, f32(genetic + f32(f32(speciesFertility) + f32(bonus)))));
}
export function createPedigree(records) {
    const generations = new Map(), memo = new Map();
    const generation = (id, stack = new Set()) => {
        if (!id) return -1; if (generations.has(id)) return generations.get(id);
        if (stack.has(id) || stack.size > 100) throw Error('The pedigree contains a cycle or more than 100 generations.');
        stack.add(id); const a = records[id]; const value = a ? Math.max(generation(a.mother, stack), generation(a.father, stack)) + 1 : 0; stack.delete(id); generations.set(id, value); return value;
    };
    const kinship = (a, b, depth = 0) => {
        if (!a || !b) return 0;
        if (depth > 200 || memo.size > 100000) throw Error('The pedigree is too complex for interactive calculation.');
        const key = JSON.stringify([a, b]); if (memo.has(key)) return memo.get(key);
        let value;
        if (a === b) value = (1 + kinship(records[a]?.mother, records[a]?.father, depth + 1)) / 2;
        else if (generation(a) < generation(b) || generation(a) === generation(b) && a < b) value = kinship(b, a, depth + 1);
        else value = (kinship(records[a]?.mother, b, depth + 1) + kinship(records[a]?.father, b, depth + 1)) / 2;
        memo.set(key, value); return value;
    };
    return (a, b) => {
        try {
            generation(a); generation(b); const seen = new Set(), missing = new Set(), queue = [a, b];
            for (let i = 0; i < queue.length; i++) { const id = queue[i]; if (!id || seen.has(id)) continue; seen.add(id); const record = records[id]; if (!record || record.missing || record.missingRecord) missing.add(id); if (record && !record.missing) queue.push(record.mother, record.father); }
            return { coefficient: kinship(a, b), missing: missing.size };
        } catch (error) { return { coefficient: null, missing: null, error: error.message }; }
    };
}
export function pairForecast(m, f, data, pedigree = createPedigree(data.ancestors)) {
    if (!m || !f || m.id === f.id || m.species !== f.species || m.kind !== f.kind || m.sex !== 1 || f.sex !== 0) return null;
    const rules = data.species[m.species], traits = TRAITS.map(t => ({ ...t, distribution: traitDistribution(traitGenes(m, t), traitGenes(f, t), t.max === 6, 0.01, 0.01, m.kind === 'exhibit') })).filter(t => t.distribution);
    const warnings = [];
    const parents = a => [a.mother, a.father].filter(Boolean);
    const immediateFamily = parents(m).includes(f.id) || parents(f).includes(m.id) || parents(m).some(id => parents(f).includes(id));
    const relation = pedigree(m.id, f.id);
    if (immediateFamily) warnings.push({ code: 'family', label: 'Close relatives: parent and offspring, or shared parents.', level: 'danger' });
    else if (relation.coefficient > 0) warnings.push({ code: 'related', label: 'Shared ancestors in the saved pedigree.', level: 'warning' });
    if (relation.missing) warnings.push({ code: 'missing', label: `Missing ancestor records: ${relation.missing}. Relatedness may be underestimated.`, level: 'warning' });
    if (relation.error) warnings.push({ code: 'pedigree', label: relation.error, level: 'warning' });
    for (const a of [m, f]) {
        for (const b of a.blockers || []) warnings.push({ code: `${a.id}:${b}`, label: `${a.name}: ${BLOCKERS[b] || b}`, level: 'danger' });
        if (a.mourningSeconds > 0) warnings.push({ code: `mourning:${a.id}`, label: `${a.name}: Mourning period is active.`, level: 'warning' });
        const monogamous = rules?.monogamy === 0 || rules?.monogamy === (a.sex === 1 ? 1 : 2);
        if (monogamous && a.boundMateEntity && a.boundMateEntity !== (a.id === m.id ? f.entity : m.entity)) warnings.push({ code: `bond:${a.id}`, label: `${a.name}: Bonded to another animal (mate lock icon in the game).`, level: 'warning' });
        const alphaRequired = rules?.alphaOnly === 0 || rules?.alphaOnly === (a.sex === 0 ? 1 : 2);
        if (alphaRequired && a.isAlpha === false && data.scenario.socialGroupsEnabled !== false) warnings.push({ code: `alpha:${a.id}`, label: `${a.name}: This species requires alpha status; this animal is not recorded as an alpha.`, level: 'warning' });
    }
    if (!m.habitats?.some(id => f.habitats?.includes(id)) || (m.kind === 'habitat' && (m.location !== 0 || f.location !== 0))) warnings.push({ code: 'location', label: 'The animals are not currently together in the same habitat or exhibit.', level: 'warning' });
    if (data.scenario.matingDisabled === true) warnings.push({ code: 'sandbox', label: 'Mating is disabled by the saved sandbox ageing setting.', level: 'danger' });
    if (!rules?.catalogKnown) warnings.push({ code: 'catalog', label: 'No verified species rules are available, as can happen with modded animals. Species-dependent predictions are unavailable.', level: 'warning' });
    const bonus = data.scenario.gameMode === 'Sandbox' && data.scenario.researchEnabled === false ? rules?.maxResearchBonus : rules?.researchBonus;
    const chance = m.kind === 'habitat' ? conceptionProbability(m, f, rules?.fertility, bonus) : null;
    const blocked = Boolean(m.blockers?.length || f.blockers?.length || data.scenario.matingDisabled === true);
    return { traits, warnings, relation, immediateFamily, colour: colourDistribution(m.colourGenes, f.colourGenes, rules?.morphs), chance, blocked, researchBonus: bonus, score: traits.length ? traits.reduce((sum, t) => sum + t.distribution.mean, 0) / traits.length : null };
}
