import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import VerifiedParkStats, { getPlanetCoaster2ScoreTone, TypeSections } from './VerifiedParkStats';
import { getPresentedParkRideEntries } from '../../utils/parkRidePresentation';

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => 'functions-instance'),
    httpsCallable: vi.fn(() => vi.fn()),
}));

vi.mock('../../utils/rideAnalysisDownload', () => ({
    downloadCreationRideAnalysis: vi.fn(() => new Promise(() => {})),
}));

test('uses the Planet Coaster 2 traffic-light bands for EFN scores', () => {
    expect(getPlanetCoaster2ScoreTone('excitement', 2.99)).toBe('red');
    expect(getPlanetCoaster2ScoreTone('excitement', 3)).toBe('red');
    expect(getPlanetCoaster2ScoreTone('excitement', 5)).toBe('yellow');
    expect(getPlanetCoaster2ScoreTone('excitement', 6.01)).toBe('green');
    expect(getPlanetCoaster2ScoreTone('fear', 1.99)).toBe('red');
    expect(getPlanetCoaster2ScoreTone('fear', 2)).toBe('yellow');
    expect(getPlanetCoaster2ScoreTone('fear', 5)).toBe('green');
    expect(getPlanetCoaster2ScoreTone('fear', 6.01)).toBe('yellow');
    expect(getPlanetCoaster2ScoreTone('fear', 8.01)).toBe('red');
    expect(getPlanetCoaster2ScoreTone('nausea', 1.61)).toBe('green');
    expect(getPlanetCoaster2ScoreTone('nausea', 3)).toBe('green');
    expect(getPlanetCoaster2ScoreTone('nausea', 5)).toBe('yellow');
    expect(getPlanetCoaster2ScoreTone('nausea', 6.01)).toBe('red');
});

test('supports a local orientation checklist in an embedded ride list', () => {
    const onToggleChecked = vi.fn();
    render(<TypeSections
        groups={[{
            key: 'coaster',
            label: 'Coasters',
            rides: [{
                key: 'ride-1',
                index: 0,
                displayName: 'Checked Coaster',
                category: { key: 'coaster', label: 'Coasters' },
                ride: { kind: 'tracked', name: 'Checked Coaster' },
            }],
        }]}
        checkedRideKeys={new Set(['ride-1'])}
        onToggleChecked={onToggleChecked}
    />);

    const checkbox = screen.getByRole('checkbox', { name: 'Mark Checked Coaster as checked' });
    expect(checkbox).toBeChecked();
    expect(screen.getByText('Checked Coaster')).toHaveClass('line-through');
    fireEvent.click(checkbox);
    expect(onToggleChecked).toHaveBeenCalledWith('ride-1');
});

test('shows compact verified park stats and opens a full ride list grouped by category', () => {
    render(<VerifiedParkStats metadata={{ park: {
        rideCount: 3,
        trackedRideCount: 2,
        flatRideCount: 1,
        placedPartCount: 199034,
        sceneryPieceCount: 195181,
        railElementCount: 2484,
        trackedRideElementCount: 595,
        binCount: 1444,
        rides: [
            {
                kind: 'tracked',
                name: 'Frost Giant Reach',
                category: 'Rage',
                typeId: 'Rage',
                rideCategoryKey: 'coaster',
                rideCategory: 'Coaster',
                testStats: {
                    durationSeconds: 95,
                    traversalLengthMeters: 1200,
                    maxSpeedKph: 88,
                    sampleCount: 400,
                    testCurves: { average: { excitement: 4.2, fear: 2.1, nausea: 0.8 } },
                },
                ratings: { excitement: 4.2, fear: 2.1, nausea: 0.8 },
            },
            { kind: 'tracked', name: 'River Run', rideCategoryKey: 'water-ride', rideCategory: 'Water Ride' },
            { kind: 'flat', category: 'Big Wheel', rideCategoryKey: 'flat-ride', rideCategory: 'Flat Ride' },
        ],
    } }} />);

    expect(screen.getByTestId('ride-category-coaster')).toHaveTextContent('Coasters');
    expect(screen.getByTestId('ride-category-coaster')).toHaveTextContent('1');
    expect(screen.getByTestId('ride-category-water-ride')).toHaveTextContent('Water Rides');
    expect(screen.getByTestId('ride-category-flat-ride')).toHaveTextContent('Flat Rides');
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Rides')).not.toBeInTheDocument();
    expect(screen.getByText('Construction parts').closest('article')).toHaveTextContent(new Intl.NumberFormat().format(199034));


    fireEvent.click(screen.getByRole('button', { name: 'Ride List' }));
    expect(screen.getByRole('dialog', { name: 'Ride List' })).toBeInTheDocument();
    expect(screen.getByText('Frost Giant Reach')).toBeInTheDocument();
    expect(screen.getByText('Max speed (km/h)').parentElement).toHaveTextContent('88');
    expect(screen.getByText('River Run')).toBeInTheDocument();
    expect(screen.getByText('Big Wheel')).toBeInTheDocument();
    expect(screen.getByTestId('ride-category-heading-coaster')).toHaveClass('text-center');
    expect(screen.getByTestId('ride-card-coaster-0')).toHaveClass('text-center');
    expect(screen.getByTestId('ride-card-coaster-0')).toHaveClass('border-orange-300');
    expect(screen.getByTestId('test-score-excitement')).toHaveAttribute('data-tone', 'yellow');
    expect(screen.getByTestId('test-score-fear')).toHaveAttribute('data-tone', 'yellow');
    expect(screen.getByTestId('test-score-nausea')).toHaveAttribute('data-tone', 'green');
    expect(screen.queryByText('Avg excitement')).not.toBeInTheDocument();
});

