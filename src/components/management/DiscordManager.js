import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/config';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const DiscordManager = ({ community, setModalMessage, setConfirmation }) => {
    const [channels, setChannels] = useState([]);
    const [isFetchingChannels, setIsFetchingChannels] = useState(false);
    const [discordChannelMapping, setDiscordChannelMapping] = useState(community.discordChannelMapping || {});
    const [isSaving, setIsSaving] = useState(false);
    const [newClassName, setNewClassName] = useState('');
    const [isUpdatingClasses, setIsUpdatingClasses] = useState(false);

    useEffect(() => {
        if (community.discordServerId && channels.length === 0) {
            fetchDiscordChannels(true);
        }
    }, [community.discordServerId]);
    
    const fetchDiscordChannels = async (isSilent = false) => {
        if (!community.discordServerId) {
            if (!isSilent) setModalMessage('Please set a Discord Server ID in the community settings first.');
            return;
        }
        setIsFetchingChannels(true);
        try {
            const response = await fetch(`https://us-central1-planetcreationsdotnet.cloudfunctions.net/api/getDiscordChannels?serverId=${community.discordServerId}`);
            if (!response.ok) throw new Error(await response.text());
            const fetchedChannels = await response.json();
            setChannels(fetchedChannels);
            if (!isSilent && fetchedChannels.length > 0) setModalMessage(`Found ${fetchedChannels.length} text channels.`);
        } catch (error) {
            if (!isSilent) setModalMessage(`Error fetching channels: ${error.message}`);
        } finally {
            setIsFetchingChannels(false);
        }
    };

    const handleChannelMappingChange = (className, selectedChannelId) => {
        setDiscordChannelMapping(prev => {
            const newMapping = { ...prev };
            if (selectedChannelId === 'none') {
                delete newMapping[className];
            } else {
                newMapping[className] = selectedChannelId;
            }
            return newMapping;
        });
    };

    const handleSaveChanges = async () => {
        setIsSaving(true);
        try {
            const communityRef = doc(db, 'communitys', community.id);
            await updateDoc(communityRef, {
                discordChannelMapping: discordChannelMapping
            });
            setModalMessage("Discord channel mapping saved successfully!");
        } catch (error) {
            setModalMessage(`Error saving changes: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleAddClass = async () => {
        const classNameToAdd = newClassName.trim();
        if (!classNameToAdd) return;
        
        const currentClasses = community.eventClasses || [];
        if (classNameToAdd.toLowerCase() === 'general' || currentClasses.map(c => c.toLowerCase()).includes(classNameToAdd.toLowerCase())) {
            setModalMessage(`The class "${classNameToAdd}" already exists.`);
            return;
        }

        setIsUpdatingClasses(true);
        try {
            const communityRef = doc(db, 'communitys', community.id);
            await updateDoc(communityRef, {
                eventClasses: arrayUnion(classNameToAdd)
            });
            setNewClassName('');
            setModalMessage(`Class "${classNameToAdd}" added successfully.`);
        } catch (error) {
            setModalMessage(`Error adding class: ${error.message}`);
        } finally {
            setIsUpdatingClasses(false);
        }
    };

    const handleDeleteClass = (classNameToDelete) => {
        setConfirmation({
            message: `Are you sure you want to delete the "${classNameToDelete}" class? This will also remove its channel mapping.`,
            onConfirm: async () => {
                setIsUpdatingClasses(true);
                try {
                    const communityRef = doc(db, 'communitys', community.id);
                    const lowerClassName = classNameToDelete.toLowerCase();
                    const newMapping = { ...discordChannelMapping };
                    delete newMapping[lowerClassName];

                    await updateDoc(communityRef, {
                        eventClasses: arrayRemove(classNameToDelete),
                        discordChannelMapping: newMapping
                    });
                    
                    setDiscordChannelMapping(newMapping);
                    setModalMessage(`Class "${classNameToDelete}" deleted successfully.`);
                } catch (error) {
                    setModalMessage(`Error deleting class: ${error.message}`);
                } finally {
                    setIsUpdatingClasses(false);
                }
            }
        });
    };

    const communityEventClasses = ['general', ...(community.eventClasses || [])];

    return (
        <div className="bg-white p-6 rounded-lg shadow-md max-w-3xl mx-auto">
            <h3 className="text-2xl font-bold text-gray-800 text-center mb-4">Discord Channel Mapping</h3>
            <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800 rounded-r-lg mb-6">
                <p className="text-sm">
                    Map a specific text channel to each of your community's notification classes. When a new creation for that class is posted, a notification will appear in the selected channel. The "general" class is used for creations added to your community that is not inside an event.
                </p>
            </div>

            <div className="text-center mb-6">
                <button 
                    type="button" 
                    onClick={() => fetchDiscordChannels(false)} 
                    disabled={isFetchingChannels || !community.discordServerId} 
                    className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-75"
                >
                    {isFetchingChannels ? <Spinner size="small" /> : 'Fetch / Refresh Channels'}
                </button>
            </div>

            <div className="mb-6 p-4 border rounded-lg bg-gray-50">
                <h4 className="font-semibold text-gray-700 mb-2">Add New Class</h4>
                <div className="flex gap-4">
                    <input
                        type="text"
                        value={newClassName}
                        onChange={(e) => setNewClassName(e.target.value)}
                        placeholder="e.g., Showcase, Contest"
                        className="flex-grow p-2 border rounded-lg"
                    />
                    <button
                        onClick={handleAddClass}
                        disabled={isUpdatingClasses || !newClassName.trim()}
                        className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                    >
                        {isUpdatingClasses ? <Spinner size="small" /> : 'Add'}
                    </button>
                </div>
            </div>

            {channels.length > 0 ? (
                <div className="space-y-4 p-4 border rounded-lg bg-gray-50">
                    {communityEventClasses.map(className => (
                        <div key={className} className="grid grid-cols-1 md:grid-cols-[1fr,2fr,auto] gap-4 items-center">
                            <label className="font-semibold text-gray-700 capitalize">{className}</label>
                            <select 
                                value={discordChannelMapping[className.toLowerCase()] || 'none'}
                                onChange={(e) => handleChannelMappingChange(className.toLowerCase(), e.target.value)}
                                className="w-full p-2 border rounded-lg bg-white"
                            >
                                <option value="none">-- No Notifications --</option>
                                {channels.map(channel => (
                                    <option key={channel.id} value={channel.id}>
                                        # {channel.name}
                                    </option>
                                ))}
                            </select>
                            {className.toLowerCase() !== 'general' && (
                                <button
                                    onClick={() => handleDeleteClass(className)}
                                    disabled={isUpdatingClasses}
                                    className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg flex items-center justify-center"
                                    aria-label={`Delete ${className} class`}
                                >
                                    <Icon path={ICONS.trash} className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                !isFetchingChannels && <p className="text-center text-gray-500">No channels found. Ensure your Server ID is correct in Settings and click "Fetch Channels".</p>
            )}

            <div className="flex justify-end mt-6">
                <button 
                    onClick={handleSaveChanges}
                    disabled={isSaving}
                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Save Channel Map'}
                </button>
            </div>
        </div>
    );
};

export default DiscordManager;