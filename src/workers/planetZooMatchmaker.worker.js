import { pairForecast, createPedigree } from '../utils/planetZooGenetics';
self.onmessage = ({ data: { animal, data } }) => {
    try {
        const pedigree = createPedigree(data.ancestors);
        const partners = data.animals.filter(a => a.species === animal.species && a.kind === animal.kind && a.sex !== animal.sex && a.id !== animal.id).map(a => {
            const forecast = pairForecast(animal.sex === 1 ? animal : a, animal.sex === 0 ? animal : a, data, pedigree);
            return { id: a.id, score: forecast.score, coefficient: forecast.relation.coefficient, missing: forecast.relation.missing, blocked: forecast.blocked, warningCount: forecast.warnings.length };
        });
        partners.sort((a, b) => Number(a.blocked) - Number(b.blocked) || (a.coefficient ?? 1) - (b.coefficient ?? 1) || Number(Boolean(a.missing)) - Number(Boolean(b.missing)) || (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id));
        self.postMessage({ partners });
    } catch (error) { self.postMessage({ error: error.message }); }
};
