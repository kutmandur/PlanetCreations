import React, { useState } from 'react';
import { db } from '../../firebase/config';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import Spinner from '../ui/Spinner';

const PLATFORMS = ['YouTube', 'Twitch', 'Instagram', 'TikTok', 'X (Twitter)', 'Other'];
const COMMUNITY_SIZES = ['< 1,000', '1,000 – 10,000', '10,000 – 50,000', '50,000 – 100,000', '> 100,000'];

// Erweiterte Influencer-Bewerbung (ersetzt den früheren Ein-Klick-Apply):
// fragt Plattform, Kanal, Community-Größe, Kontaktmöglichkeiten und eine
// kurze Beschreibung ab und speichert alles in applications/{uid}.
const InfluencerApplicationModal = ({ user, profileData, onClose, onSubmitted, setModalMessage }) => {
    const [platform, setPlatform] = useState('YouTube');
    const [channelUrl, setChannelUrl] = useState(profileData?.youtube || profileData?.twitch || '');
    const [communitySize, setCommunitySize] = useState(COMMUNITY_SIZES[0]);
    const [contactEmail, setContactEmail] = useState(user?.email || '');
    const [discordContact, setDiscordContact] = useState(profileData?.discord || '');
    const [message, setMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const canSubmit = channelUrl.trim() !== '' && contactEmail.trim() !== '' && message.trim().length >= 20;

    const handleSubmit = async () => {
        if (!canSubmit || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await setDoc(doc(db, 'applications', user.uid), {
                username: profileData?.username || '',
                platform,
                channelUrl: channelUrl.trim(),
                communitySize,
                contactEmail: contactEmail.trim(),
                discordContact: discordContact.trim(),
                message: message.trim(),
                // Snapshot der Profil-Socials für die Admin-Ansicht
                youtube: profileData?.youtube || '',
                twitch: profileData?.twitch || '',
                instagram: profileData?.instagram || '',
                tiktok: profileData?.tiktok || '',
                x: profileData?.x || '',
                discord: profileData?.discord || '',
                appliedAt: serverTimestamp(),
            });
            await updateDoc(doc(db, 'users', user.uid), { lastInfluencerApplication: serverTimestamp() });
            setModalMessage('Your influencer application has been submitted successfully!');
            onSubmitted();
            onClose();
        } catch (error) {
            setModalMessage(`Error submitting application: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-gray-800 mb-1">Influencer Application</h2>
                <p className="text-sm text-gray-500 mb-5">
                    Tell us about your channel and community so we can review your application.
                </p>

                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Main Platform</label>
                            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full p-2.5 border rounded-lg bg-white">
                                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Community Size</label>
                            <select value={communitySize} onChange={(e) => setCommunitySize(e.target.value)} className="w-full p-2.5 border rounded-lg bg-white">
                                {COMMUNITY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Channel / Profile Link <span className="text-red-500">*</span></label>
                        <input
                            type="url"
                            value={channelUrl}
                            onChange={(e) => setChannelUrl(e.target.value)}
                            placeholder="https://www.youtube.com/@yourchannel"
                            className="w-full p-2.5 border rounded-lg"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Contact Email <span className="text-red-500">*</span></label>
                            <input
                                type="email"
                                value={contactEmail}
                                onChange={(e) => setContactEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="w-full p-2.5 border rounded-lg"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Discord (optional)</label>
                            <input
                                type="text"
                                value={discordContact}
                                onChange={(e) => setDiscordContact(e.target.value)}
                                placeholder="username or user ID"
                                className="w-full p-2.5 border rounded-lg"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">About your content <span className="text-red-500">*</span></label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={4}
                            maxLength={1500}
                            placeholder="What kind of content do you create? Why would you like to become an official influencer? (at least 20 characters)"
                            className="w-full p-2.5 border rounded-lg"
                        />
                        <p className="text-xs text-gray-400 text-right">{message.length}/1500</p>
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onClose} className="py-2 px-4 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit || isSubmitting}
                        className="py-2 px-6 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold disabled:opacity-50"
                    >
                        {isSubmitting ? <Spinner size="small" /> : 'Submit Application'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InfluencerApplicationModal;