test('hides an empty Park Info panel and preserves zero values', () => {
    const {container, rerender} = render(<VerifiedParkStats presentation={{}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<VerifiedParkStats presentation={{parkInfo: {placementCost: 0}}} />);
    expect(screen.getByText('Build cost')).toBeInTheDocument();
    expect(screen.queryByText('Running cost')).not.toBeInTheDocument();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Ride List'})).not.toBeInTheDocument();
});

test('never offers online Nerd mode even for legacy analysis metadata', () => {
    render(<VerifiedParkStats
        creationId="animated-park"
        rideAnalysisSummary={{ available: true }}
        metadata={{ park: {
            trackedRideCount: 1,
            rides: [{
                kind: 'tracked',
                name: 'Animated Coaster',
                rideCategoryKey: 'coaster',
                rideCategory: 'Coaster',
            }],
        } }}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Ride List' }));
    expect(screen.queryByRole('button', {name: 'Nerd mode'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Normal mode'})).not.toBeInTheDocument();
});

test('shows editable blueprint values and hides explicitly cleared legacy fields', () => {
    render(<VerifiedParkStats metadata={{blueprint: {placementCost: 100, runningCost: 5, ratings: {excitement: 8}}}}
        presentation={{parkInfo: {placementCost: 200, runningCost: null}, parkText: {biome: 'Desert'}}} />);
    expect(screen.getByText('Build cost').closest('article')).toHaveTextContent('200');
    expect(screen.queryByText('Running cost')).not.toBeInTheDocument();
    expect(screen.getByText('Excitement')).toBeInTheDocument();
    expect(screen.getByText('Desert')).toBeInTheDocument();
});

test('applies user visibility and offers animated Areas and Types views', () => {
    const park = {
        trackedRideCount: 2,
        rides: [
            { kind: 'tracked', name: 'Launch One', rideCategoryKey: 'coaster', rideCategory: 'Coaster' },
            { kind: 'tracked', name: 'Hidden River', rideCategoryKey: 'water-ride', rideCategory: 'Water Ride' },
        ],
    };
    const savedEntries = getPresentedParkRideEntries(park, null, { includeHidden: true });
    const presentation = {
        version: 1,
        areas: [{ id: 'area-harbor', name: 'Harbor', color: '#DB2777' }],
        customRides: [
            { id: 'custom-laser', name: 'Laser Show', rideCategoryKey: 'dark-ride' },
            { id: 'custom-stage', name: 'Harbor Stage', rideCategoryKey: 'show' },
        ],
        hiddenRideKeys: [savedEntries[1].key],
        rideAreaAssignments: {
            [savedEntries[0].key]: 'area-harbor',
            'custom-laser': 'area-harbor',
            'custom-stage': 'area-harbor',
        },
        rideEfnOverrides: {
            'custom-laser': { excitement: 5.5, fear: 2.2, nausea: 0.7 },
        },
        rideDisplayNames: {
            [savedEntries[0].key]: 'Harbor Launch',
        },
    };

    render(<VerifiedParkStats metadata={{ park }} presentation={presentation} />);
    expect(screen.queryByTestId('ride-category-water-ride')).not.toBeInTheDocument();
    expect(screen.getByTestId('ride-category-dark-ride')).toHaveTextContent('1');
    expect(screen.getByTestId('ride-category-show')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Ride List' }));
    expect(screen.getByRole('button', { name: 'Areas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Types' })).toBeInTheDocument();
    const harborArea = screen.getByTestId('ride-area-area-harbor');
    expect(harborArea).toHaveTextContent('Harbor');
    expect(harborArea).toHaveTextContent('3 attractions');
    expect(harborArea).toHaveTextContent('Harbor Launch');
    expect(harborArea).toHaveTextContent('Laser Show');
    expect(harborArea).toHaveTextContent('Harbor Stage');
    expect(harborArea).toHaveTextContent('Dark Rides');
    expect(harborArea).toHaveTextContent('Shows');
    expect(screen.getAllByText('Custom attraction')).toHaveLength(2);
    expect(screen.queryByText('Hidden River')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Types' }));
    expect(screen.getByTestId('ride-category-heading-coaster')).toBeInTheDocument();
    expect(screen.getByTestId('ride-category-heading-dark-ride')).toBeInTheDocument();
    expect(screen.getByTestId('ride-category-heading-show')).toBeInTheDocument();
});

test('prioritizes creator EFN over legacy values', () => {
    const park = {
        trackedRideCount: 1,
        rides: [{
            kind: 'tracked',
            name: 'Trace Ride',
            rideCategoryKey: 'coaster',
            rideCategory: 'Coaster',
            testStats: {
                durationSeconds: 50,
                testCurves: { average: { excitement: 9.99, fear: 8.88, nausea: 7.77 } },
            },
        }],
    };
    const rideKey = getPresentedParkRideEntries(park, null, { includeHidden: true })[0].key;
    const { rerender } = render(<VerifiedParkStats metadata={{ park }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ride List' }));
    expect(screen.queryByTestId('test-score-excitement')).not.toBeInTheDocument();
    expect(screen.queryByText('Calculated from test curve')).not.toBeInTheDocument();

    rerender(<VerifiedParkStats metadata={{ park }} presentation={{
        rideEfnOverrides: { [rideKey]: { excitement: 2.5, fear: 4, nausea: 1 } },
    }} />);
    expect(screen.getByTestId('test-score-excitement')).toHaveTextContent(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(2.5));
    expect(screen.getByTestId('test-score-excitement')).toHaveAttribute('title', 'Excitement entered by the creator');

    const untestedPark = { trackedRideCount: 1, rides: [{
        kind: 'tracked', name: 'Untested Ride', rideCategoryKey: 'coaster', rideCategory: 'Coaster',
    }] };
    const untestedKey = getPresentedParkRideEntries(untestedPark, null, { includeHidden: true })[0].key;
    rerender(<VerifiedParkStats metadata={{ park: untestedPark }} presentation={{
        rideEfnOverrides: { [untestedKey]: { excitement: 2.5, fear: 4, nausea: 1 } },
    }} />);
    expect(screen.getByTestId('test-score-excitement')).toHaveTextContent(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(2.5));
    expect(screen.getByTestId('test-score-excitement')).toHaveAttribute('title', 'Excitement entered by the creator');
});

test('shows user ratings for multi-ride blueprints without analysis claims', () => {
    render(<VerifiedParkStats metadata={{blueprint: {trackedRideCount: 2}}} presentation={{parkInfo: {excitement: 6}}} />);
    expect(screen.getByText('Excitement')).toBeInTheDocument();
    expect(screen.queryByTestId('multi-ride-blueprint-analysis-note')).not.toBeInTheDocument();
});

test('lists 80 rides inside the vertically scrolling popover without horizontal overflow', () => {
    const rides = Array.from({ length: 80 }, (_, index) => ({
        kind: 'tracked',
        name: `Stress Ride ${index + 1}`,
        rideCategoryKey: 'coaster',
        rideCategory: 'Coaster',
    }));
    render(<VerifiedParkStats metadata={{ park: { trackedRideCount: 80, rides } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ride List' }));
    const dialog = screen.getByRole('dialog', { name: 'Ride List' });
    expect(dialog).toHaveClass('overflow-hidden');
    expect(dialog.querySelector('.overflow-y-auto')).toBeInTheDocument();
    expect(dialog.querySelectorAll('[data-testid^="ride-card-"]')).toHaveLength(80);
    expect(screen.getByText('Stress Ride 80')).toBeInTheDocument();
});
