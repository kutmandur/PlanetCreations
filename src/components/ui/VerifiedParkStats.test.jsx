import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import VerifiedParkStats, { getPlanetCoaster2ScoreTone } from './VerifiedParkStats';
import { getPresentedParkRideEntries } from '../../utils/parkRidePresentation';

test('uses the Planet Coaster 2 traffic-light bands for EFN scores', () => {
    expect(getPlanetCoaster2ScoreTone('excitement', 2.99)).toBe('red');
    expect(getPlanetCoaster2ScoreTone('excitement', 3)).toBe('yellow');
    expect(getPlanetCoaster2ScoreTone('excitement', 5)).toBe('green');
    expect(getPlanetCoaster2ScoreTone('fear', 5)).toBe('green');
    expect(getPlanetCoaster2ScoreTone('fear', 7)).toBe('yellow');
    expect(getPlanetCoaster2ScoreTone('fear', 7.01)).toBe('red');
    expect(getPlanetCoaster2ScoreTone('nausea', 3)).toBe('green');
    expect(getPlanetCoaster2ScoreTone('nausea', 5)).toBe('yellow');
    expect(getPlanetCoaster2ScoreTone('nausea', 5.01)).toBe('red');
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
    expect(screen.getByTestId('test-score-fear')).toHaveAttribute('data-tone', 'green');
    expect(screen.getByTestId('test-score-nausea')).toHaveAttribute('data-tone', 'green');
    expect(screen.queryByText('Avg excitement')).not.toBeInTheDocument();
});

test('does not render park cards for a blueprint', () => {
    const { container } = render(<VerifiedParkStats metadata={{ blueprint: { rideCount: 1 } }} />);
    expect(container).toBeEmptyDOMElement();
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

test('keeps calculated trace EFN hidden and shows separate creator-entered EFN', () => {
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
    expect(screen.queryByText(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(9.99))).not.toBeInTheDocument();

    rerender(<VerifiedParkStats metadata={{ park }} presentation={{
        rideEfnOverrides: { [rideKey]: { excitement: 2.5, fear: 4, nausea: 1 } },
    }} />);
    expect(screen.getByTestId('test-score-excitement')).toHaveTextContent(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(2.5));
    expect(screen.getByTestId('test-score-excitement')).toHaveAttribute('title', 'Excitement entered by the creator');
    expect(screen.queryByText(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(9.99))).not.toBeInTheDocument();
});
