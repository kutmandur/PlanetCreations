export function clearAccountLocalData(uid, storage = localStorage) {
    const keys = Array.from({length: storage.length}, (_, index) => storage.key(index));
    for (const key of keys) {
        if (key === `pcPersonalTheme.v1:${encodeURIComponent(uid)}` ||
            key === `planetcreations.collaborationInstalledVersions.${uid}` ||
            (key?.startsWith('planetcreations.collaborationBuildDraft.') && key.endsWith(`.${uid}`))) storage.removeItem(key);
    }
    const activeKey = 'planetcreations.activeCollaborationBuild';
    try {
        if (JSON.parse(storage.getItem(activeKey))?.userId === uid) storage.removeItem(activeKey);
    } catch { /* Unrelated/invalid local state is not evidence of ownership. */ }
}
