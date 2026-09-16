export function encodeIndexInput(value) {
    if (value?.toMillis) return {__timestampMs: value.toMillis()};
    if (Array.isArray(value)) return value.map(encodeIndexInput);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeIndexInput(child)]));
    return value;
}
export function decodeIndexInput(value) {
    if (typeof value?.__timestampMs === 'number') return {seconds: Math.floor(value.__timestampMs / 1000), toMillis: () => value.__timestampMs};
    if (Array.isArray(value)) return value.map(decodeIndexInput);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeIndexInput(child)]));
    return value;
}
