import React from 'react';
import { Link } from 'react-router-dom';

const UserSearchResultCard = ({ user }) => {

    const ROLE_COLORS = {
        admin: { bg: '#EF4444', text: '#FFFFFF' },      // Red
        moderator: { bg: '#F59E0B', text: '#FFFFFF' }, // Amber
        influencer: { bg: '#3B82F6', text: '#FFFFFF' },// Blue
        user: { bg: '#10B981', text: '#FFFFFF' },        // Emerald
    };

    const hexToRgba = (hex, alpha = 0.1) => {
        if (!hex) return `rgba(255, 255, 255, 1)`; // default white
        try {
            const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            const [r, g, b] = result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0,0,0];
            return `rgba(${r},${g},${b},${alpha})`;
        } catch (e) {
            return `rgba(255, 255, 255, 1)`;
        }
    };

    const role = user.role || 'user';
    const roleColors = ROLE_COLORS[role] || ROLE_COLORS['user'];
    const themeColor = roleColors.bg;

    return (
        <Link to={`/profile/${user.id}`}>
            <article 
                className="rounded-lg shadow-md p-4 flex flex-col items-center transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer h-full ring-4"
                style={{ 
                    backgroundColor: hexToRgba(themeColor, 0.2),
                    '--tw-ring-color': themeColor 
                }}
            >
                <img 
                    src={user.profilePictureUrl || 'https://placehold.co/64x64/e2e8f0/64748b?text=P'} 
                    alt={`${user.username}'s profile`}
                    className="w-20 h-20 rounded-full object-cover border-4 border-white"
                />
                <div className="text-center mt-3">
                    <h3 className="text-lg font-bold text-gray-800 truncate">{user.username || 'N/A'}</h3>
                    <div className="flex flex-wrap gap-1 mt-2 justify-center">
                        <span 
                            className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize"
                            style={{ backgroundColor: roleColors.bg, color: roleColors.text }}
                        >
                            {role}
                        </span>
                    </div>
                </div>
            </article>
        </Link>
    );
};

export default UserSearchResultCard;