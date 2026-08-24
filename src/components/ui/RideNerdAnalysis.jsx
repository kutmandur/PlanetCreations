import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRidePathSummary, RIDE_ANALYSIS_DEFAULT_SERIES } from '../../utils/rideAnalysis';

const SERIES_COLORS = {
    state: '#64748b', speed: '#2563eb', elevation: '#7c3aed', excitement: '#16a34a', fear: '#f59e0b',
    nausea: '#dc2626', lateralG: '#06b6d4', verticalG: '#ec4899', longitudinalG: '#f97316',
    routeX: '#0d9488', routeZ: '#4f46e5', orientationX: '#9333ea', orientationY: '#c026d3',
    orientationZ: '#e11d48', orientationW: '#ea580c', lateralAcceleration: '#65a30d',
    verticalAcceleration: '#0891b2', longitudinalAcceleration: '#475569',
};

const displayNumber = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
}) : 'N/A';

function lowerBound(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (values[middle] < target) low = middle + 1;
        else high = middle;
    }
    return low;
}

function CanvasRideChart({ path, selectedKeys, xAxis }) {
    const canvasRef = useRef(null);
    const chartRef = useRef(null);
    const dragRef = useRef(null);
    const [view, setView] = useState({ start: 0, end: 1 });
    const [hover, setHover] = useState(null);
    const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
    const channelsByKey = useMemo(() => new Map(path.channels.map(channel => [channel.key, channel])), [path]);
    const xChannel = channelsByKey.get(xAxis) || channelsByKey.get('time');
    const activeChannels = useMemo(() => selectedKeys
        .map(key => channelsByKey.get(key))
        .filter(channel => channel && channel.key !== xAxis), [channelsByKey, selectedKeys, xAxis]);

    useEffect(() => setView({ start: 0, end: 1 }), [path.pathIndex, xAxis]);
    useEffect(() => {
        const observer = new MutationObserver(() => setDarkMode(document.documentElement.classList.contains('dark')));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !xChannel?.values?.length) return undefined;
        const context = canvas.getContext('2d');
        const draw = () => {
            const rect = canvas.getBoundingClientRect();
            const width = Math.max(320, Math.floor(rect.width));
            const height = Math.max(280, Math.floor(rect.height));
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
                canvas.width = width * ratio;
                canvas.height = height * ratio;
            }
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            const colors = darkMode ? {
                background: '#111827', grid: '#374151', text: '#d1d5db', muted: '#9ca3af',
            } : { background: '#ffffff', grid: '#e5e7eb', text: '#1f2937', muted: '#6b7280' };
            context.fillStyle = colors.background;
            context.fillRect(0, 0, width, height);
            const plot = { left: 52, right: width - 18, top: 20, bottom: height - 38 };
            context.strokeStyle = colors.grid;
            context.fillStyle = colors.muted;
            context.font = '11px system-ui';
            context.lineWidth = 1;
            // Canvas text state survives redraws. The X-axis leaves it at
            // "right", which otherwise pushes the next Y-axis labels outside.
            context.textAlign = 'left';
            for (let line = 0; line <= 4; line += 1) {
                const y = plot.top + ((plot.bottom - plot.top) * line) / 4;
                context.beginPath();
                context.moveTo(plot.left, y);
                context.lineTo(plot.right, y);
                context.stroke();
                context.fillText(`${Math.round(100 - line * 25)}%`, 13, y + 4);
            }
            const xValues = xChannel.values;
            const fullMin = xValues[0];
            const fullMax = xValues[xValues.length - 1];
            const fullSpan = Math.max(Number.EPSILON, fullMax - fullMin);
            const visibleMin = fullMin + fullSpan * view.start;
            const visibleMax = fullMin + fullSpan * view.end;
            const first = Math.max(0, lowerBound(xValues, visibleMin) - 1);
            const last = Math.min(xValues.length - 1, lowerBound(xValues, visibleMax) + 1);
            const plotWidth = Math.max(1, plot.right - plot.left);
            const xAt = index => plot.left + ((xValues[index] - visibleMin) / Math.max(Number.EPSILON, visibleMax - visibleMin)) * plotWidth;

            for (let tick = 0; tick <= 5; tick += 1) {
                const ratioX = tick / 5;
                const x = plot.left + ratioX * plotWidth;
                const value = visibleMin + ratioX * (visibleMax - visibleMin);
                context.strokeStyle = colors.grid;
                context.beginPath();
                context.moveTo(x, plot.top);
                context.lineTo(x, plot.bottom);
                context.stroke();
                context.fillStyle = colors.muted;
                context.textAlign = tick === 0 ? 'left' : (tick === 5 ? 'right' : 'center');
                context.fillText(`${displayNumber(value, 1)} ${xAxis === 'distance' ? 'm' : 's'}`, x, height - 14);
            }

            for (const channel of activeChannels) {
                let min = Infinity;
                let max = -Infinity;
                for (let index = first; index <= last; index += 1) {
                    const value = channel.values[index];
                    if (!Number.isFinite(value)) continue;
                    min = Math.min(min, value);
                    max = Math.max(max, value);
                }
                if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
                const span = Math.max(Number.EPSILON, max - min);
                const yAt = value => plot.bottom - ((value - min) / span) * (plot.bottom - plot.top);
                context.strokeStyle = SERIES_COLORS[channel.key] || '#64748b';
                context.lineWidth = 1.5;
                context.globalAlpha = 0.92;
                const visiblePoints = last - first + 1;
                if (visiblePoints <= plotWidth * 2) {
                    context.beginPath();
                    let started = false;
                    for (let index = first; index <= last; index += 1) {
                        const value = channel.values[index];
                        if (!Number.isFinite(value)) continue;
                        const x = xAt(index);
                        const y = yAt(value);
                        if (!started) { context.moveTo(x, y); started = true; } else context.lineTo(x, y);
                    }
                    context.stroke();
                } else {
                    const bucketSize = Math.ceil(visiblePoints / plotWidth);
                    context.beginPath();
                    for (let start = first; start <= last; start += bucketSize) {
                        const end = Math.min(last, start + bucketSize - 1);
                        let bucketMin = Infinity;
                        let bucketMax = -Infinity;
                        for (let index = start; index <= end; index += 1) {
                            const value = channel.values[index];
                            if (Number.isFinite(value)) {
                                bucketMin = Math.min(bucketMin, value);
                                bucketMax = Math.max(bucketMax, value);
                            }
                        }
                        if (!Number.isFinite(bucketMin)) continue;
                        const x = xAt(Math.floor((start + end) / 2));
                        context.moveTo(x, yAt(bucketMin));
                        context.lineTo(x, yAt(bucketMax));
                    }
                    context.stroke();
                }
                context.globalAlpha = 1;
            }
        };
        draw();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
        observer?.observe(canvas);
        return () => observer?.disconnect();
    }, [activeChannels, darkMode, path, view, xAxis, xChannel]);

    const updateHover = event => {
        if (!xChannel?.values?.length) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratioX = Math.min(1, Math.max(0, (event.clientX - rect.left - 52) / Math.max(1, rect.width - 70)));
        const xValues = xChannel.values;
        const fullMin = xValues[0];
        const fullMax = xValues[xValues.length - 1];
        const target = fullMin + (view.start + ratioX * (view.end - view.start)) * (fullMax - fullMin);
        const index = Math.min(xValues.length - 1, lowerBound(xValues, target));
        setHover({ index, x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width });
    };

    const handleWheel = useCallback(event => {
        event.preventDefault();
        event.stopPropagation();
        if (event.deltaY === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const anchor = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        setView(current => {
            const currentSpan = current.end - current.start;
            const nextSpan = Math.min(1, Math.max(0.005, currentSpan * (event.deltaY > 0 ? 1.25 : 0.8)));
            const anchorValue = current.start + currentSpan * anchor;
            let start = anchorValue - nextSpan * anchor;
            start = Math.min(1 - nextSpan, Math.max(0, start));
            return { start, end: start + nextSpan };
        });
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return undefined;
        chart.addEventListener('wheel', handleWheel, { passive: false });
        return () => chart.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    return (
        <div ref={chartRef} className="relative overscroll-contain overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <canvas
                ref={canvasRef}
                className="block h-[22rem] w-full cursor-crosshair touch-none"
                aria-label="Zoomable full-resolution ride chart"
                onMouseMove={updateHover}
                onMouseLeave={() => setHover(null)}
                onPointerDown={event => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragRef.current = { x: event.clientX, view };
                }}
                onPointerMove={event => {
                    updateHover(event);
                    if (!dragRef.current) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const span = dragRef.current.view.end - dragRef.current.view.start;
                    const delta = ((dragRef.current.x - event.clientX) / rect.width) * span;
                    const start = Math.min(1 - span, Math.max(0, dragRef.current.view.start + delta));
                    setView({ start, end: start + span });
                }}
                onPointerUp={() => { dragRef.current = null; }}
                onPointerCancel={() => { dragRef.current = null; }}
            />
            {hover && (
                <div
                    className="pointer-events-none absolute z-10 max-w-56 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-left text-[10px] shadow-xl dark:border-gray-700 dark:bg-gray-950/95"
                    style={{ left: Math.max(8, Math.min(hover.x + 12, hover.width - 224)), top: Math.max(8, hover.y - 20) }}
                >
                    <p className="font-black text-gray-900 dark:text-white">Sample {hover.index + 1}</p>
                    <p className="text-gray-500">{xChannel.label}: {displayNumber(xChannel.values[hover.index], 3)} {xChannel.unit || ''}</p>
                    {activeChannels.map(channel => (
                        <p key={channel.key} style={{ color: SERIES_COLORS[channel.key] || '#64748b' }}>
                            {channel.label}: {displayNumber(channel.values[hover.index], 3)} {channel.unit || ''}
                        </p>
                    ))}
                </div>
            )}
            <button type="button" onClick={() => setView({ start: 0, end: 1 })} className="absolute right-3 top-3 rounded-full bg-gray-900/75 px-3 py-1 text-xs font-bold text-white hover:bg-gray-900">Reset zoom</button>
        </div>
    );
}

const SummaryMetric = ({ label, value }) => (
    <div className="min-w-[8.5rem] flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-center dark:border-gray-700 dark:bg-gray-900">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-1 text-sm font-black text-gray-950 dark:text-white">{value}</p>
    </div>
);

export default function RideNerdAnalysis({ analysis, entry }) {
    const paths = useMemo(() => analysis?.getRidePaths(entry.index, entry.ride?.name) || [], [analysis, entry.index, entry.ride?.name]);
    const [pathIndex, setPathIndex] = useState(0);
    const [xAxis, setXAxis] = useState('time');
    const [selected, setSelected] = useState(() => new Set(RIDE_ANALYSIS_DEFAULT_SERIES));
    useEffect(() => setPathIndex(0), [entry.index]);
    const path = paths[pathIndex] || paths[0];
    const summary = useMemo(() => path ? getRidePathSummary(path) : null, [path]);
    if (!path || !summary) {
        return <p className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900">No stored test route is available for this ride.</p>;
    }
    const toggle = key => setSelected(current => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    return (
        <div className="mt-4 space-y-4 text-center" data-testid={`ride-nerd-analysis-${entry.index}`}>
            <div className="flex flex-wrap justify-center gap-2">
                {paths.length > 1 && paths.map((candidate, index) => (
                    <button key={candidate.pathIndex} type="button" onClick={() => setPathIndex(index)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${index === pathIndex ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>Route {index + 1}</button>
                ))}
                <button type="button" onClick={() => setXAxis('time')} className={`rounded-full px-3 py-1.5 text-xs font-bold ${xAxis === 'time' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>Time axis</button>
                <button type="button" onClick={() => setXAxis('distance')} className={`rounded-full px-3 py-1.5 text-xs font-bold ${xAxis === 'distance' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>Distance axis</button>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
                <SummaryMetric label="Duration" value={`${displayNumber(summary.durationSeconds)} s`} />
                <SummaryMetric label="Distance" value={`${displayNumber(summary.distanceMeters)} m`} />
                <SummaryMetric label="Top speed" value={`${displayNumber(summary.maxSpeedKph)} km/h`} />
                <SummaryMetric label="Average speed" value={`${displayNumber(summary.averageSpeedKph)} km/h`} />
                <SummaryMetric label="Highest point" value={`${displayNumber(summary.elevation.max)} m`} />
                <SummaryMetric label="Lowest point" value={`${displayNumber(summary.elevation.min)} m`} />
                <SummaryMetric label="Largest sampled drop" value={`${displayNumber(summary.largestSampledDropMeters)} m`} />
                <SummaryMetric label="Samples" value={displayNumber(summary.sampleCount, 0)} />
                <SummaryMetric label="Lateral G" value={`${displayNumber(summary.gForces.lateral.min)} / ${displayNumber(summary.gForces.lateral.max)}`} />
                <SummaryMetric label="Vertical G" value={`${displayNumber(summary.gForces.vertical.min)} / ${displayNumber(summary.gForces.vertical.max)}`} />
                <SummaryMetric label="Longitudinal G" value={`${displayNumber(summary.gForces.longitudinal.min)} / ${displayNumber(summary.gForces.longitudinal.max)}`} />
            </div>
            <div>
                <div className="mx-auto mb-2 max-w-4xl space-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <p>Each visible series uses its own 0–100% scale: 0% is its lowest and 100% its highest visible value, not a shared unit. Hover for exact values; wheel to zoom; drag to pan.</p>
                    <p>Route X, Elevation and Route Z describe the sampled position. Orientation qX–qW is the vehicle rotation quaternion; Trace state is an internal game state code.</p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                    {path.channels.map(channel => (
                        <button
                            key={channel.key}
                            type="button"
                            onClick={() => toggle(channel.key)}
                            disabled={channel.key === xAxis}
                            title={channel.key === xAxis ? `${channel.label} is currently used as the horizontal axis` : (channel.description || channel.label)}
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-opacity disabled:cursor-not-allowed ${selected.has(channel.key) ? 'opacity-100' : 'opacity-40'} ${channel.key === xAxis ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-950' : ''}`}
                            style={{ borderColor: SERIES_COLORS[channel.key] || '#64748b', color: SERIES_COLORS[channel.key] || '#64748b' }}
                        >
                            {channel.label}
                        </button>
                    ))}
                </div>
            </div>
            <CanvasRideChart path={path} selectedKeys={[...selected]} xAxis={xAxis} />
        </div>
    );
}
