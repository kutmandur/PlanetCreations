jest.mock('firebase/firestore', () => ({
    doc: jest.fn(),
    getDoc: jest.fn(),
}));
jest.mock('./config', () => ({ db: {} }));

import { entryToUser, searchUserIndex } from './userIndexService';

const users = [
    entryToUser('1', { un: 'PlanetBuilder', ul: 'planetbuilder', up: 'avatar-1', r: 'admin' }),
    entryToUser('2', { un: 'PlanetFan', ul: 'planetfan' }),
    entryToUser('3', { un: 'CoasterCreator', ul: 'coastercreator' }),
];

test('maps compact entries to both user-card and invite-compatible fields', () => {
    expect(users[0]).toMatchObject({
        id: '1',
        username: 'PlanetBuilder',
        profilePictureUrl: 'avatar-1',
        avatar: 'avatar-1',
        role: 'admin',
    });
});

test('keeps all legacy prefix matches ahead of fuzzy matches', () => {
    expect(searchUserIndex(users, 'planet').map(user => user.id)).toEqual(['1', '2']);
});

test('finds a username despite a small typo', () => {
    expect(searchUserIndex(users, 'coastrcreator').map(user => user.id)).toContain('3');
});
