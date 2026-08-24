import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CreationMetadataPanel, { formatGameMoney } from './CreationMetadataPanel';

test('renders normalized blueprint costs, counts and ride ratings', () => {
    render(<CreationMetadataPanel customMediaReferences={[
        'station-screen.png',
        'ride-loop.webm',
        'queue-music.ogg',
    ]} metadata={{
        name: 'Mine Train',
        description: 'A detailed mine train.',
        isModded: false,
        gameVersion: '1.0',
        saveFormatVersion: 23,
        requiredDlc: 4,
        requiredDlcs: ['Vintage Funfair Ride Pack'],
        unknownDlcBits: [],
        tags: ['Blueprint', 'Coaster_Model_SwingingMineTrain'],
        blueprint: {
            placementCost: 13815.503,
            runningCost: 574.267,
            sceneryCount: 1221,
            buildingCount: 157,
            trackedRideCount: 1,
            flatRideCount: 0,
            rideId: 'CC_GoldFever',
            ratings: { excitement: 4.924, fear: 2.718, nausea: 0.342 },
            researchPacks: [2621],
            utilities: null,
        },
        park: null,
    }} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const viewStatsButton = screen.getByRole('button', { name: 'View stats' });
    expect(viewStatsButton).toHaveClass('text-blue-700', 'dark:text-blue-200');
    fireEvent.click(viewStatsButton);
    expect(screen.getByRole('dialog', { name: 'Creation stats' })).toBeInTheDocument();
    expect(screen.getByText('Build cost')).toBeInTheDocument();
    expect(screen.getByText(/13[.,]815[.,]50/)).toBeInTheDocument();
    expect(screen.getByText(/1[.,]221/)).toBeInTheDocument();
    expect(screen.getByText(/4[.,]92/)).toBeInTheDocument();
    expect(screen.getByText('Vector · Swinging Mine Train')).toBeInTheDocument();
    expect(screen.getByText('Coasters & blueprints · #2621')).toBeInTheDocument();
    expect(screen.getByText(/do not represent the creator's research progress/i)).toBeInTheDocument();
    expect(screen.getByText('Vintage Funfair Ride Pack')).toBeInTheDocument();
    expect(screen.getByText('Custom media')).toBeInTheDocument();
    expect(screen.getByText('Referenced files')).toBeInTheDocument();
    expect(screen.getByText('station-screen.png')).toBeInTheDocument();
    expect(screen.getByText('ride-loop.webm')).toBeInTheDocument();
    expect(screen.getByText('queue-music.ogg')).toBeInTheDocument();
    expect(formatGameMoney(null)).toBe('N/A');
});

test('renders park object counts and individually named rides without inventing EFN values', () => {
    render(<CreationMetadataPanel metadata={{
        kind: 'park',
        requiredDlc: 0,
        requiredDlcs: [],
        unknownDlcBits: [],
        park: {
            gameMode: 'sandbox',
            biome: 'tropical',
            guestCount: 1173,
            guestCap: 6000,
            complexity: 3000,
            rideCount: 17,
            trackedRideCount: 13,
            flatRideCount: 4,
            buildingCount: 385,
            placedPartCount: 98987,
            poolCount: 1,
            rides: [
                { kind: 'tracked', name: 'Maintenance Rush', category: 'Raid Coaster', rideCategoryKey: 'coaster', rideCategory: 'Coaster', ratings: null },
                { kind: 'flat', name: null, category: 'Flying Theatre', rideCategoryKey: 'flat-ride', rideCategory: 'Flat Ride', ratings: null },
            ],
        },
        blueprint: null,
    }} />);

    fireEvent.click(screen.getByText('View stats'));
    expect(screen.getAllByText('Rides')).toHaveLength(2);
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('385')).toBeInTheDocument();
    expect(screen.getByText(/98[.,]987/)).toBeInTheDocument();
    expect(screen.getByText('Pools')).toBeInTheDocument();
    expect(screen.getAllByText('Coasters')).toHaveLength(2);
    expect(screen.getByText('Other tracked rides')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Flat Rides')).toBeInTheDocument();
    expect(screen.getByText('Maintenance Rush')).toBeInTheDocument();
    expect(screen.getByText('Flying Theatre')).toBeInTheDocument();
    expect(screen.queryByText('Scenery only')).not.toBeInTheDocument();
    expect(screen.queryByText('Editing time')).not.toBeInTheDocument();
    expect(screen.queryByText(/does not expose verified per-ride EFN/i)).not.toBeInTheDocument();
});

test('shows separate rides for a multi-ride blueprint', () => {
    render(<CreationMetadataPanel metadata={{
        kind: 'blueprint',
        requiredDlc: 0,
        requiredDlcs: [],
        unknownDlcBits: [],
        park: null,
        blueprint: {
            placementCost: 1442.88,
            runningCost: 0,
            sceneryCount: 0,
            buildingCount: 0,
            trackedRideCount: 2,
            flatRideCount: 0,
            ratings: null,
            rides: [
                { kind: 'tracked', name: 'Body Flume 1', category: 'Body Flume', rideCategoryKey: 'water-slide', rideCategory: 'Water Slide', ratings: null },
                { kind: 'tracked', name: 'Body Flume 2', category: 'Body Flume', rideCategoryKey: 'water-slide', rideCategory: 'Water Slide', ratings: null },
            ],
        },
    }} />);

    fireEvent.click(screen.getByText('View stats'));
    expect(screen.getByText('Body Flume 1')).toBeInTheDocument();
    expect(screen.getByText('Body Flume 2')).toBeInTheDocument();
    expect(screen.getByText('Water Slides')).toBeInTheDocument();
    expect(screen.getByText('Water slides')).toBeInTheDocument();
    expect(screen.getAllByText('Water Slide')).toHaveLength(2);
});

test('keeps calculated EFN hidden while showing conservative stored test-trace facts', () => {
    render(<CreationMetadataPanel metadata={{
        kind: 'park', requiredDlc: 0, requiredDlcs: [], unknownDlcBits: [], blueprint: null,
        park: {
            rideCount: 1, trackedRideCount: 1, flatRideCount: 0,
            rides: [{
                kind: 'tracked', name: 'Test Coaster', category: 'Coaster', rideCategoryKey: 'coaster', rideCategory: 'Coaster', ratings: null,
                testStats: {
                    durationSeconds: 103.04, traversalLengthMeters: 640.005, maxSpeedKph: 52.27, sampleCount: 1282,
                    testCurves: { average: { excitement: 2.496, fear: 1.76, nausea: 0.231 }, isFinalRating: false },
                    gForces: { lateral: { min: -1.2, max: 1.4 }, vertical: { min: -0.4, max: 3.2 }, longitudinal: { min: -1.1, max: 0.8 } },
                },
            }],
        },
    }} />);

    fireEvent.click(screen.getByText('View stats'));
    expect(screen.getByText('Test duration')).toBeInTheDocument();
    expect(screen.getByText(/52[.,]3 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/intentionally hidden until the calculation is reliable/i)).toBeInTheDocument();
    expect(screen.queryByText('Avg. excitement')).not.toBeInTheDocument();
    expect(screen.queryByText(/2[.,]5/)).not.toBeInTheDocument();
    expect(screen.queryByText('Final ride rating')).not.toBeInTheDocument();
});

test('offers the Workshop-style Nerd mode for a tested local park', () => {
    const readFrontierRideAnalysis = vi.fn(() => new Promise(() => {}));
    window.electronAPI = { readFrontierRideAnalysis };
    try {
        render(<CreationMetadataPanel filePath="C:\\Frontier Developments\\Planet Coaster 2\\12345678901234567\\Saves\\Test.park2" metadata={{
            gameId: 'planet-coaster-2', kind: 'park', requiredDlc: 0, requiredDlcs: [], unknownDlcBits: [], blueprint: null,
            park: {
                rideCount: 1, trackedRideCount: 1, flatRideCount: 0,
                rides: [{
                    kind: 'tracked', name: 'Test Coaster', category: 'Coaster', rideCategoryKey: 'coaster', rideCategory: 'Coaster',
                    testStats: { durationSeconds: 10, traversalLengthMeters: 100, maxSpeedKph: 60, sampleCount: 120 },
                }],
            },
        }} />);

        fireEvent.click(screen.getByRole('button', { name: 'View stats' }));
        fireEvent.click(screen.getByRole('button', { name: 'Nerd mode' }));
        expect(readFrontierRideAnalysis).toHaveBeenCalledWith(expect.stringMatching(/Test\.park2$/));
        expect(screen.getByRole('button', { name: /Loading full-resolution data/i })).toBeDisabled();
        expect(screen.getByText(/refreshed only when this save changes/i)).toBeInTheDocument();
    } finally {
        delete window.electronAPI;
    }
});

test('renders a dedicated Planet Zoo overview with safe counts and transport rides', () => {
    render(<CreationMetadataPanel customMediaReferences={['habitat-screen.png']} metadata={{
        gameId: 'planet-zoo',
        kind: 'park',
        name: 'Goodwin House',
        requiredDlc: 18,
        requiredDlcs: ['Arctic Pack', 'Aquatic Pack'],
        requiredDlcBits: [1, 4],
        requiredDlcIdentifiers: ['Content1', 'Content4'],
        unknownDlcBits: [],
        park: {
            gameMode: 'Career', biome: 'Temperate', difficulty: 'Medium',
            guestCount: 847, animalCount: 45, parkRating: 0.91, guestHappiness: 0.82,
            cash: 12500.5, scenarioStarsEarned: 2, scenarioStarsTotal: 3,
            animalHabitatCount: 6, habitatAnimalCount: 35, habitatObjectCount: 210,
            feedingStationCount: 22, animalTalkCount: 2, facilityCount: 18,
            staffCount: 12, keeperHutCount: 3, donationBoxCount: 14,
            binCount: 17, benchCount: 11, placedPartCount: 3684,
            pathSegmentCount: 640, lakeCount: 4, rideCount: 1, stationCount: 2,
            rides: [{
                kind: 'tracked', name: 'Goodwin Railway', category: 'Steam Train',
                typeId: 'Transport_Steam_Train', rideCategoryKey: 'transport-ride',
                rideCategory: 'Transport Ride', ratings: null,
            }],
        },
        blueprint: null,
    }} />);

    fireEvent.click(screen.getByText('View stats'));
    expect(screen.getByText('Zoo save')).toBeInTheDocument();
    expect(screen.getByText('Animals & habitats')).toBeInTheDocument();
    expect(screen.getByText('Zoo operations')).toBeInTheDocument();
    expect(screen.getByText('Construction & transport')).toBeInTheDocument();
    expect(screen.getByText('Park rating')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.getByText('Habitats')).toBeInTheDocument();
    expect(screen.getByText('Habitat animals')).toBeInTheDocument();
    expect(screen.getByText('Goodwin Railway')).toBeInTheDocument();
    expect(screen.getByText('Arctic Pack')).toBeInTheDocument();
    expect(screen.getByText('Aquatic Pack')).toBeInTheDocument();
    expect(screen.queryByText('Content 1')).not.toBeInTheDocument();
    expect(screen.queryByText(/Unknown DLC/)).not.toBeInTheDocument();
    expect(screen.getByText('habitat-screen.png')).toBeInTheDocument();
    expect(screen.queryByText(/No completed ride-test trace/)).not.toBeInTheDocument();
});
