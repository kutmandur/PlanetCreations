import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {getDoc, updateDoc, writeBatch, getDocs} from 'firebase/firestore';
import { MemoryRouter } from 'react-router-dom';
import ModerationPage from './ModerationPage';
const moderateAccount=vi.hoisted(()=>vi.fn().mockResolvedValue({data:{}}));
vi.mock('firebase/functions',()=>({getFunctions:vi.fn(),httpsCallable:()=>moderateAccount}));

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
        if(reference.path==='moderationIndexState'){onNext({docs:[{id:'Creations',data:()=>({reportCount:2})},{id:'Users',data:()=>({reportCount:1})},{id:'Content',data:()=>({reportCount:1})}]});return vi.fn();}
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
vi.mock('../../firebase/config', () => ({ auth: { currentUser: {email:'test@example.test'} }, db: {} }));
vi.mock('../cards/ReportCard', () => ({ default: ({ item, onAction }) => <div>Report card: {item.type}<button onClick={()=>onAction('strike',item.id,item.type)}>Test strike</button><button onClick={()=>onAction('delete',item.id,item.type)}>Test delete</button></div> }));
vi.mock('../management/ModerationIndexPanel',()=>({default:({category,onAction})=><div>Report card: {category==='Creations'?'creation':category==='Users'?'user':'comment'}<button onClick={()=>onAction('strike','creation-1','creation')}>Test strike</button><button onClick={()=>onAction('delete','creation-1','creation')}>Test delete</button></div>}));
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
    test('strike does not clear reports or commit a deletion batch',async()=>{
        const strike=vi.fn();getDoc.mockResolvedValue({exists:()=>true,data:()=>({userId:'author'})});
        writeBatch.mockClear();
        render(<MemoryRouter><ModerationPage setStrikeModal={strike} setModalMessage={vi.fn()}/></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button',{name:'Test strike'}));
        await strike.mock.calls[0][0].onConfirm('Warning');
        expect(moderateAccount).toHaveBeenCalledWith({targetUserId:'author',action:'warn',reason:'Warning'});expect(writeBatch).not.toHaveBeenCalled();
    });
    test('permanent delete cannot remove a creation with retained review content',async()=>{
        const confirm=vi.fn(),message=vi.fn(),batch={delete:vi.fn(),update:vi.fn(),commit:vi.fn()};
        writeBatch.mockReturnValue(batch);getDocs.mockResolvedValue({docs:[{data:()=>({targetType:'creation',original:{title:'Park'}})}]});
        render(<MemoryRouter><ModerationPage setPasswordConfirm={confirm} setModalMessage={message}/></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button',{name:'Test delete'}));
        await confirm.mock.calls[0][0].onConfirm('test-password');
        expect(batch.delete).not.toHaveBeenCalled();expect(batch.commit).not.toHaveBeenCalled();
        expect(message).toHaveBeenCalledWith(expect.stringContaining('Restore withheld content'));
    });
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
