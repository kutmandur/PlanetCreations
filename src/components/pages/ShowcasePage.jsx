import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { fetchShowcaseIndex } from '../../firebase/showcaseIndexService';
import { SOCIAL_PLATFORMS, ICONS, getYoutubeId } from '../../utils/helpers';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';

// Public page for a single showcase, reached via its QR code (/#/showcase/:id).
// Built on the community-page layout: reused banner + community identity, a Home
// and a View Community button, the showcase title, the embedded video, and the
// featured creations. Loads the self-contained showcase index (1 read) plus the
// live community doc (for banner/name/socials/ranks).
const ShowcasePage = () => {
    const { showcaseId } = useParams();
    const navigate = useNavigate();
    const [showcase, setShowcase] = useState(null);
    const [community, setCommunity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        setNotFound(false);
        (async () => {
            try {
                const sc = await fetchShowcaseIndex(showcaseId);
                if (!mounted) return;
                if (!sc || !sc.creations?.length) { setNotFound(true); setLoading(false); return; }
                setShowcase(sc);
                const commSnap = await getDoc(doc(db, 'communitys', sc.communityId));
                if (!mounted) return;
                setCommunity(commSnap.exists() ? { id: commSnap.id, ...commSnap.data() } : null);
            } catch (err) {
                if (mounted) setNotFound(true);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [showcaseId]);

    // Resolve creator roles → colored rank pills using the live community ranks.
    const creations = useMemo(() => {
        const ranks = community?.ranks || [];
        return (showcase?.creations || []).map(c => ({
            ...c,
            creatorRanks: (c.creatorRoles || [])
                .map(roleName => ranks.find(r => r.name.toLowerCase() === roleName.toLowerCase()))
                .filter(Boolean),
        }));
    }, [showcase, community]);

    if (loading) return <div className="h-screen flex justify-center items-center"><Spinner /></div>;

    if (notFound) {
        return (
            <div className="container mx-auto p-8 text-center">
                <h1 className="text-2xl font-bold text-gray-800 mb-4">Showcase not found</h1>
                <p className="text-gray-500 mb-6">This showcase may have been removed or has no creations yet.</p>
                <button onClick={() => navigate('/')} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg">Go to Homepage</button>
            </div>
        );
    }

    const themeColor = community?.themeColor || '#F97316';
    const videoId = getYoutubeId(showcase.videoUrl);

    return (
        <div className="container mx-auto p-4 sm:p-8" style={{ '--theme-color': themeColor }}>
            {/* Header — reused from the community page */}
            <div className="mb-8">
                {community && (
                    <div className="relative mb-4">
                        <img
                            src={community.bannerImageUrl || 'https://placehold.co/1200x300/e2e8f0/64748b?text=Community+Banner'}
                            alt={`${community.name} Banner`}
                            className="w-full h-48 md:h-64 object-cover rounded-lg"
                        />
                        {SOCIAL_PLATFORMS.some(p => community.socialLinks?.[p.id]) && (
                            <div className="absolute bottom-3 right-3 flex gap-2">
                                {SOCIAL_PLATFORMS.filter(p => community.socialLinks?.[p.id]).map(platform => (
                                    <a key={platform.id} href={community.socialLinks[platform.id]} target="_blank" rel="noopener noreferrer" title={platform.label}
                                        className="w-9 h-9 rounded-full bg-black/60 community-bg-hover text-white flex items-center justify-center transition-colors shadow">
                                        <Icon path={platform.icon} solid={platform.solid} className="w-5 h-5" />
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-col md:flex-row justify-center items-center md:items-start gap-y-4 px-2">
                    {/* Home button (top-left) */}
                    <div className="order-2 md:order-1 w-48 flex-shrink-0 flex md:block justify-center">
                        <button onClick={() => navigate('/')} className="flex items-center justify-center community-bg hover:brightness-90 text-white px-4 py-2 rounded-md transition-all font-semibold">
                            <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2" /> Homepage
                        </button>
                    </div>

                    <div className="text-center order-1 md:order-2 flex-grow">
                        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">{community?.name || 'Showcase'}</h1>
                        {community?.description && <p className="text-gray-600 mt-2 max-w-2xl mx-auto">{community.description}</p>}
                    </div>

                    {/* View Community button (top-right) */}
                    <div className="order-3 w-48 flex-shrink-0 flex md:block justify-center md:text-right">
                        {community?.slug && (
                            <button onClick={() => navigate(`/community/${community.slug}`)} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-md transition-colors">
                                View Community
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Showcase title */}
            {showcase.name && (
                <h2 className="text-2xl sm:text-3xl font-bold text-center text-gray-800 mb-6">{showcase.name}</h2>
            )}

            {/* Video */}
            {videoId ? (
                <div className="max-w-4xl mx-auto mb-10 aspect-video rounded-lg overflow-hidden shadow-lg bg-black">
                    <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title={showcase.name || 'Showcase video'}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                    />
                </div>
            ) : showcase.videoUrl ? (
                <div className="text-center mb-10">
                    <a href={showcase.videoUrl} target="_blank" rel="noopener noreferrer" className="community-text font-semibold hover:underline">Watch the showcase video ↗</a>
                </div>
            ) : (
                <p className="text-center text-gray-400 mb-10">The showcase video will appear here once it's published.</p>
            )}

            {/* Featured creations */}
            <h3 className="text-2xl font-bold mb-4 text-gray-800">Featured Creations</h3>
            <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {creations.map(creation => <CreationCard key={creation.id} creation={creation} />)}
            </div>
        </div>
    );
};

export default ShowcasePage;
