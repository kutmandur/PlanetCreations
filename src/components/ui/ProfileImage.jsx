import React, { useEffect, useState } from 'react';
import logo from '../../assets/logo.png';

const ProfileImage = ({ src, alt = 'Profile', ...props }) => {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    return (
        <img
            src={!failed && src ? src : logo}
            alt={alt}
            {...props}
            onError={() => setFailed(true)}
        />
    );
};

export default ProfileImage;
