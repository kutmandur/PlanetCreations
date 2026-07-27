export const COLLABORATION_AVAILABLE_NOTIFICATION_TYPE =
    'collaborationAvailable';
const COLLABORATION_AVAILABLE_EVENT =
    'planetcreations:collaboration-available';

export const getAvailableCollaborationId = (notification) => {
    if (notification?.type !==
        COLLABORATION_AVAILABLE_NOTIFICATION_TYPE) {
        return null;
    }
    const match = String(notification.link || '').match(
        /^\/collaboration\/([A-Za-z0-9_-]{1,128})$/,
    );
    return match ? match[1] : null;
};

export const dispatchCollaborationAvailable = (notification) => {
    const collaborationId = getAvailableCollaborationId(notification);
    return dispatchCollaborationAvailableById(collaborationId);
};

export const dispatchCollaborationAvailableById = (collaborationId) => {
    if (!collaborationId || typeof window === 'undefined') return false;
    window.dispatchEvent(new CustomEvent(
        COLLABORATION_AVAILABLE_EVENT,
        {detail: {collaborationId}},
    ));
    return true;
};

export const subscribeCollaborationAvailable = (
    collaborationId,
    listener,
) => {
    if (typeof window === 'undefined') return () => {};
    const handleAvailable = (event) => {
        if (event.detail?.collaborationId === collaborationId) {
            listener(event.detail);
        }
    };
    window.addEventListener(
        COLLABORATION_AVAILABLE_EVENT,
        handleAvailable,
    );
    return () => window.removeEventListener(
        COLLABORATION_AVAILABLE_EVENT,
        handleAvailable,
    );
};
