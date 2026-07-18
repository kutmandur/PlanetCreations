import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { deleteCollaboration } from '../../firebase/collaboration';
import Icon from '../ui/Icon';
import { ICONS, getGameColor } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const CollaborationManager = ({ setModalMessage, setConfirmation }) => {
    const [collaborations, setCollaborations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterGame, setFilterGame] = useState('all');
    const [sortBy, setSortBy] = useState('createdAt');

    useEffect(() => {
        setLoading(true);
        const q = query(
            collection(db, 'collaborations'),
            orderBy('createdAt', 'desc'),
            limit(100)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const collabsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setCollaborations(collabsData);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching collaborations:', error);
            setModalMessage('Error loading collaborations.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [setModalMessage]);

    const handleDelete = (collab) => {
        setConfirmation({
            message: `Delete "${collab.title}"? This will remove all files, comments, and members. This cannot be undone.`,
            onConfirm: async () => {
                try {
                    await deleteCollaboration(collab.id);
                    setModalMessage('Collaboration deleted successfully.');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const filteredCollaborations = collaborations.filter(collab => {
        const matchesSearch =
            collab.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            collab.description?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesGame = filterGame === 'all' || collab.game === filterGame;
        return matchesSearch && matchesGame;
    });

    const sortedCollaborations = [...filteredCollaborations].sort((a, b) => {
        if (sortBy === 'createdAt') {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        }
        if (sortBy === 'memberCount') {
            return (b.memberIds?.length || 0) - (a.memberIds?.length || 0);
        }
        if (sortBy === 'title') {
            return (a.title || '').localeCompare(b.title || '');
        }
        return 0;
    });

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
    };

    if (loading) {
        return <Spinner />;
    }

    return (
        <div className="space-y-6">
            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                    <p className="text-sm text-gray-500">Total Collaborations</p>
                    <p className="text-2xl font-bold text-gray-800">{collaborations.length}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                    <p className="text-sm text-gray-500">Active</p>
                    <p className="text-2xl font-bold text-green-600">
                        {collaborations.filter(c => c.status === 'active').length}
                    </p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                    <p className="text-sm text-gray-500">Planet Coaster 2</p>
                    <p className="text-2xl font-bold text-purple-600">
                        {collaborations.filter(c => c.game === 'planet-coaster-2').length}
                    </p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                    <p className="text-sm text-gray-500">Planet Zoo</p>
                    <p className="text-2xl font-bold text-teal-600">
                        {collaborations.filter(c => c.game === 'planet-zoo').length}
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
                <input
                    type="text"
                    placeholder="Search collaborations..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 p-3 bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
                <select
                    value={filterGame}
                    onChange={(e) => setFilterGame(e.target.value)}
                    className="p-3 border border-gray-300 rounded-lg bg-white"
                >
                    <option value="all">All Games</option>
                    <option value="planet-coaster-2">Planet Coaster 2</option>
                    <option value="planet-zoo">Planet Zoo</option>
                </select>
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="p-3 border border-gray-300 rounded-lg bg-white"
                >
                    <option value="createdAt">Newest First</option>
                    <option value="memberCount">Most Members</option>
                    <option value="title">Alphabetical</option>
                </select>
            </div>

            {/* Collaborations Table */}
            {sortedCollaborations.length > 0 ? (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Title</th>
                                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Game</th>
                                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Owner</th>
                                    <th className="text-center px-4 py-3 text-sm font-semibold text-gray-600">Members</th>
                                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Storage</th>
                                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Created</th>
                                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Status</th>
                                    <th className="text-right px-4 py-3 text-sm font-semibold text-gray-600">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {sortedCollaborations.map(collab => {
                                    const gameColor = getGameColor(collab.game);
                                    const storagePercent = collab.storage
                                        ? Math.round((collab.storage.totalBytes / collab.storage.limitBytes) * 100)
                                        : 0;

                                    return (
                                        <tr key={collab.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3">
                                                <Link
                                                    to={`/collaboration/${collab.id}`}
                                                    className="font-medium text-gray-800 hover:text-purple-600 transition-colors"
                                                >
                                                    {collab.title}
                                                </Link>
                                                {collab.description && (
                                                    <p className="text-xs text-gray-500 truncate max-w-xs">
                                                        {collab.description}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span style={gameColor.style} className={`px-2 py-1 text-xs font-medium rounded-full ${gameColor.bg} text-white`}>
                                                    {collab.game === 'planet-coaster-2' ? 'PC2' : 'PZ'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <Link
                                                    to={`/profile/${collab.ownerId}`}
                                                    className="text-sm text-gray-600 hover:text-purple-600"
                                                >
                                                    {collab.ownerUsername || collab.ownerId?.slice(0, 8)}
                                                </Link>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                                                    <Icon path={ICONS.users} className="w-4 h-4" />
                                                    {collab.memberIds?.length || 0}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full ${
                                                                storagePercent > 90 ? 'bg-red-500' :
                                                                storagePercent > 70 ? 'bg-yellow-500' : 'bg-green-500'
                                                            }`}
                                                            style={{ width: `${Math.min(storagePercent, 100)}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs text-gray-500">
                                                        {formatBytes(collab.storage?.totalBytes)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {formatDate(collab.createdAt)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                                    collab.status === 'active' ? 'bg-green-100 text-green-800' :
                                                    collab.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                                                    'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {collab.status || 'active'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Link
                                                        to={`/collaboration/${collab.id}`}
                                                        className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                                        title="View"
                                                    >
                                                        <Icon path={ICONS.eye} className="w-5 h-5" />
                                                    </Link>
                                                    <button
                                                        onClick={() => handleDelete(collab)}
                                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Icon path={ICONS.trash} className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-center py-12 bg-white rounded-lg shadow">
                    <Icon path={ICONS.users} className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-700 mb-2">No Collaborations Found</h3>
                    <p className="text-gray-500">
                        {searchTerm || filterGame !== 'all'
                            ? 'Try adjusting your search or filters.'
                            : 'No collaborations have been created yet.'}
                    </p>
                </div>
            )}
        </div>
    );
};

export default CollaborationManager;
