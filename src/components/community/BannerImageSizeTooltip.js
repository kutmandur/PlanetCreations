import React from 'react';

const BannerImageSizeTooltip = () => (
  <span className="group relative inline-flex">
    <button
      type="button"
      aria-label="Show recommended banner dimensions"
      className="flex h-5 w-5 items-center justify-center rounded-full border border-blue-500 bg-white text-xs font-bold text-blue-600 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-gray-800 dark:text-blue-300"
    >
      i
    </button>
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-xl bg-gray-900 p-3 text-xs font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      Recommended banner size: 1200 × 300 px (4:1). Keep important content
      centered because community cards may crop the outer edges.
    </span>
  </span>
);

export default BannerImageSizeTooltip;
