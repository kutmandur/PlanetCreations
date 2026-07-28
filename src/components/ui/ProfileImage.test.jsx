import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import logo from '../../assets/logo.png';
import ProfileImage from './ProfileImage';

describe('ProfileImage', () => {
    test('uses the PlanetCreations logo when no profile image is set', () => {
        render(<ProfileImage alt="Profile" />);

        expect(screen.getByAltText('Profile')).toHaveAttribute('src', logo);
    });

    test('falls back to the PlanetCreations logo when an image cannot load', () => {
        render(<ProfileImage src="https://example.invalid/profile.png" alt="Profile" />);
        const image = screen.getByAltText('Profile');

        fireEvent.error(image);

        expect(image).toHaveAttribute('src', logo);
    });
});
