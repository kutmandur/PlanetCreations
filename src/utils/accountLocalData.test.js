import {beforeEach, expect, it} from 'vitest';
import {clearAccountLocalData} from './accountLocalData';
beforeEach(() => localStorage.clear());
it('clears only the departing account drafts and metadata, preserving local game data and other accounts', () => {
    const own = ['pcPersonalTheme.v1:departing', 'planetcreations.collaborationInstalledVersions.departing', 'planetcreations.collaborationBuildDraft.collab.departing'];
    const other = ['pcPersonalTheme.v1:other', 'planetcreations.collaborationBuildDraft.collab.other', 'local-game-library'];
    [...own, ...other].forEach(key => localStorage.setItem(key, 'data'));
    localStorage.setItem('planetcreations.activeCollaborationBuild', JSON.stringify({userId: 'departing'}));
    clearAccountLocalData('departing');
    own.forEach(key => expect(localStorage.getItem(key)).toBeNull());
    other.forEach(key => expect(localStorage.getItem(key)).toBe('data'));
    expect(localStorage.getItem('planetcreations.activeCollaborationBuild')).toBeNull();
});
