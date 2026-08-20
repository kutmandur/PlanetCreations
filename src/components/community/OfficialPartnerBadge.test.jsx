import React from 'react';
import { render, screen } from '@testing-library/react';
import partnerBadgeTemplate from '../../assets/official-partner-badge.png';
import OfficialPartnerBadge from './OfficialPartnerBadge';

describe('OfficialPartnerBadge', () => {
    test('places the community logo on a theme-aware background', () => {
        render(
            <OfficialPartnerBadge
                communityName="Coaster Club"
                logoUrl="https://example.com/community-logo.png"
            />
        );

        expect(screen.getByAltText('Coaster Club logo')).toHaveAttribute(
            'src',
            'https://example.com/community-logo.png'
        );
        expect(screen.getByAltText('Coaster Club logo'))
            .toHaveClass('object-cover');
        expect(screen.getByTestId('official-partner-badge'))
            .toHaveClass('left-5', 'top-5', 'md:left-6', 'md:top-6');
        expect(screen.getByTestId('partner-logo-background'))
            .toHaveClass('bg-white', 'dark:bg-gray-800');
        expect(screen.getByAltText('Official Partner badge'))
            .toHaveAttribute('src', partnerBadgeTemplate);
        expect(screen.getByRole('tooltip'))
            .toHaveTextContent('Official Partner Community');
        expect(screen.getByRole('tooltip'))
            .toHaveClass('left-1/2', '-translate-x-1/2');
    });

    test('shows the community initial when no logo URL is configured', () => {
        render(<OfficialPartnerBadge communityName="Zoo Friends" />);

        expect(screen.getByText('Z')).toBeInTheDocument();
    });
});
