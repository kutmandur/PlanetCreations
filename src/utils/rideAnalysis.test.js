import { describe, expect, test } from 'vitest';
import { getRidePathSummary, parseRideAnalysisBuffer } from './rideAnalysis';

const byte = value => Uint8Array.from([value]);
const join = parts => {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
};

function makeAnalysis(rideCount = 80) {
    const totalSamples = rideCount * 2;
    const table = [byte(9), byte(rideCount)];
    for (let index = 0; index < rideCount; index += 1) {
        table.push(byte(index + 1), byte(1), byte(0));
    }
    table.push(byte(rideCount));
    for (let index = 0; index < rideCount; index += 1) table.push(byte(2));
    const fields = [];
    for (let field = 0; field < 20; field += 1) {
        const block = new Uint8Array(4 + totalSamples * 4);
        const view = new DataView(block.buffer);
        for (let ride = 0; ride < rideCount; ride += 1) {
            const values = field === 0 ? [0, 1] :
                (field === 1 ? [0, 10] :
                (field === 2 ? [0, 100] :
                    (field === 3 ? [0, 20] :
                        (field === 5 ? [50, 40] :
                            (field === 11 ? [2, 4] : [0, 0])))));
            const setter = field === 0 ? 'setUint32' : 'setFloat32';
            view[setter](4 + (ride * 2) * 4, values[0], true);
            view[setter](4 + (ride * 2 + 1) * 4, values[1], true);
        }
        fields.push(block);
    }
    const cache = join([...table, ...fields]);
    const channels = Array.from({ length: 20 }, (_, index) => ({
        index,
        key: ({ 1: 'time', 2: 'distance', 3: 'speed', 4: 'elevation', 11: 'excitement', 12: 'fear', 13: 'nausea', 17: 'lateralG', 18: 'verticalG', 19: 'longitudinalG' })[index] || `channel${index}`,
        label: `Channel ${index}`,
        unit: null,
        status: 'verified',
    }));
    const manifest = new TextEncoder().encode(JSON.stringify({
        schemaVersion: 1,
        fieldCount: 20,
        trackedRideCount: rideCount,
        pathCount: rideCount,
        totalSampleCount: totalSamples,
        channels,
        rides: Array.from({ length: rideCount }, (_, index) => ({
            entityId: index + 1,
            rideIndex: index,
            name: `Ride ${index + 1}`,
            traceCount: 1,
            pathStart: index,
        })),
    }));
    const header = new Uint8Array(12);
    header.set(new TextEncoder().encode('PCRIDE01'));
    new DataView(header.buffer).setUint32(8, manifest.length, true);
    return join([header, manifest, cache]).buffer;
}

describe('ride-analysis binary decoder', () => {
    test('keeps all full-resolution channels addressable across 80 rides', () => {
        const analysis = parseRideAnalysisBuffer(makeAnalysis());
        expect(analysis.manifest.rides).toHaveLength(80);
        expect(analysis.layout.totalSamples).toBe(160);
        const [lastRide] = analysis.getRidePaths(79, 'Ride 80');
        expect(lastRide.sampleCount).toBe(2);
        expect(lastRide.channels).toHaveLength(20);
        expect([...lastRide.channels.find(channel => channel.key === 'speed').values]).toEqual([0, 20]);
        expect([...lastRide.channels.find(channel => channel.key === 'state').values]).toEqual([0, 1]);
        expect(lastRide.channels[4]).toMatchObject({ key: 'routeX', label: 'Route X', unit: 'm' });
        expect(lastRide.channels[5]).toMatchObject({ key: 'elevation', label: 'Elevation', unit: 'm' });
        expect(lastRide.channels[7]).toMatchObject({ key: 'orientationX', label: 'Orientation qX' });
        expect(lastRide.channels[14]).toMatchObject({
            key: 'lateralAcceleration',
            label: 'Lateral acceleration',
            unit: 'm/s²',
        });
        const summary = getRidePathSummary(lastRide);
        expect(summary.durationSeconds).toBe(10);
        expect(summary.distanceMeters).toBe(100);
        expect(summary.maxSpeedKph).toBe(72);
        expect(summary.largestSampledDropMeters).toBe(10);
        expect(summary.calculatedRatings.excitement).toBe(3);
    });

    test('rejects unsupported data instead of reading arbitrary bytes', () => {
        expect(() => parseRideAnalysisBuffer(new Uint8Array(20))).toThrow(/Unsupported ride-analysis format/);
    });
});
