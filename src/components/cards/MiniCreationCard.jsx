import React from 'react';
import PreloadLink from '../ui/PreloadLink';
import { getYoutubeThumbnailUrl as getYoutubeThumbnail } from '../../utils/helpers';

const MiniCreationCard = ({ creation }) => {

    const initialThumbnail = creation.imageUrls?.length > 0 
        ? creation.imageUrls[0] 
        : creation.videoUrls?.length > 0 
        ? getYoutubeThumbnail(creation.videoUrls[0]) 
        : 'https://placehold.co/400x225/333333/ffffff?text=No+Media';

    return (
        <PreloadLink to={`/creation/${creation.id}`}>
            <article 
                className="bg-white rounded-lg shadow-md overflow-hidden transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer flex flex-col relative group h-full"
            >
                <div className="relative">
                    <div className="overflow-hidden h-28">
                        <img 
                            src={initialThumbnail} 
                            alt={creation.title} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                            onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x225/333333/ffffff?text=Image+Missing'; }}
                        />
                    </div>
                    
                    <div 
                        className={`absolute top-1 right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${creation.status === 'finished' ? 'bg-green-500' : 'bg-orange-500'}`} 
                        title={creation.status === 'finished' ? 'Finished' : 'Work in Progress'}
                    ></div>
                </div>

                <div className="p-3 flex flex-col flex-grow">
                    {/* ✅ MODIFIED: Added 'text-center' to center the title */}
                    <h3 
                        className="text-md font-bold line-clamp-2 min-h-[2.5rem] text-center" 
                        title={creation.title}
                    >
                        {creation.title}
                    </h3>
                </div>
            </article>
        </PreloadLink>
    );
};

export default MiniCreationCard;