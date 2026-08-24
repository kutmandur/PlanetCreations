import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import VerifiedParkStats, { getPlanetCoaster2ScoreTone } from './VerifiedParkStats';
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
    expect(screen.getByTestId('combined-piece-count')).toHaveTextContent(new Intl.NumberFormat().format(203557));
    expect(screen.getByTestId('combined-piece-count').closest('[data-auto-fit-number]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ride List' }));
    expect(screen.getByRole('dialog', { name: 'Ride List' })).toBeInTheDocument();
    expect(screen.getByText('Frost Giant Reach')).toBeInTheDocument();
    expect(screen.getByText('88 km/h')).toBeInTheDocument();
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

test('keeps park-only controls off blueprint pages and still offers all stats', () => {
    render(<VerifiedParkStats metadata={{ blueprint: { rideCount: 1 } }} />);
    expect(screen.getByTestId('verified-blueprint-stats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More stats' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ride List' })).not.toBeInTheDocument();
});

test('uses the animated pill selector for Normal and Nerd mode', () => {
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
    const normalMode = screen.getByRole('button', { name: 'Normal mode' });
    const selector = normalMode.parentElement;
    expect(selector).toHaveClass('relative', 'rounded-full', 'shadow-inner');
    expect(selector.querySelector('.transition-all.duration-300.ease-out')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Nerd mode' }));
    expect(screen.getByRole('button', { name: 'Nerd mode' })).toHaveClass('text-white');
    expect(screen.getByTestId('nerd-ride-list')).toHaveTextContent('Animated Coaster');
});

test('shows verified blueprint costs and EFN values in compact stat cards', () => {
    render(<VerifiedParkStats
        creationName="Boulder Blast Wooden Coaster"
        bannerImageUrl="https://images.example.com/boulder-blast.jpg"
        metadata={{ blueprint: {
        placementCost: 13815.503,
        runningCost: 574.267,
        ratings: {
            excitement: 4.9,
            fear: 5.5,
            nausea: 2.4,
        },
        trackedRideElementCount: 42,
        utilities: {
            generatedPower: 12.5,
            requiredPower: 8,
        },
        researchPacks: [2621, 9999],
    } }}
    />);

    const stats = screen.getByTestId('verified-blueprint-stats');
    expect(stats).toHaveTextContent('Build cost');
    expect(stats).toHaveTextContent(new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(13815.503));
    expect(stats).toHaveTextContent('Running cost');
    expect(stats).toHaveTextContent(new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(574.267));
    expect(screen.getByTestId('blueprint-score-excitement')).toHaveTextContent('Excitement');
    expect(screen.getByTestId('blueprint-score-excitement')).toHaveTextContent(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(4.9));
    expect(screen.getByTestId('blueprint-score-excitement')).toHaveAttribute('data-tone', 'yellow');
    expect(screen.getByTestId('blueprint-score-fear')).toHaveAttribute('data-tone', 'green');
    expect(screen.getByTestId('blueprint-score-nausea')).toHaveAttribute('data-tone', 'green');
    expect(screen.getByTestId('blueprint-score-excitement')).toHaveClass('bg-yellow-100', 'dark:bg-yellow-800/80');
    expect(screen.getByTestId('blueprint-score-fear')).toHaveClass('bg-green-100', 'dark:bg-green-800/80');
    expect(screen.getByTestId('blueprint-score-nausea')).toHaveClass('bg-green-100', 'dark:bg-green-800/80');
    expect(screen.queryByRole('button', { name: 'Ride List' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More stats' }));
    const dialog = screen.getByRole('dialog', { name: 'Creation stats' });
    expect(dialog).toHaveClass('max-w-5xl', 'bg-gray-100', 'text-center', 'text-gray-900', 'dark:bg-gray-950', 'dark:text-gray-100');
    expect(dialog.querySelector('header')).toHaveClass('from-blue-100', 'dark:from-blue-950');
    expect(screen.getByRole('heading', { name: 'Boulder Blast Wooden Coaster' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Boulder Blast Wooden Coaster gallery banner' })).toHaveAttribute('src', 'https://images.example.com/boulder-blast.jpg');
    expect(screen.getByTestId('banner-efn-excitement')).toHaveTextContent('Excitement');
    expect(screen.getByTestId('banner-efn-excitement')).toHaveAttribute('data-tone', 'yellow');
    expect(screen.getByTestId('banner-efn-excitement')).toHaveClass('bg-yellow-100/90', 'dark:bg-yellow-800/85');
    expect(screen.getByTestId('banner-efn-fear')).toHaveAttribute('data-tone', 'green');
    expect(screen.getByTestId('banner-efn-fear')).toHaveClass('bg-green-100/90', 'dark:bg-green-800/85');
    expect(screen.getByTestId('banner-efn-nausea')).toHaveAttribute('data-tone', 'green');
    expect(screen.getByTestId('banner-efn-nausea')).toHaveClass('bg-green-100/90', 'dark:bg-green-800/85');
    expect(screen.queryByText('Stored blueprint rating')).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('Tracked-ride elements');
    expect(dialog).toHaveTextContent('42');
    const trackedRideMetric = screen.getByText('Tracked-ride elements').parentElement;
    expect(trackedRideMetric).toHaveClass('w-fit', 'text-center', 'bg-white', 'dark:bg-gray-900/75');
    expect(trackedRideMetric.parentElement).toHaveClass('flex', 'justify-center');
    expect(dialog).toHaveTextContent('Generated power');
    expect(dialog).toHaveTextContent('Required power');
    expect(dialog).toHaveTextContent('Research packs');
    expect(dialog).toHaveTextContent('Vector · Swinging Mine Train');
    expect(dialog).toHaveTextContent('Unknown research reward #9999');
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

test('shows calculated trace EFN and only falls back to creator EFN when no verified source exists', () => {
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
    expect(screen.getByTestId('test-score-excitement')).toHaveTextContent(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(9.99));
    expect(screen.getByTestId('test-score-excitement')).toHaveAttribute('title', 'Excitement calculated from the stored ride-test curve');
    expect(screen.getByText('Calculated from test curve')).toBeInTheDocument();

    rerender(<VerifiedParkStats metadata={{ park }} presentation={{
        rideEfnOverrides: { [rideKey]: { excitement: 2.5, fear: 4, nausea: 1 } },
    }} />);
    expect(screen.getByTestId('test-score-excitement')).toHaveTextContent(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(9.99));
    expect(screen.getByTestId('test-score-excitement')).toHaveAttribute('title', 'Excitement calculated from the stored ride-test curve');

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

test('explains why multi-ride blueprints cannot show EFN or ride analysis', () => {
    render(<VerifiedParkStats creationId="multi-blueprint" rideAnalysisSummary={{ available: true }} metadata={{ blueprint: {
        trackedRideCount: 2,
        flatRideCount: 2,
        rides: [],
    } }} />);
    expect(screen.getByTestId('multi-ride-blueprint-analysis-note')).toHaveTextContent(
        'does not include final EFN ratings or ride-test curves in multi-ride blueprints',
    );
    expect(screen.queryByRole('button', { name: 'Nerd mode' })).not.toBeInTheDocument();
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
