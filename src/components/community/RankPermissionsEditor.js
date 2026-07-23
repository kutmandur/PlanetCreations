import React, { useState } from 'react';
import {
    COMMUNITY_PERMISSION_DEFINITIONS,
    getRankPermissionValue,
} from '../../utils/communityPermissions';

const FIXED_RANK_PERMISSION_DETAILS = {
    owner: {
        label: 'Owner permissions',
        items: [
            'All member and management permissions are always enabled.',
            'Edit community settings, ranks, membership options and Discord integration.',
            'Manage all members, transfer ownership or delete the community.',
        ],
    },
};

export const FixedRankPermissionsInfo = ({ role }) => {
    const details = FIXED_RANK_PERMISSION_DETAILS[role];
    if (!details) return null;
    const tooltipId = `${role}-permissions-tooltip`;

    return (
        <div className="relative inline-flex group">
            <button
                type="button"
                aria-label={`Show ${details.label.toLowerCase()}`}
                aria-describedby={tooltipId}
                className="w-6 h-6 rounded-full border-2 border-blue-500 text-blue-600 bg-white font-bold text-sm leading-none flex items-center justify-center hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                i
            </button>
            <div
                id={tooltipId}
                role="tooltip"
                className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 absolute z-30 bottom-full left-0 mb-2 w-80 max-w-[80vw] rounded-xl bg-gray-900 text-white p-4 shadow-xl transition-opacity"
            >
                <p className="font-bold text-sm">{details.label}</p>
                <ul className="mt-2 space-y-1.5 text-xs text-gray-200 list-disc pl-4">
                    {details.items.map(item => <li key={item}>{item}</li>)}
                </ul>
            </div>
        </div>
    );
};

const RankPermissionsEditor = ({
    rank,
    onChange,
    disabled = false,
    role = 'custom',
}) => {
    const [expanded, setExpanded] = useState(false);
    const groups = [...new Set(
        COMMUNITY_PERMISSION_DEFINITIONS.map(definition => definition.group)
    )];
    const enabledCount = COMMUNITY_PERMISSION_DEFINITIONS.filter(definition =>
        getRankPermissionValue(rank, definition, role)).length;

    return (
        <div className="rounded-lg border bg-white overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(current => !current)}
                aria-expanded={expanded}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
            >
                <span>
                    <span className="block text-sm font-bold text-gray-700">Permissions</span>
                    <span className="block text-xs text-gray-500">
                        {enabledCount} of {COMMUNITY_PERMISSION_DEFINITIONS.length} enabled
                    </span>
                </span>
                <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
                >
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
            </button>

            {expanded && (
                <div className="border-t p-3 space-y-4">
                    {groups.map(group => (
                        <section key={group}>
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                                {group}
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {COMMUNITY_PERMISSION_DEFINITIONS
                                    .filter(definition => definition.group === group)
                                    .map(definition => (
                                        <label
                                            key={definition.rankField}
                                            className={`flex items-start gap-2 text-sm ${disabled ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
                                            title={definition.description}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={getRankPermissionValue(
                                                    rank,
                                                    definition,
                                                    role
                                                )}
                                                onChange={(event) => onChange?.(
                                                    definition.rankField,
                                                    event.target.checked
                                                )}
                                                disabled={disabled}
                                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600"
                                            />
                                            <span>
                                                <span className="block font-semibold text-gray-700">
                                                    {definition.label}
                                                </span>
                                                <span className="block text-xs text-gray-500">
                                                    {definition.description}
                                                </span>
                                            </span>
                                        </label>
                                    ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
};

export default RankPermissionsEditor;
