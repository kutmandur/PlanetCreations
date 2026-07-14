import React from 'react';
import SharingQrCode from './SharingQrCode';

// Only the hash route resolves to a creation (the clean /creation/<id> path is
// rewritten to the api function and 404s), so encode that form against the fixed
// production origin (never window.location, which would embed a localhost URL in dev).
const PUBLIC_ORIGIN = 'https://planetcreations.net';

const CreationSharingQrCode = ({ creationId, creationName }) => {
    if (!creationId) return null;
    return (
        <SharingQrCode
            url={`${PUBLIC_ORIGIN}/#/creation/${creationId}`}
            name={creationName}
            fileLabel={creationName}
            copyLabel="Copy Creation Link"
        />
    );
};

export default CreationSharingQrCode;
