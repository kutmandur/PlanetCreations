import React, { useState, useEffect, useMemo, useRef, useTransition } from 'react';
import { db, auth } from '../../firebase/config';
import { doc, updateDoc, onSnapshot, collection, getDocs, writeBatch, arrayUnion, setDoc, arrayRemove, query, where, getCountFromServer } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getGameColor } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import ApplicationCard from '../cards/ApplicationCard';

const StatCard = ({ title, value, colorClass = 'bg-blue-500' }) => (
    <div className={`p-6 rounded-lg shadow-lg text-white ${colorClass}`}>
        <h4 className="text-lg font-semibold text-blue-100">{title}</h4>
        <p className="text-4xl font-bold mt-2">{value}</p>
    </div>
);

const AdminPage = ({ setPopoverView, setModalMessage, setPasswordConfirm }) => {
    const TABS = useRef(['User Management', 'Data Management', 'Email Users', 'Site Statistics']).current;
    const [activeTab, setActiveTab] = useState(TABS[0]);
    const mainTabRefs = useRef([]);
    const mainGliderRef = useRef(null);

    const [selectedGame, setSelectedGame] = useState('planet-coaster');
    const [newCategory, setNewCategory] = useState('');
    const [categories, setCategories] = useState([]);
    const [loadingCategories, setLoadingCategories] = useState(false);
    
    const [newDlc, setNewDlc] = useState('');
    const [dlcs, setDlcs] = useState([]);
    const [loadingDlcs, setLoadingDlcs] = useState(false);
    const [seedingDlcs, setSeedingDlcs] = useState(false);

    const gameTabRefs = useRef([]);
    const gameGliderRef = useRef(null);
    const color = getGameColor(selectedGame);

    const [users, setUsers] = useState([]);
    const [applications, setApplications] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    
    const [stats, setStats] = useState(null);
    const [loadingStats, setLoadingStats] = useState(true);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isPending, startTransition] = useTransition();

    const GAME_TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;

    useEffect(() => {
        const activeTabIndex = TABS.findIndex(tab => tab === activeTab);
        const activeTabNode = mainTabRefs.current[activeTabIndex];
        if (activeTabNode && mainGliderRef.current) {
            mainGliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            mainGliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [activeTab, TABS]);

    useEffect(() => {
        if (activeTab === 'Data Management') {
            const gameTabIndex = GAME_TABS.findIndex(tab => tab.id === selectedGame);
            const gameTabNode = gameTabRefs.current[gameTabIndex];
            if (gameTabNode && gameGliderRef.current) {
                gameGliderRef.current.style.left = `${gameTabNode.offsetLeft}px`;
                gameGliderRef.current.style.width = `${gameTabNode.offsetWidth}px`;
            }
        }
    }, [selectedGame, activeTab, GAME_TABS]);

    useEffect(() => {
        if (activeTab !== 'User Management') return;
        let isMounted = true;
        setLoadingUsers(true);
        const usersQuery = collection(db, 'users');
        const profilesQuery = collection(db, 'profiles');
        const appsQuery = collection(db, 'applications');
        const unsubUsers = onSnapshot(usersQuery, async (usersSnapshot) => {
            const profilesSnapshot = await getDocs(profilesQuery);
            const profilesMap = new Map(profilesSnapshot.docs.map(doc => [doc.id, doc.data()]));
            const usersData = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), ...profilesMap.get(doc.id) }));
            if (isMounted) { setUsers(usersData); setLoadingUsers(false); }
        });
        const unsubApps = onSnapshot(appsQuery, (snapshot) => {
            if (isMounted) setApplications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => { isMounted = false; unsubUsers(); unsubApps(); };
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'Data Management') return;
        let isMounted = true;
        setLoadingCategories(true);
        const catRef = doc(db, 'categories', selectedGame);
        const unsubscribe = onSnapshot(catRef, (docSnap) => {
            if (isMounted) {
                setCategories(docSnap.exists() ? docSnap.data().names || [] : []);
                setLoadingCategories(false);
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [selectedGame, activeTab]);

    useEffect(() => {
        if (activeTab !== 'Data Management') return;
        let isMounted = true;
        setLoadingDlcs(true);
        const dlcRef = doc(db, 'dlcs', selectedGame);
        const unsubscribe = onSnapshot(dlcRef, (docSnap) => {
            if (isMounted) {
                setDlcs(docSnap.exists() ? docSnap.data().names || [] : []);
                setLoadingDlcs(false);
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [selectedGame, activeTab]);

    useEffect(() => {
        if (activeTab !== 'Site Statistics') return;
        let isMounted = true;
        const fetchStats = async () => {
            setLoadingStats(true);
            try {
                const usersCol = collection(db, 'users');
                const creationsCol = collection(db, 'creations');
                const communitiesCol = collection(db, 'communitys');
                const [usersSnapshot, creationsSnapshot, communitiesSnapshot, pcCreationsSnapshot, pzCreationsSnapshot, pc2CreationsSnapshot] = await Promise.all([
                    getCountFromServer(usersCol), getCountFromServer(creationsCol), getCountFromServer(communitiesCol),
                    getCountFromServer(query(creationsCol, where('game', '==', 'planet-coaster'))),
                    getCountFromServer(query(creationsCol, where('game', '==', 'planet-zoo'))),
                    getCountFromServer(query(creationsCol, where('game', '==', 'planet-coaster-2'))),
                ]);
                if (isMounted) {
                    setStats({
                        totalUsers: usersSnapshot.data().count,
                        totalCreations: creationsSnapshot.data().count,
                        totalCommunities: communitiesSnapshot.data().count,
                        creationsByGame: {
                            'planet-coaster': pcCreationsSnapshot.data().count,
                            'planet-zoo': pzCreationsSnapshot.data().count,
                            'planet-coaster-2': pc2CreationsSnapshot.data().count,
                        }
                    });
                }
            } catch (error) {
                if(isMounted) setModalMessage("Could not load site statistics.");
            } finally {
                if(isMounted) setLoadingStats(false);
            }
        };
        fetchStats();
        return () => { isMounted = false; };
    }, [activeTab, setModalMessage]);

    const handleProfileClick = (userId) => {
        startTransition(() => {
            setPopoverView({ name: 'profile', userId: userId });
        });
    };

    const handleRoleChange = async (userId, newRole) => {
        const batch = writeBatch(db);
        batch.update(doc(db, 'users', userId), { role: newRole });
        batch.update(doc(db, 'profiles', userId), { role: newRole });
        await batch.commit();
    };

    const handleApplication = async (applicationId, accepted) => {
        setPasswordConfirm({
            message: `To ${accepted ? 'accept' : 'deny'} this application, please confirm with your password.`,
            onConfirm: async (password) => {
                const user = auth.currentUser;
                try {
                    const credential = EmailAuthProvider.credential(user.email, password);
                    await reauthenticateWithCredential(user, credential);
                    const batch = writeBatch(db);
                    if (accepted) {
                        batch.update(doc(db, 'users', applicationId), { role: 'influencer' });
                        batch.update(doc(db, 'profiles', applicationId), { role: 'influencer' });
                    }
                    batch.delete(doc(db, 'applications', applicationId));
                    await batch.commit();
                    setModalMessage(`Application ${accepted ? 'accepted' : 'denied'} successfully.`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const handleAddCategory = async () => {
        if (!newCategory.trim()) return;
        setLoadingCategories(true);
        try {
            await setDoc(doc(db, 'categories', selectedGame), { names: arrayUnion(newCategory.trim()) }, { merge: true });
            setNewCategory('');
        } catch (error) {
            setModalMessage(`Error adding category: ${error.message}`);
        } finally {
            setLoadingCategories(false);
        }
    };

    const handleDeleteCategory = async (categoryToDelete) => {
        setLoadingCategories(true);
        try {
            await updateDoc(doc(db, 'categories', selectedGame), { names: arrayRemove(categoryToDelete) });
        } catch (error) {
            setModalMessage(`Error deleting category: ${error.message}`);
        } finally {
            setLoadingCategories(false);
        }
    };

    const handleAddDlc = async () => {
        if (!newDlc.trim()) return;
        setLoadingDlcs(true);
        try {
            await setDoc(doc(db, 'dlcs', selectedGame), { names: arrayUnion(newDlc.trim()) }, { merge: true });
            setNewDlc('');
        } catch (error) {
            setModalMessage(`Error adding DLC: ${error.message}`);
        } finally {
            setLoadingDlcs(false);
        }
    };

    const handleDeleteDlc = async (dlcToDelete) => {
        setLoadingDlcs(true);
        try {
            await updateDoc(doc(db, 'dlcs', selectedGame), { names: arrayRemove(dlcToDelete) });
        } catch (error) {
            setModalMessage(`Error deleting DLC: ${error.message}`);
        } finally {
            setLoadingDlcs(false);
        }
    };

    const handleSeedDlcs = async () => {
        setSeedingDlcs(true);
        try {
            const allDlcs = {
                'planet-coaster': ['Adventure Pack', 'Classic Rides Collection', 'Magnificent Rides Collection', 'World\'s Fair Pack', 'Vintage Pack', 'Studios Pack', 'Spooky Pack', 'Ghostbusters™', 'Knight Rider™ K.I.T.T. Construction Kit', 'Back to the Future™ Time Machine Construction Kit', 'The Munsters® Munster Koach Construction Kit'],
                'planet-zoo': ['Deluxe Upgrade Pack', 'Arctic Pack', 'South America Pack', 'Australia Pack', 'Aquatic Pack', 'Southeast Asia Animal Pack', 'Africa Pack', 'North America Animal Pack', 'Europe Pack', 'Wetlands Animal Pack', 'Conservation Pack', 'Twilight Pack', 'Grasslands Animal Pack', 'Tropical Pack', 'Arid Animal Pack', 'Oceania Pack', 'Eurasia Animal Pack', 'Barnyard Animal Pack', 'Zookeepers Animal Pack', 'Americas Animal Pack', 'Asia Animal Pack'],
                'planet-coaster-2': ['Thrill-Seekers Ride Pack', 'Vintage Funfair Ride Pack']
            };

            const batch = writeBatch(db);
            for (const [game, dlcList] of Object.entries(allDlcs)) {
                const docRef = doc(db, 'dlcs', game);
                batch.set(docRef, { names: dlcList });
            }
            await batch.commit();
            setModalMessage("Successfully seeded all DLCs to the database!");
        } catch (error) {
            setModalMessage(`Error seeding DLCs: ${error.message}`);
        } finally {
            setSeedingDlcs(false);
        }
    };

    const handleGenerateEmailList = () => {
        setPasswordConfirm({
            message: "To generate the user email list, please confirm with your password.",
            onConfirm: async (password) => {
                const user = auth.currentUser;
                if (!user) return;
                
                try {
                    setIsGenerating(true);
                    const credential = EmailAuthProvider.credential(user.email, password);
                    await reauthenticateWithCredential(user, credential);
                    await auth.currentUser.getIdToken(true);

                    const functions = getFunctions();
                    const getAllUserEmails = httpsCallable(functions, 'getAllUserEmails');
                    const result = await getAllUserEmails();
                    
                    const emails = result.data.emails;
                    if (emails && emails.length > 0) {
                        const emailList = emails.join(', ');
                        await navigator.clipboard.writeText(emailList);
                        setModalMessage(`Successfully copied ${emails.length} email addresses to your clipboard.`);
                    } else {
                        setModalMessage("No user emails found.");
                    }

                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                } finally {
                    setIsGenerating(false);
                }
            }
        });
    };
    
    const filteredUsers = useMemo(() => users.filter(user => user.username?.toLowerCase().includes(searchTerm.toLowerCase())), [users, searchTerm]);
  
    const renderContent = () => {
        switch (activeTab) {
            case 'User Management':
                return (
                    <div className={`transition-opacity ${isPending ? 'opacity-50' : 'opacity-100'}`}>
                        <div className="mb-6">
                            <h2 className="text-2xl font-bold mb-4 text-center">Influencer Applications</h2>
                            {applications.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {applications.map(app => <ApplicationCard key={app.id} application={app} onAccept={() => handleApplication(app.id, true)} onDeny={() => handleApplication(app.id, false)} />)}
                                </div>
                            ) : <p className="text-center text-gray-500">No pending applications.</p>}
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold mb-4 text-center">All Users</h2>
                            <input type="text" placeholder="Search by username..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full max-w-md p-2 border rounded-lg mb-4 block mx-auto"/>
                            {loadingUsers ? <Spinner /> : (
                                <div className="overflow-x-auto bg-white rounded-lg shadow">
                                    <table className="min-w-full text-left text-sm">
                                        <thead className="border-b bg-gray-50">
                                            <tr>
                                                <th className="p-2 font-semibold">Username</th>
                                                <th className="p-2 font-semibold">Role</th>
                                                <th className="p-2 font-semibold">Joined</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUsers.map(user => (
                                                <tr key={user.id} className="border-b hover:bg-gray-50">
                                                    <td className="p-2">
                                                        <button onClick={() => handleProfileClick(user.id)} className="text-blue-500 hover:underline focus:outline-none font-semibold">{user.username || 'N/A'}</button>
                                                    </td>
                                                    <td className="p-2">
                                                        <select value={user.role} onChange={(e) => handleRoleChange(user.id, e.target.value)} className="p-1 border rounded-md bg-white">
                                                            <option value="user">User</option>
                                                            <option value="influencer">Influencer</option>
                                                            <option value="moderator">Moderator</option>
                                                            <option value="admin">Admin</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-2 text-gray-500">
                                                        {user.createdAt ? new Date(user.createdAt.seconds * 1000).toLocaleDateString() : 'N/A'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                );
            case 'Data Management':
                return (
                    <div>
                        <div className="relative flex justify-center my-6">
                            <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                                <div ref={gameGliderRef} className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} />
                                {GAME_TABS.map((tab, index) => (
                                    <button key={tab.id} ref={el => gameTabRefs.current[index] = el} onClick={() => setSelectedGame(tab.id)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${selectedGame === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}>{tab.name}</button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white p-6 rounded-lg shadow-md">
                                <h3 className="text-xl font-bold mb-4">Manage Categories</h3>
                                <div className="flex space-x-2 mb-4">
                                    <input type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" className="flex-grow p-2 border rounded-lg" />
                                    <button onClick={handleAddCategory} disabled={loadingCategories} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-4 rounded-lg`}>Add</button>
                                </div>
                                <div className="max-h-96 overflow-y-auto">
                                    {loadingCategories ? <Spinner /> : categories.length > 0 ? categories.map(cat => (
                                        <div key={cat} className="flex justify-between items-center p-2 border-b"><span className="truncate">{cat}</span><button onClick={() => handleDeleteCategory(cat)} className="text-red-500 hover:text-red-700 ml-2">Delete</button></div>
                                    )) : <p className="text-sm text-gray-500">No categories found.</p>}
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-lg shadow-md">
                                <h3 className="text-xl font-bold mb-4">Manage DLCs</h3>
                                <div className="flex space-x-2 mb-4">
                                    <input type="text" value={newDlc} onChange={(e) => setNewDlc(e.target.value)} placeholder="New DLC name" className="flex-grow p-2 border rounded-lg" />
                                    <button onClick={handleAddDlc} disabled={loadingDlcs} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-4 rounded-lg`}>Add</button>
                                </div>
                                <div className="max-h-96 overflow-y-auto">
                                    {loadingDlcs ? <Spinner /> : dlcs.length > 0 ? dlcs.map(dlc => (
                                        <div key={dlc} className="flex justify-between items-center p-2 border-b"><span className="truncate">{dlc}</span><button onClick={() => handleDeleteDlc(dlc)} className="text-red-500 hover:text-red-700 ml-2">Delete</button></div>
                                    )) : <p className="text-sm text-gray-500">No DLCs found.</p>}
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-center gap-4">
                            <button onClick={handleSeedDlcs} disabled={seedingDlcs} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50">
                                {seedingDlcs ? <Spinner size="small" /> : 'Seed All DLCs to Database'}
                            </button>
                        </div>
                    </div>
                );
            case 'Email Users':
                return (
                    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto text-center">
                        <h2 className="text-2xl font-bold mb-4">Generate User Email List</h2>
                        <p className="text-gray-600 mb-6">Click the button below to generate a comma-separated list of all user emails. The list will be automatically copied to your clipboard.</p>
                        <button
                            onClick={handleGenerateEmailList}
                            disabled={isGenerating}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-lg disabled:opacity-50"
                        >
                            {isGenerating ? 'Generating...' : 'Generate & Copy Email List'}
                        </button>
                    </div>
                );
            case 'Site Statistics':
                if (loadingStats || !stats) return <Spinner />;
                return (
                    <div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <StatCard title="Total Users" value={stats.totalUsers} colorClass="bg-indigo-500" />
                            <StatCard title="Total Creations" value={stats.totalCreations} colorClass="bg-purple-500" />
                            <StatCard title="Total Communities" value={stats.totalCommunities} colorClass="bg-pink-500" />
                        </div>
                        <div className="mt-8 bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-2xl font-bold mb-4 text-gray-800">Creations by Game</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <StatCard title="Planet Coaster" value={stats.creationsByGame['planet-coaster']} colorClass={getGameColor('planet-coaster').bg} />
                                <StatCard title="Planet Zoo" value={stats.creationsByGame['planet-zoo']} colorClass={getGameColor('planet-zoo').bg} />
                                <StatCard title="Planet Coaster 2" value={stats.creationsByGame['planet-coaster-2']} colorClass={getGameColor('planet-coaster-2').bg} />
                            </div>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="container mx-auto p-4 sm:p-8">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">Admin Management</h1>
            <div className="relative flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                    <div ref={mainGliderRef} className="absolute h-full bg-red-500 rounded-full transition-all duration-300 ease-in-out" />
                    {TABS.map((tab, index) => (
                        <button
                            key={tab}
                            ref={el => mainTabRefs.current[index] = el}
                            onClick={() => setActiveTab(tab)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium ${activeTab === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>
            <div className="py-6">
                {renderContent()}
            </div>
        </div>
    );
};

export default AdminPage;