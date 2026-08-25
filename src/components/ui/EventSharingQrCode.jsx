import React from 'react';
import SharingQrCode from './SharingQrCode';

// Analog zu CreationSharingQrCode: nur die Hash-Route führt zum Event, und der
// Link wird gegen den festen Produktions-Origin kodiert (nie window.location,
// sonst landet im QR-Code eine localhost-URL aus der Dev-Umgebung).
const PUBLIC_ORIGIN = 'https://www.planetcreations.net';

const EventSharingQrCode = ({ eventId, eventName }) => {
    if (!eventId) return null;
    return (
        <SharingQrCode
            url={`${PUBLIC_ORIGIN}/event/${encodeURIComponent(eventId)}`}
            name={eventName}
            fileLabel={eventName}
            copyLabel="Copy Event Link"
        />
    );
};

export default EventSharingQrCode;
