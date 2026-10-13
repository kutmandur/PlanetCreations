import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ParkRidesAreasEditor from './ParkRidesAreasEditor';

const park = {
    trackedRideCount: 1,
    rides: [{ kind: 'tracked', name: 'Launch One', rideCategoryKey: 'coaster', rideCategory: 'Coaster' }],
};

const Harness = () => {
    const [value, setValue] = useState({});
    return <ParkRidesAreasEditor park={park} value={value} onChange={setValue} color={{ bg: 'bg-blue-600', hoverBg: 'hover:bg-blue-700', ring: 'ring-blue-500' }} />;
};

test('manages areas, custom rides, visibility and assignments', () => {
    render(<Harness />);

    expect(screen.getByLabelText('Attraction category')).toHaveValue('restaurant');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Filter attraction groups' })).not.toHaveClass('overflow-x-auto');
    expect(screen.queryByRole('group', { name: 'Filter ride types' })).not.toBeInTheDocument();
    expect(screen.getByTestId('attraction-group-indicator').style.backgroundColor).toBe('rgb(249, 115, 22)');

    fireEvent.click(screen.getByRole('button', { name: 'Rides' }));
    expect(screen.getByRole('button', { name: 'Rides' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Coasters' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Other' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter ride types' })).not.toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('attraction-subcategory-indicator').style.backgroundColor).toBe('rgb(249, 115, 22)');
    fireEvent.click(screen.getByRole('button', { name: 'Water Rides' }));
    expect(screen.getByTestId('attraction-group-indicator').style.backgroundColor).toBe('rgb(37, 99, 235)');
    expect(screen.getByTestId('attraction-subcategory-indicator').style.backgroundColor).toBe('rgb(37, 99, 235)');

    fireEvent.click(screen.getByRole('button', { name: 'Venues' }));
    expect(screen.getByRole('button', { name: 'Restaurants' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Shops' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shows' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter venue types' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    const saveRideDisplayName = screen.getByLabelText('Display name for Launch One');
    fireEvent.change(saveRideDisplayName, { target: { value: 'Harbor Launch' } });
    fireEvent.blur(saveRideDisplayName);
    expect(screen.getByDisplayValue('Harbor Launch')).toBeInTheDocument();
    expect(screen.getByText('Savefile name: Launch One')).toBeInTheDocument();
    expect(screen.queryByLabelText('Attraction category for Harbor Launch')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New area name'), { target: { value: 'Harbor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Area' }));
    expect(screen.getByDisplayValue('Harbor')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Attraction name'), { target: { value: 'Laser Show' } });
    fireEvent.change(screen.getByLabelText('Attraction category'), { target: { value: 'dark-ride' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Attraction' }));
    expect(screen.getByDisplayValue('Laser Show')).toBeInTheDocument();
    expect(screen.getByText('Custom attraction')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rides' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark Rides' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('attraction-group-indicator').style.backgroundColor).toBe('rgb(124, 58, 237)');
    expect(screen.getByTestId('attraction-subcategory-indicator').style.backgroundColor).toBe('rgb(124, 58, 237)');
    fireEvent.change(screen.getByLabelText('Attraction category for Laser Show'), { target: { value: 'water-slide' } });
    expect(screen.getByLabelText('Attraction category for Laser Show')).toHaveValue('water-slide');
    expect(screen.getByLabelText('Attraction category for Laser Show')).toContainHTML('Restaurant');
    expect(screen.getByLabelText('Attraction category for Laser Show')).toContainHTML('Shop');
    fireEvent.change(screen.getByLabelText('excitement EFN for Laser Show'), { target: { value: '6.25' } });
    expect(screen.getByLabelText('excitement EFN for Laser Show')).toHaveValue(6.25);
    fireEvent.change(screen.getByLabelText('Attraction category for Laser Show'), { target: { value: 'restaurant' } });
    expect(screen.queryByLabelText('excitement EFN for Laser Show')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Venues' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Restaurants' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Rides' }));
    fireEvent.click(screen.getByRole('button', { name: 'Coasters' }));
    expect(screen.getByDisplayValue('Harbor Launch')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Laser Show')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByDisplayValue('Laser Show')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide Harbor Launch' }));
    expect(screen.getByRole('button', { name: 'Show Harbor Launch' })).toBeInTheDocument();
    const areaSelect = screen.getByLabelText('Area for Harbor Launch');
    const harborOption = [...areaSelect.options].find(option => option.textContent === 'Harbor');
    fireEvent.change(areaSelect, { target: { value: harborOption.value } });
    expect(screen.getByLabelText('Area for Harbor Launch')).not.toHaveValue('');
});

test('edits and clears optional stats without losing areas or zero values', () => {
    const onChange = vi.fn();
    const value = {areas: [{id: 'a', name: 'Harbor', color: '#2563EB'}]};
    const {rerender} = render(<ParkRidesAreasEditor metadata={{blueprint: {placementCost: 99}}} park={park} value={value} onChange={onChange} color={{}} />);
    fireEvent.change(screen.getByLabelText('Build cost'), {target: {value: '0'}});
    const updated = onChange.mock.lastCall[0];
    expect(updated.parkInfo.placementCost).toBe(0);
    expect(updated.areas).toEqual(value.areas);
    rerender(<ParkRidesAreasEditor metadata={{blueprint: {placementCost: 99}}} park={park} value={updated} onChange={onChange} color={{}} />);
    expect(screen.getByLabelText('Build cost')).toHaveValue(0);
    fireEvent.change(screen.getByLabelText('Build cost'), {target: {value: ''}});
    expect(onChange.mock.lastCall[0].parkInfo.placementCost).toBeNull();
    fireEvent.change(screen.getByLabelText('Lateral G min for Launch One', {exact: false}), {target: {value: '-2'}});
    expect(Object.values(onChange.mock.lastCall[0].rideInfo)[0].lateral_min).toBe(-2);
});
