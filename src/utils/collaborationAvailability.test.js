import {
    dispatchCollaborationAvailable,
    dispatchCollaborationAvailableById,
    getAvailableCollaborationId,
    subscribeCollaborationAvailable,
} from './collaborationAvailability';

test('accepts only collaboration availability notifications with a safe link', () => {
    expect(getAvailableCollaborationId({
        type: 'collaborationAvailable',
        link: '/collaboration/collab-1',
    })).toBe('collab-1');
    expect(getAvailableCollaborationId({
        type: 'other',
        link: '/collaboration/collab-1',
    })).toBeNull();
    expect(getAvailableCollaborationId({
        type: 'collaborationAvailable',
        link: '/collaboration/../profiles',
    })).toBeNull();
});

test('refresh subscribers receive only their collaboration release', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCollaborationAvailable(
        'collab-1',
        listener,
    );

    dispatchCollaborationAvailable({
        type: 'collaborationAvailable',
        link: '/collaboration/collab-2',
    });
    dispatchCollaborationAvailable({
        type: 'collaborationAvailable',
        link: '/collaboration/collab-1',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
        collaborationId: 'collab-1',
    });
    unsubscribe();
});

test('dispatches a local release refresh by collaboration id', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCollaborationAvailable(
        'collab-local',
        listener,
    );

    expect(dispatchCollaborationAvailableById('collab-local')).toBe(true);
    expect(listener).toHaveBeenCalledWith({
        collaborationId: 'collab-local',
    });

    unsubscribe();
});
