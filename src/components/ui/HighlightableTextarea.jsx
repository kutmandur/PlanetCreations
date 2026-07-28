import React from 'react';

const HighlightableTextarea = ({ value, onChange, blacklist, ...props }) => {
    const renderHighlightedText = () => {
        if (!value) return null;
        
        const escapedBlacklist = blacklist.map(word => word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
        if (escapedBlacklist.length === 0) return <span>{value}</span>;
        
        const regex = new RegExp(`\\b(${escapedBlacklist.join('|')})\\b`, 'gi');
        const parts = value.split(regex);

        return parts.map((part, index) => {
            const isBlacklisted = blacklist.some(word => word.toLowerCase() === part.toLowerCase());
            if (isBlacklisted) {
                return (
                    <span key={index} className="bg-red-200 text-red-700 line-through decoration-red-500 rounded px-1">
                        {part}
                    </span>
                );
            }
            // Use a non-breaking space for empty parts to maintain layout
            return <span key={index}>{part || '\u00A0'}</span>;
        });
    };

    const baseClasses = "w-full p-3 border rounded-lg focus:ring-2 bg-transparent font-mono leading-normal text-base";
    const passedClasses = props.className || '';

    return (
        <div className="relative">
            {/* The visible div that shows the highlighted/styled text */}
            <div
                className={`${baseClasses} ${passedClasses} text-gray-800 caret-transparent whitespace-pre-wrap`}
                style={{ minHeight: props.rows ? `${props.rows * 1.5 + 1.5}rem` : 'auto' }}
                aria-hidden="true"
            >
                {renderHighlightedText()}
                &#8203;
            </div>
            {/* The actual textarea that the user types in, sits underneath */}
            <textarea
                {...props}
                value={value}
                onChange={onChange}
                spellCheck="false"
                className={`${baseClasses} ${passedClasses} absolute inset-0 overflow-hidden resize-none focus:outline-none text-transparent caret-gray-800`}
            />
        </div>
    );
};

export default HighlightableTextarea;