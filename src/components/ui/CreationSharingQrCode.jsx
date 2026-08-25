import React from 'react';
import SharingQrCode from './SharingQrCode';
import { buildCreationShareUrl } from '../../utils/overlayQr';

const CreationSharingQrCode = ({ creationId, creationName }) => {
    if (!creationId) return null;
    return (
        <SharingQrCode
            url={buildCreationShareUrl(creationId)}
            name={creationName}
            fileLabel={creationName}
            copyLabel="Copy Creation Link"
            headingClassName="text-center"
        />
    );
};

export default CreationSharingQrCode;
