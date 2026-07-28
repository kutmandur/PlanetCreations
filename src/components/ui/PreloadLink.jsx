import React from 'react';
import { Link } from 'react-router-dom';
import { createPreloadHandlers } from '../../utils/preload';

/**
 * Link-Komponente mit automatischem Preloading bei Hover/Touch
 * Ersetzt react-router-dom's Link für wichtige Navigation
 */
const PreloadLink = ({ to, children, className, ...props }) => {
    const preloadHandlers = createPreloadHandlers(to);

    return (
        <Link
            to={to}
            className={className}
            {...preloadHandlers}
            {...props}
        >
            {children}
        </Link>
    );
};

export default PreloadLink;
