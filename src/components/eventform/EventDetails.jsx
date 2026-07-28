import React from 'react';
import InfoBox from '../ui/InfoBox';

const EventDetails = ({ title, setTitle, bannerImageUrl, setBannerImageUrl, description, setDescription }) => {
    return (
        <>
            <div>
                <label className="block text-gray-700 font-bold mb-2">Event Title</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 border rounded-lg" required />
            </div>
            <div>
                <label className="block text-gray-700 font-bold mb-2">Banner Image URL</label>
                <input type="url" value={bannerImageUrl} onChange={(e) => setBannerImageUrl(e.target.value)} className="w-full p-3 border rounded-lg" placeholder="https://..." />
                <div className="mt-2"><InfoBox /></div>
            </div>
            <div>
                <label className="block text-gray-700 font-bold mb-2">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows="5" className="w-full p-3 border rounded-lg" required></textarea>
            </div>
        </>
    );
};

export default EventDetails;