import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PartnerCommunityCard from './PartnerCommunityCard';

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../hooks/youtubeVideoIndex', () => ({
    useCommunityYoutubeVideos: () => ({
        videos: Array.from({ length: 12 }, (_, index) => ({
            id: `${String(index + 1).padStart(11, '0')}`,
            title: `Partner video ${index + 1}`,
        })),
        isLoading: false,
    }),
}));

const renderCard = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <Routes>
                    <Route path="/" element={
                        <PartnerCommunityCard
                            community={{
                                id: 'partner-1',
                                slug: 'coaster-friends',
                                name: 'Coaster Friends',
                                description: 'A welcoming place for ambitious coaster builders.',
                                bannerImageUrl: 'https://example.com/banner.png',
                                profileImageUrl: 'https://example.com/logo.png',
                                themeColor: '#2563EB',
                                ownerId: 'owner-1',
                                ownerUsername: 'BuilderOne',
                                memberCount: 1234,
                                allowedGames: ['planet-coaster-2', 'planet-zoo'],
                                mainGame: 'planet-coaster-2',
                                socialLinks: {
                                    youtube: 'https://www.youtube.com/@coasterfriends',
                                    instagram: 'https://www.instagram.com/coasterfriends',
                                },
                            }}
                        />
                    } />
                    <Route path="/community/:slug" element={<div>Community destination</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
};

describe('PartnerCommunityCard', () => {
    test('shows centered partner information outside the banner', () => {
        renderCard();

        expect(screen.getByRole('heading', { name: 'Coaster Friends' })).toBeInTheDocument();
        expect(screen.getByRole('article')).toHaveClass('text-center');
        expect(within(screen.getByRole('link', { name: 'Open Coaster Friends banner' }))
            .queryByRole('heading')).not.toBeInTheDocument();
        expect(screen.getByText('A welcoming place for ambitious coaster builders.')).toBeInTheDocument();
        expect(screen.getByText('BuilderOne')).toBeInTheDocument();
        expect(screen.getByText(/1[.,]234/)).toBeInTheDocument();
        expect(screen.getByText('Planet Coaster 2 · Main game')).toBeInTheDocument();
        expect(screen.getByText('Planet Zoo')).toBeInTheDocument();
        expect(screen.getByTestId('official-partner-badge'))
            .toHaveClass('h-16', 'w-16', 'left-3', 'top-3');
    });

    test('shows exactly the three latest videos followed by clickable social icons', () => {
        renderCard();

        const videoLinks = screen.getAllByRole('link', { name: /Watch Partner video/ });
        expect(videoLinks).toHaveLength(3);
        expect(screen.queryByText('Partner video 4')).not.toBeInTheDocument();
        expect(videoLinks[0].parentElement).toHaveClass('grid-cols-3');
        expect(screen.getByText('Partner video 1')).not.toHaveClass('line-clamp-2');
        expect(
            videoLinks[0].compareDocumentPosition(screen.getByText('BuilderOne')) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Open YouTube Channel' }))
            .toHaveAttribute('href', 'https://www.youtube.com/@coasterfriends');
        expect(screen.getByRole('link', { name: 'Open Instagram' }))
            .toHaveAttribute('href', 'https://www.instagram.com/coasterfriends');
    });

    test('links to the partner community detail page', () => {
        renderCard();

        const viewCommunityLink = screen.getByRole('link', { name: 'View community →' });
        expect(viewCommunityLink).toHaveAttribute('href', '/community/coaster-friends');
        expect(
            viewCommunityLink.compareDocumentPosition(
                screen.getByText('Planet Coaster 2 · Main game')
            ) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    test('opens the community from non-interactive card areas without hijacking video links', () => {
        renderCard();

        const videoLink = screen.getByRole('link', { name: 'Watch Partner video 1 on YouTube' });
        videoLink.addEventListener('click', event => event.preventDefault(), { once: true });
        fireEvent.click(videoLink);
        expect(screen.queryByText('Community destination')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('A welcoming place for ambitious coaster builders.'));
        expect(screen.getByText('Community destination')).toBeInTheDocument();
    });
});
