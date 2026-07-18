import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCollaboration } from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS, getGameColor } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const CreateCollaborationForm = ({ user, setModalMessage }) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        game: 'planet-coaster-2'
    });

    const GAMES = [
        { id: 'planet-coaster-2', name: 'Planet Coaster 2', icon: '🎢' },
        { id: 'planet-zoo', name: 'Planet Zoo', icon: '🦁' }
    ];

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.title.trim()) {
            setModalMessage('Please enter a title for your collaboration.');
            return;
        }

        if (formData.title.length < 3) {
            setModalMessage('Title must be at least 3 characters long.');
            return;
        }

        if (formData.title.length > 50) {
            setModalMessage('Title must be less than 50 characters.');
            return;
        }

        setLoading(true);

        try {
            const collaborationId = await createCollaboration(user.uid, {
                title: formData.title.trim(),
                description: formData.description.trim(),
                game: formData.game
            });

            setModalMessage('Collaboration created successfully!');
            navigate(`/collaboration/${collaborationId}`);
        } catch (error) {
            console.error('Error creating collaboration:', error);
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const selectedGameColor = getGameColor(formData.game);

    return (
        <div className="container mx-auto p-4 sm:p-8 max-w-2xl" style={selectedGameColor.style}>
            <button
                onClick={() => navigate(-1)}
                className="flex items-center text-gray-600 hover:text-gray-800 mb-6 transition-colors"
            >
                <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2" />
                Back
            </button>

            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                <div className={`${selectedGameColor.bg} p-6`}>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Icon path={ICONS.users} className="w-8 h-8" />
                        New Collaboration
                    </h1>
                    <p className="text-white/80 mt-2">
                        Create a private workspace to collaborate on a project
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Game Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Game
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            {GAMES.map(game => {
                                const gameColor = getGameColor(game.id);
                                const isSelected = formData.game === game.id;
                                return (
                                    <button
                                        key={game.id}
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, game: game.id }))}
                                        style={gameColor.style}
                                        className={`p-4 rounded-lg border-2 transition-all ${
                                            isSelected
                                                ? `${gameColor.border} ${gameColor.bg} text-white`
                                                : 'border-gray-200 hover:border-gray-300 text-gray-700'
                                        }`}
                                    >
                                        <span className="text-2xl mb-2 block">{game.icon}</span>
                                        <span className="font-medium">{game.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Title */}
                    <div>
                        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                            Title <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            id="title"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            placeholder="e.g., My Awesome Theme Park"
                            maxLength={50}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1 text-right">
                            {formData.title.length}/50
                        </p>
                    </div>

                    {/* Description */}
                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                            Description
                        </label>
                        <textarea
                            id="description"
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            placeholder="What are you building? Who's involved? Any goals?"
                            rows={4}
                            maxLength={500}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                        />
                        <p className="text-xs text-gray-500 mt-1 text-right">
                            {formData.description.length}/500
                        </p>
                    </div>

                    {/* Info Box */}
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                        <h3 className="font-semibold text-purple-800 mb-2 flex items-center gap-2">
                            <Icon path={ICONS.infoCircle} className="w-5 h-5" />
                            How it works
                        </h3>
                        <ul className="text-sm text-purple-700 space-y-1">
                            <li>• You'll get an invite code to share with collaborators</li>
                            <li>• Share park/zoo files directly from your game folder</li>
                            <li>• Mark files as "in progress" so others know you're editing</li>
                            <li>• Each member keeps their last 2 versions as backup</li>
                            <li>• 500 MB storage limit (auto-cleanup of old versions)</li>
                        </ul>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading || !formData.title.trim()}
                        className={`w-full py-3 px-6 rounded-lg font-bold text-white transition-colors flex items-center justify-center gap-2 ${
                            loading || !formData.title.trim()
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-purple-500 hover:bg-purple-600'
                        }`}
                    >
                        {loading ? (
                            <>
                                <Spinner size="small" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <Icon path={ICONS.plus} className="w-5 h-5" />
                                Create Collaboration
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default CreateCollaborationForm;
