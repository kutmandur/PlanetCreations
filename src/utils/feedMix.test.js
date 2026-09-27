import {feedPercentages, changeFeedPercentage} from './feedMix';
import {DEFAULT_WEIGHTS, WEIGHT_KEYS} from './feedRanking';
const sum = values => Object.values(values).reduce((a, b) => a + b, 0);
test('legacy relative weights display exactly 100 integer percent', () => {
    const result = feedPercentages(Object.fromEntries(WEIGHT_KEYS.map(key => [key, 100])));
    expect(sum(result)).toBe(100);
    expect(Object.values(result).every(Number.isInteger)).toBe(true);
});
test('selected share stays exact and other shares shrink proportionally', () => {
    const result = changeFeedPercentage(DEFAULT_WEIGHTS, 'live', 55);
    expect(result.live).toBe(55);
    expect(sum(result)).toBe(100);
    for (const key of WEIGHT_KEYS.filter(key => key !== 'live')) expect(Math.abs(result[key] - DEFAULT_WEIGHTS[key] / 2)).toBeLessThanOrEqual(0.5);
});
test('moving away from 100 percent redistributes to the other sliders', () => {
    const full = changeFeedPercentage(DEFAULT_WEIGHTS, 'live', 100);
    const result = changeFeedPercentage(full, 'live', 0);
    expect(result.live).toBe(0);expect(sum(result)).toBe(100);
    expect(result.recency).toBeGreaterThan(0);
});
test('disabled personalization contributes zero and stays disabled during edits', () => {
    let weights = feedPercentages(DEFAULT_WEIGHTS, ['affinity']);
    for (let i = 0; i < 300; i++) {
        weights = changeFeedPercentage(weights, WEIGHT_KEYS[i % 6], i % 101, ['affinity']);
        expect(sum(weights)).toBe(100);expect(weights.affinity).toBe(0);
        expect(Object.values(weights).every(v => Number.isInteger(v) && v >= 0 && v <= 100)).toBe(true);
    }
});
