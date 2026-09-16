import {describe, expect, test} from 'vitest';
import golden from './feedRanking.golden.json';
import {rankCreations} from './feedRanking';
import {searchHomeIndex} from './homeIndexSearch';
import {encodeIndexInput, decodeIndexInput} from './homeIndexTransfer';
const now = 1800000000000;
const creations = Array.from({length: 120}, (_, i) => ({
    id: `c${i}`, title: `Park ${i}`, tags: [i % 2 ? 'nature' : 'coaster'],
    createdAt: {toMillis: () => now - i * 86400000}, activityAt: {toMillis: () => now - (i % 21) * 86400000},
    activityScore: i % 7, likes: i % 23, dislikes: i % 5, views: i * 11,
    liveStream: i % 29 === 0 ? {platform: 'twitch', expiresAt: {toMillis: () => now + 3600000}} : null,
}));
describe('complete index ranking and worker compatibility', () => {
    test('cursor optimization preserves the exact pre-change order for fixed seeds and weights', () => {
        for (const fixture of golden) expect(rankCreations(creations, fixture.context).map(c => c.id)).toEqual(fixture.ids);
    });
    test('worker serialization keeps all timestamps, live signals, rare matches and personal filters', () => {
        const input = {shouldUseIndexSearch: true, indexCreations: creations, homeState: {activeCategory: 'All', searchTerm: '', showModsOnly: false, sortBy: 'recommended'},
            user: {uid: 'member'}, userProfile: {}, interestMap: {}, activeTab: 'planet-coaster-2', selectedDlcs: [], seed: 42, now};
        const direct = searchHomeIndex(input);
        const transferred = searchHomeIndex(decodeIndexInput(encodeIndexInput(input)));
        expect(transferred.map(c => c.id)).toEqual(direct.map(c => c.id));
        expect(new Set(transferred.map(c => c.id)).size).toBe(120);
        input.homeState = {...input.homeState, searchTerm: 'Park 119', filterTags: ['nature']};
        expect(searchHomeIndex(input).some(c => c.id === 'c119')).toBe(true);
        expect(searchHomeIndex(input).every(c => c.tags.includes('nature'))).toBe(true);
    });
});
