import React, { useState, useEffect } from 'react';
import { db, auth } from '../../firebase/config';
import { doc, getDoc, updateDoc, collection, getDocs, setDoc, writeBatch, deleteField, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, deleteUser, getIdToken, sendEmailVerification } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getGameColor } from '../../utils/helpers';
import { joinCommunity } from '../../firebase/community';
import PasswordInput from '../ui/PasswordInput';
import PasswordStrengthIndicator from '../ui/PasswordStrengthIndicator';
import Spinner from '../ui/Spinner';

const SettingsPage = ({ user, setView, setModalMessage, setConfirmation, activeTab }) => {
    const [loading, setLoading] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [deleteInput, setDeleteInput] = useState('');
    const color = getGameColor(activeTab);

    const [profileData, setProfileData] = useState(null);
    const [canApply, setCanApply] = useState(false);
    const [cooldown, setCooldown] = useState(false);
    
    const [isSyncing, setIsSyncing] = useState(false);
    const [linkedDiscordInfo, setLinkedDiscordInfo] = useState(null);
    const [isJoining, setIsJoining] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        if (!user) return;

        const userRef = doc(db, 'users', user.uid);
        const unsubscribe = onSnapshot(userRef, async (userSnap) => {
            if (userSnap.exists()) {
                const data = userSnap.data();
                
                if (data.discordId && data.discordUsername) {
                    setLinkedDiscordInfo({ id: data.discordId, username: data.discordUsername });
                } else {
                    setLinkedDiscordInfo(null);
                }

                const profileRef = doc(db, 'profiles', user.uid);
                const profileSnap = await getDoc(profileRef);
                const publicData = profileSnap.exists() ? profileSnap.data() : {};

                const fullProfile = {...data, ...publicData};
                setProfileData(fullProfile);
                
                const hasSocials = fullProfile.youtube || fullProfile.twitch || fullProfile.instagram || fullProfile.tiktok || fullProfile.x || fullProfile.discord;
                
                const lastApplied = data.lastInfluencerApplication?.toDate();
                let isCooldown = false;
                if (lastApplied) {
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    if (lastApplied > thirtyDaysAgo) {
                        isCooldown = true;
                    }
                }
                setCooldown(isCooldown);
                setCanApply(hasSocials && !isCooldown);
            }
        });
        
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('discord-linked') === 'success') {
            setModalMessage("Discord account linked successfully!");
            window.history.replaceState({}, document.title, window.location.pathname);
        }


        return () => unsubscribe();
    }, [user, setModalMessage]);

    const handleLinkDiscord = () => {
        const functionUrl = `https://us-central1-planetcreationsdotnet.cloudfunctions.net/api/discordAuthRedirect?appUserId=${user.uid}`;
        window.open(functionUrl, '_blank', 'noopener,noreferrer');
    };

    const handleUnlinkDiscord = async () => {
        setConfirmation({
            message: "Are you sure you want to unlink your Discord account? Your ranks will no longer be synced, and you won't get community suggestions.",
            onConfirm: async () => {
                try {
                    const userRef = doc(db, 'users', user.uid);
                    await updateDoc(userRef, {
                        discordId: deleteField(),
                        discordUsername: deleteField(),
                        discordGuilds: deleteField(),
                        discordRefreshToken: deleteField()
                    });
                    setModalMessage("Discord account has been unlinked.");
                } catch (error) {
                    setModalMessage(`Error unlinking account: ${error.message}`);
                }
            }
        });
    };

    const handleSyncRoles = async () => {
        if (!user) {
            setModalMessage("You must be logged in to sync your roles.");
            return;
        }

        setIsSyncing(true);
        setModalMessage("Syncing your community ranks...");

        try {
            const token = await getIdToken(user);
            const response = await fetch('https://us-central1-planetcreationsdotnet.cloudfunctions.net/api/syncUserDiscordRoles', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Failed to sync roles.");
            }

            setModalMessage(result.message);

        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setIsSyncing(false);
        }
    };
    
    const handleJoinAllSuggested = async () => {
        setIsJoining(true);
        try {
            if (!profileData?.discordGuilds || profileData.discordGuilds.length === 0) {
                setModalMessage("Your Discord server list isn't synced. Please relink your Discord account or refresh the list.");
                setIsJoining(false);
                return;
            }
            
            const membershipsSnap = await getDocs(collection(db, 'profiles', user.uid, 'communityMemberships'));
            const myCommunityIds = membershipsSnap.docs.map(doc => doc.id);

            const communitiesQuery = query(collection(db, 'communitys'), where('discordServerId', '!=', null));
            const communitiesSnap = await getDocs(communitiesQuery);
            const allPlatformCommunities = communitiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const suggestions = allPlatformCommunities.filter(community => 
                profileData.discordGuilds.includes(community.discordServerId) && !myCommunityIds.includes(community.id)
            );

            if (suggestions.length === 0) {
                setModalMessage("No new communities to join were found!");
                setIsJoining(false);
                return;
            }
            
            setConfirmation({
                message: `You are about to join ${suggestions.length} new community/communities. Are you sure?`,
                onConfirm: async () => {
                    setModalMessage("Joining communities...");
                    const joinPromises = suggestions.map(community => joinCommunity(community.id, user.uid));
                    await Promise.all(joinPromises);
                    setModalMessage(`Successfully joined ${suggestions.length} new communities!`);
                }
            });

        } catch (error) {
            setModalMessage(`Error joining communities: ${error.message}`);
        } finally {
            setIsJoining(false);
        }
    };

    const handleRefreshGuilds = async () => {
        const lastRefresh = localStorage.getItem('lastDiscordRefresh');
        const oneHour = 60 * 60 * 1000;
        if (lastRefresh && (Date.now() - lastRefresh < oneHour)) {
            const timeLeft = Math.ceil((oneHour - (Date.now() - lastRefresh)) / (60 * 1000));
            setModalMessage(`You can refresh your server list again in ${timeLeft} minutes.`);
            return;
        }

        setIsRefreshing(true);
        try {
            const functions = getFunctions();
            const refreshDiscordGuilds = httpsCallable(functions, 'refreshDiscordGuilds');
            const result = await refreshDiscordGuilds();
            localStorage.setItem('lastDiscordRefresh', Date.now());
            setModalMessage(result.data.message);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setIsRefreshing(false);
        }
    };


    const validatePassword = (passwordToCheck) => {
        const checks = {
            length: passwordToCheck.length >= 10,
            uppercase: /[A-Z]/.test(passwordToCheck),
            number: /[0-9]/.test(passwordToCheck),
            special: /[^A-Za-z0-9]/.test(passwordToCheck),
        };
        return Object.values(checks).every(Boolean);
    };
    
    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmNewPassword) {
            setModalMessage("New passwords do not match.");
            return;
        }
        if (!validatePassword(newPassword)) {
            setModalMessage("New password does not meet all the required criteria.");
            return;
        }

        setLoading(true);
        try {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPassword);
            setModalMessage("Password updated successfully!");
            setCurrentPassword('');
            setNewPassword('');
            setConfirmNewPassword('');
        } catch (error) {
            setModalMessage(`Error: ${error.message}. Please check your current password.`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAccount = () => {
        if (!deleteInput) {
            setModalMessage("Please enter your password to confirm deletion.");
            return;
        }
        setConfirmation({
            message: `This action is irreversible. Are you sure you want to delete your account and all associated data?`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    const credential = EmailAuthProvider.credential(user.email, deleteInput);
                    await reauthenticateWithCredential(user, credential);
                    
                    const functions = getFunctions();
                    const deleteOwnAccount = httpsCallable(functions, 'deleteOwnAccount');
                    await deleteOwnAccount();
                    
                    setModalMessage("Account deleted successfully. You will be logged out.");
                } catch (error) {
                    setModalMessage(`Error deleting account: ${error.message}. Please check your password.`);
                } finally {
                    setLoading(false);
                    setDeleteInput('');
                }
            },
        });
    };

    const handleApply = async () => {
        if (!canApply || !profileData) return;
        
        try {
            const applicationRef = doc(db, 'applications', user.uid);
            await setDoc(applicationRef, {
                username: profileData.username,
                youtube: profileData.youtube || '',
                twitch: profileData.twitch || '',
                instagram: profileData.instagram || '',
                tiktok: profileData.tiktok || '',
                x: profileData.x || '',
                discord: profileData.discord || '',
                appliedAt: serverTimestamp()
            });

            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, { lastInfluencerApplication: serverTimestamp() });

            setModalMessage("Your application has been submitted successfully!");
            setCanApply(false);
            setCooldown(true);
        } catch (error) {
            setModalMessage(`Error submitting application: ${error.message}`);
        }
    };

    const handleResendVerification = async () => {
        if (user) {
            try {
                await sendEmailVerification(user);
                setModalMessage("A new verification email has been sent.");
            } catch (error) {
                setModalMessage(`Error: ${error.message}`);
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto mt-10 p-4 sm:p-8 space-y-8">
            <h1 className="text-4xl font-bold text-center text-gray-800">Account Settings</h1>

            {user && !user.emailVerified && (
                 <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-bold mb-2">Email Verification</h2>
                    <p className="text-gray-600 mb-4">Your email address has not been verified. Please check your inbox or resend the verification email.</p>
                    <button 
                        onClick={handleResendVerification}
                        className={`w-full ${color.bg} ${color.hoverBg} text-white font-bold py-3 px-4 rounded-lg transition-colors`}
                    >
                        Resend Verification Email
                    </button>
                </div>
            )}
            
            <div className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-4">Change Password</h2>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div>
                        <label className="block text-gray-700 font-bold mb-2" htmlFor="current-password">Current Password</label>
                        <PasswordInput 
                            id="current-password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-gray-700 font-bold mb-2" htmlFor="new-password">New Password</label>
                        <PasswordInput 
                            id="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`}
                            required
                        />
                        <PasswordStrengthIndicator password={newPassword} />
                    </div>
                    <div>
                        <label className="block text-gray-700 font-bold mb-2" htmlFor="confirm-new-password">Confirm New Password</label>
                        <PasswordInput 
                            id="confirm-new-password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`}
                            required
                        />
                    </div>
                    <button type="submit" disabled={loading} className={`w-full ${color.bg} ${color.hoverBg} text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 transition-colors`}>
                        {loading ? 'Updating...' : 'Update Password'}
                    </button>
                </form>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-2">Discord Integration</h2>
                <p className="text-gray-600 mb-4">Link your Discord account to sync roles and find communities your friends are in.</p>
                
                {linkedDiscordInfo ? (
                    <div className="p-4 bg-green-50 border-l-4 border-green-400 rounded-r-lg flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <p className="text-green-800 font-semibold">Linked to: <span className="bg-green-200 text-green-900 font-bold py-1 px-3 rounded-full">{linkedDiscordInfo.username}</span></p>
                             <button 
                                onClick={handleRefreshGuilds}
                                disabled={isRefreshing}
                                className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg"
                            >
                                {isRefreshing ? 'Refreshing...' : 'Refresh Server List'}
                            </button>
                        </div>
                        <button 
                            onClick={handleUnlinkDiscord}
                            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg"
                        >
                            Unlink
                        </button>
                    </div>
                ) : (
                    <button 
                        onClick={handleLinkDiscord}
                        className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                    >
                        Link with Discord
                    </button>
                )}
                <div className="grid grid-cols-2 gap-4 mt-4">
                    <button 
                        onClick={handleSyncRoles}
                        disabled={isSyncing || !linkedDiscordInfo}
                        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isSyncing ? 'Syncing...' : 'Sync Ranks Now'}
                    </button>
                     <button 
                        onClick={handleJoinAllSuggested}
                        disabled={isJoining || !linkedDiscordInfo}
                        className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isJoining ? 'Joining...' : 'Join All Suggested Communitys'}
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-2">Influencer Application</h2>
                <p className="text-gray-600 mb-4">Apply to become an official Influencer. You must have at least one social media link in your profile to apply. You can apply once every 30 days.</p>
                <button 
                    onClick={handleApply}
                    disabled={!canApply || loading}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {cooldown ? "You have recently applied" : (!canApply ? "Add social links to your profile to apply" : "Apply for Influencer Role")}
                </button>
            </div>

            <div className="bg-red-50 p-6 rounded-lg shadow-md border border-red-200">
                <h2 className="text-2xl font-bold mb-2 text-red-700">Delete Account</h2>
                <p className="text-red-600 mb-4">This action is permanent and cannot be undone. All your creations and profile data will be lost.</p>
                <div>
                     <label className="block text-red-700 font-bold mb-2" htmlFor="delete-confirm">To confirm, please enter your current password.</label>
                     <PasswordInput 
                        id="delete-confirm"
                        value={deleteInput}
                        onChange={(e) => setDeleteInput(e.target.value)}
                        className="w-full p-3 border rounded-lg border-red-300 focus:ring-2 focus:ring-red-500"
                        placeholder="Enter your password"
                        required
                    />
                </div>
                <button 
                    onClick={handleDeleteAccount} 
                    disabled={loading || !deleteInput} 
                    className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 transition-colors"
                >
                    {loading ? 'Deleting...' : 'Delete My Account'}
                </button>
            </div>
        </div>
    );
};

export default SettingsPage;