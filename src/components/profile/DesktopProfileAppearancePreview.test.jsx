import React from 'react';
import { render, screen } from '@testing-library/react';
import DesktopProfileAppearancePreview from './DesktopProfileAppearancePreview';

test('mirrors the current desktop profile header design and live profile data', () => {
    render(
        <DesktopProfileAppearancePreview
            appearance={{ hex: '#1E40AF', hoverHex: '#1E3A8A' }}
            bannerUrl="https://example.com/banner.jpg"
            imageUrl="https://example.com/avatar.jpg"
            onBannerError={vi.fn()}
            profile={{
                username: 'Creator',
                country: 'Germany',
                favoriteGame: 'planet-coaster-2',
                bio: 'Building detailed parks.',
                followers: ['one', 'two'],
                following: ['three'],
                youtube: 'https://youtube.com/@creator',
            }}
        />,
    );

    const preview = screen.getByLabelText('Desktop profile appearance preview');
    expect(preview).toHaveStyle({ aspectRatio: '1120 / 440' });
    expect(screen.getByTestId('desktop-profile-preview-canvas')).toHaveStyle({
        transform: 'scale(1)',
    });
    expect(screen.getByAltText('Desktop banner preview')).toHaveAttribute(
        'src',
        'https://example.com/banner.jpg',
    );
    expect(screen.getByAltText('Desktop profile preview')).toHaveClass('rounded-full');
    expect(screen.getByText('Creator')).toBeInTheDocument();
    expect(screen.getByText('Germany')).toBeInTheDocument();
    expect(screen.getByText('planet coaster 2')).toBeInTheDocument();
    expect(screen.getByText('Building detailed parks.')).toBeInTheDocument();
    expect(screen.getByText('Followers').parentElement).toHaveTextContent('2 Followers');
    expect(screen.getByText('Following').parentElement).toHaveTextContent('1 Following');
    expect(screen.getByLabelText('YouTube Channel')).toBeInTheDocument();
});

test('keeps the real header card treatment without a banner or bio', () => {
    render(
        <DesktopProfileAppearancePreview
            appearance={{ hex: '#22C55E', hoverHex: '#16A34A' }}
            bannerUrl=""
            imageUrl=""
            onBannerError={vi.fn()}
            profile={{ username: 'Creator' }}
        />,
    );

    expect(screen.queryByAltText('Desktop banner preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('desktop-profile-preview-canvas')).toHaveClass('bg-white');
    expect(screen.queryByText('About')).not.toBeInTheDocument();
});
