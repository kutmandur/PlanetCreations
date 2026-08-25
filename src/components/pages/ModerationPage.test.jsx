import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ModerationPage from './ModerationPage';

const reportData = [
    { targetId: 'creation-1', targetType: 'creation', targetTitle: 'Coaster', reason: 'Spam', reporterId: 'a' },
    { targetId: 'creation-1', targetType: 'creation', targetTitle: 'Coaster', reason: 'Duplicate', reporterId: 'b' },
    { targetId: 'user-1', targetType: 'user', targetTitle: 'User', reason: 'Abuse', reporterId: 'c' },
    { targetId: 'comment-1', targetType: 'comment', targetTitle: 'Comment', reason: 'Abuse', reporterId: 'd' },
];

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((...parts) => ({ path: parts.slice(1).join('/') })),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    increment: vi.fn(),
    onSnapshot: vi.fn((reference, onNext) => {
        const data = reference.path === 'reports' ? reportData : [];
        onNext({ docs: data.map((entry, index) => ({ id: `doc-${index}`, data: () => entry })) });
        return vi.fn();
    }),
    query: vi.fn(reference => reference),
    updateDoc: vi.fn(),
    where: vi.fn(),
    writeBatch: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
    EmailAuthProvider: { credential: vi.fn() },
    reauthenticateWithCredential: vi.fn(),
}));
vi.mock('../../firebase/config', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../cards/ReportCard', () => ({ default: ({ item }) => <div>Report card: {item.type}</div> }));
vi.mock('../management/BlacklistManager', () => ({ default: () => <div>Blacklist manager</div> }));
vi.mock('../management/TagManager', () => ({ default: () => <div>Tag manager</div> }));
vi.mock('../management/CollaborationManager', () => ({ default: () => <div>Collaboration manager</div> }));

const renderPage = initialEntry => render(
    <MemoryRouter initialEntries={[initialEntry]}>
        <ModerationPage
            setPopoverView={vi.fn()}
            setModalMessage={vi.fn()}
            setStrikeModal={vi.fn()}
            setPasswordConfirm={vi.fn()}
            setConfirmation={vi.fn()}
            blacklist={[]}
        />
    </MemoryRouter>,
);

describe('ModerationPage consolidated navigation', () => {
    test('keeps legacy report links and shows cumulative report counts', async () => {
        renderPage('/moderation?tab=reported-users');

        const reportsTab = await screen.findByRole('tab', { name: /Reports/ });
        expect(reportsTab).toHaveTextContent('4');
        expect(screen.getByRole('tab', { name: /Creations/ })).toHaveTextContent('2');
        expect(screen.getByRole('tab', { name: /Users/ })).toHaveTextContent('1');
        expect(screen.getByRole('tab', { name: /^Content1$/ })).toHaveTextContent('1');
        expect(screen.getByText('Report card: user')).toBeInTheDocument();
        expect(screen.queryByText('Report card: creation')).not.toBeInTheDocument();
    });

    test('combines blacklist and tag library under content settings', async () => {
        renderPage('/moderation?tab=blacklist');

        expect(await screen.findByText('Blacklist manager')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Reports/ })).toHaveTextContent('4');
        fireEvent.click(screen.getByRole('tab', { name: 'Tag Library' }));
        expect(await screen.findByText('Tag manager')).toBeInTheDocument();
    });
});
