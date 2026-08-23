import {
    getPlanetCoaster2ResearchPack,
    PLANET_COASTER_2_RESEARCH_CATALOG,
} from './planetCoaster2ResearchPacks';

describe('Planet Coaster 2 research reward catalog', () => {
    test('contains the complete Update 11 reward set plus special values and sentinel', () => {
        expect(Object.keys(PLANET_COASTER_2_RESEARCH_CATALOG)).toHaveLength(146);
        expect(getPlanetCoaster2ResearchPack(2100)).toMatchObject({
            label: 'Resurgence',
            category: 'Flat rides & blueprints',
            known: true,
        });
        expect(getPlanetCoaster2ResearchPack(2621)).toMatchObject({
            label: 'Vector · Swinging Mine Train',
            category: 'Coasters & blueprints',
            known: true,
        });
        expect(getPlanetCoaster2ResearchPack(2722).label).toBe('Raft Flume');
        expect(getPlanetCoaster2ResearchPack(1000).label).toBe('Gold Splash King Statue');
        expect(getPlanetCoaster2ResearchPack(0).label).toBe('No research requirement');
    });

    test('keeps a useful forward-compatible fallback for future game updates', () => {
        expect(getPlanetCoaster2ResearchPack(9999)).toEqual({
            id: 9999,
            label: 'Unknown research reward #9999',
            category: 'Future or unknown content',
            known: false,
        });
    });
});
