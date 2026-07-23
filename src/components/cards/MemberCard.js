import React from 'react';
import { Link } from 'react-router-dom';
import ProfileImage from '../ui/ProfileImage';

const MemberCard = ({ member, community }) => {

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

    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#000000';
        try {
            const r = parseInt(hexColor.substr(1, 2), 16);
            const g = parseInt(hexColor.substr(3, 2), 16);
            const b = parseInt(hexColor.substr(5, 2), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? '#000000' : '#ffffff';
        } catch(e) { return '#000000'; }
    };

    const memberRoles = member.roles || ['member'];
    const communityRanks = community.ranks || [];
    const themeColor = community.themeColor || '#6B7280';
    
    return (
        <Link to={`/profile/${member.id}`}>
            <article 
                className="rounded-lg shadow-md p-4 flex flex-col items-center transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer ring-4"
                style={{ 
                    backgroundColor: hexToRgba(themeColor, 0.2),
                    '--tw-ring-color': themeColor 
                }}
            >
                <ProfileImage
                    src={member.profilePictureUrl}
                    alt={`${member.username}'s profile`}
                    className="w-20 h-20 rounded-full object-cover border-4 border-white"
                />
                <div className="text-center mt-3">
                    <h3 className="text-lg font-bold text-gray-800 truncate">{member.username || 'N/A'}</h3>
                    <div className="flex flex-wrap gap-1 mt-2 justify-center">
                        {memberRoles.map(roleName => {
                            const rankInfo = communityRanks.find(r => r.name.toLowerCase() === roleName.toLowerCase());
                            const bgColor = rankInfo ? rankInfo.color : '#6B7280';
                            const textColor = getTextColorForBackground(bgColor);

                            return (
                                <span 
                                    key={roleName}
                                    className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize"
                                    style={{ backgroundColor: bgColor, color: textColor }}
                                >
                                    {roleName}
                                </span>
                            );
                        })}
                    </div>
                </div>
            </article>
        </Link>
    );
};

export default MemberCard;
