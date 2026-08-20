import React from 'react';
import partnerBadgeTemplate from '../../assets/official-partner-badge.png';

const OfficialPartnerBadge = ({ communityName, logoUrl, variant = 'banner' }) => (
    <div
        data-testid="official-partner-badge"
        className={variant === 'card'
            ? 'absolute left-3 top-3 z-20 h-16 w-16'
            : 'absolute left-5 top-5 z-20 h-28 w-28 md:left-6 md:top-6 md:h-36 md:w-36'}
    >
        <div
            data-testid="partner-logo-background"
            className="absolute left-[25.5%] top-[20.8%] z-10 h-[49.5%] w-[49.5%] bg-white dark:bg-gray-800"
        >
            <div className="h-full w-full">
                {logoUrl ? (
                    <img
                        src={logoUrl}
                        alt={`${communityName} logo`}
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className={`flex h-full w-full items-center justify-center font-bold text-gray-700 dark:text-gray-100 ${variant === 'card' ? 'text-xs' : 'text-xl md:text-2xl'}`}>
                        {(communityName || 'C').trim().charAt(0).toUpperCase()}
                    </div>
                )}
            </div>
        </div>

        <img
            src={partnerBadgeTemplate}
            alt="Official Partner badge"
            className="pointer-events-none absolute inset-0 z-20 h-full w-full object-contain drop-shadow-lg"
        />

        <div
            className="group/logo absolute left-[25.5%] top-[20.8%] z-30 h-[49.5%] w-[49.5%] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-600"
            role="img"
            aria-label="Official Partner Community"
            tabIndex={variant === 'card' ? undefined : 0}
        >
            <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-[165%] z-40 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/logo:opacity-100 group-focus/logo:opacity-100"
            >
                Official Partner Community
            </span>
        </div>
    </div>
);

export default OfficialPartnerBadge;
