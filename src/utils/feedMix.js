import {DEFAULT_WEIGHTS, WEIGHT_KEYS, normalizeWeights} from './feedRanking';

// Largest remainders keep displayed integer percentages exactly at the total.
function distribute(weights, keys, total) {
    if (!keys.length) return {};
    let sum = keys.reduce((value, key) => value + weights[key], 0);
    const source = sum > 0 ? weights : DEFAULT_WEIGHTS;
    if (!sum) sum = keys.reduce((value, key) => value + source[key], 0);
    const shares = keys.map(key => ({key, exact: source[key] / sum * total}));
    const result = Object.fromEntries(shares.map(({key, exact}) => [key, Math.floor(exact)]));
    const remainder = total - Object.values(result).reduce((a, b) => a + b, 0);
    shares.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
    for (let i = 0; i < remainder; i++) result[shares[i].key]++;
    return result;
}

export function feedPercentages(weights, disabledKeys = []) {
    const enabled = WEIGHT_KEYS.filter(key => !disabledKeys.includes(key));
    return {...Object.fromEntries(WEIGHT_KEYS.map(key => [key, 0])), ...distribute(normalizeWeights(weights), enabled, 100)};
}

export function changeFeedPercentage(weights, key, value, disabledKeys = []) {
    const current = feedPercentages(weights, disabledKeys);
    if (!WEIGHT_KEYS.includes(key) || disabledKeys.includes(key) || !Number.isFinite(value)) return current;
    const others = WEIGHT_KEYS.filter(other => other !== key && !disabledKeys.includes(other));
    const selected = others.length ? Math.max(0, Math.min(100, Math.round(value))) : 100;
    return {...current, ...distribute(current, others, 100 - selected), [key]: selected};
}
