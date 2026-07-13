import React, { useEffect, useState } from 'react';
import { db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';

const ApplicationCard = ({ application, onAccept, onDeny }) => {
    const [username, setUsername] = useState(application.username || 'No username');

    useEffect(() => {
        const fetchUsername = async () => {
            try {
                const profileRef = doc(db, 'profiles', application.id);
                const profileSnap = await getDoc(profileRef);
                if (profileSnap.exists()) {
                    const profileData = profileSnap.data();
                    setUsername(profileData.username || 'No username');
                }
            } catch (err) {
                console.error("Error fetching username:", err);
            }
        };

        if (!application.username) {
            fetchUsername();
        }
    }, [application.id, application.username]);

    const socialLinks = [
        { name: 'YouTube', url: application.youtube },
        { name: 'Twitch', url: application.twitch },
        { name: 'Instagram', url: application.instagram },
        { name: 'TikTok', url: application.tiktok },
        { name: 'X', url: application.x },
        { name: 'Discord', url: application.discord },
    ].filter(link => link.url);

    const details = [
        { label: 'Platform', value: application.platform },
        { label: 'Community Size', value: application.communitySize },
        { label: 'Contact Email', value: application.contactEmail },
        { label: 'Discord', value: application.discordContact },
    ].filter(d => d.value);

    return (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 flex flex-col">
            <div className="p-4 flex-grow">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold truncate pr-2">{username}</h3>
                    {application.appliedAt?.seconds && (
                        <span className="text-xs text-gray-400 flex-shrink-0">{new Date(application.appliedAt.seconds * 1000).toLocaleDateString()}</span>
                    )}
                </div>

                {application.channelUrl && (
                    <a
                        href={application.channelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-blue-600 hover:underline truncate mb-3"
                        title={application.channelUrl}
                    >
                        {application.channelUrl.replace(/^https?:\/\/(www\.)?/, '')} ↗
                    </a>
                )}

                {details.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
                        {details.map(d => (
                            <div key={d.label}>
                                <dt className="text-xs font-semibold text-gray-500">{d.label}</dt>
                                <dd className="text-sm text-gray-800 break-words">{d.value}</dd>
                            </div>
                        ))}
                    </dl>
                )}

                {application.message && (
                    <p className="text-sm text-gray-600 italic bg-gray-50 rounded p-2 mb-3 whitespace-pre-wrap">
                        “{application.message}”
                    </p>
                )}

                {socialLinks.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="font-semibold text-sm">Social Media:</h4>
                        <div className="flex flex-wrap gap-2">
                            {socialLinks.map(link => (
                                <a
                                    key={link.name}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-200 px-2 py-1 rounded-full"
                                >
                                    {link.name}
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                <button onClick={() => onDeny(application.id)} className="text-sm font-semibold bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-md">Deny</button>
                <button onClick={() => onAccept(application.id)} className="text-sm font-semibold bg-green-500 hover:bg-green-600 text-white py-1 px-3 rounded-md">Accept</button>
            </div>
        </div>
    );
};

export default ApplicationCard;
