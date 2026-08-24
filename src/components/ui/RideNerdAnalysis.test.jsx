import React from 'react';
import {render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import RideNerdAnalysis from './RideNerdAnalysis';

const context = {
    beginPath: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
};

const channel = (key, label, values, unit = null, description = label) => ({
    key,
    label,
    values: Float32Array.from(values),
    unit,
    description,
});

const path = {
    pathIndex: 0,
    sampleCount: 3,
    channels: [
        channel('time', 'Time', [0, 1, 2], 's'),
        channel('distance', 'Distance', [0, 10, 20], 'm'),
        channel('speed', 'Speed', [0, 5, 10], 'm/s'),
        channel('routeX', 'Route X', [0, 3, 6], 'm', 'Horizontal X position'),
        channel('elevation', 'Elevation', [5, 8, 4], 'm'),
        channel('routeZ', 'Route Z', [0, 4, 8], 'm'),
        channel('orientationX', 'Orientation qX', [0, 0.1, 0.2]),
        channel('orientationY', 'Orientation qY', [0, 0.2, 0.3]),
        channel('orientationZ', 'Orientation qZ', [0, 0.1, 0.2]),
        channel('orientationW', 'Orientation qW', [1, 0.9, 0.8]),
        channel('excitement', 'Excitement', [1, 2, 3]),
        channel('fear', 'Fear', [1, 2, 2]),
        channel('nausea', 'Nausea', [0, 1, 1]),
        channel('lateralAcceleration', 'Lateral acceleration', [0, 2, -2], 'm/s²'),
        channel('verticalAcceleration', 'Vertical acceleration', [0, 4, -4], 'm/s²'),
        channel('longitudinalAcceleration', 'Longitudinal acceleration', [0, 1, -1], 'm/s²'),
        channel('lateralG', 'Lateral G', [0, 0.2, -0.2], 'g'),
        channel('verticalG', 'Vertical G', [1, 1.4, 0.6], 'g'),
        channel('longitudinalG', 'Longitudinal G', [0, 0.1, -0.1], 'g'),
    ],
};

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => {
    vi.restoreAllMocks();
});

test('keeps wheel input inside the chart and shows identified channel names', () => {
    render(<RideNerdAnalysis
        analysis={{getRidePaths: () => [path]}}
        entry={{index: 0, ride: {name: 'Test ride'}}}
    />);

    expect(screen.getByRole('button', {name: 'Route X'})).toHaveAttribute(
        'title',
        'Horizontal X position',
    );
    expect(screen.getByRole('button', {name: 'Orientation qW'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Lateral acceleration'})).toBeInTheDocument();
    expect(screen.getByText(/0% is its lowest and 100% its highest visible value/)).toBeInTheDocument();
    expect(screen.getByText(/Orientation qX–qW is the vehicle rotation quaternion/)).toBeInTheDocument();

    const chart = screen.getByLabelText('Zoomable full-resolution ride chart').parentElement;
    const wheel = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        deltaY: 100,
    });
    expect(chart.dispatchEvent(wheel)).toBe(false);
    expect(wheel.defaultPrevented).toBe(true);
});
