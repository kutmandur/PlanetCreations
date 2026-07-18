import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
    leaveCollaboration,
    deleteCollaboration,
    regenerateInviteCode,
    checkOutFile,
    addTodo,
    toggleTodo,
    deleteTodo
} from '../../firebase/collaboration';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import { getGame } from '../../utils/gamesRegistry';
import CollaborationMemberList from '../collaboration/CollaborationMemberList';
import InviteMemberModal from '../modals/InviteMemberModal';
import CheckOutModal from '../modals/CheckOutModal';
import FileVersionsModal from '../modals/FileVersionsModal';

const TABS = ['Project', 'Members', 'Settings'];

const CollaborationDetailPage = ({ user, userProfile, setModalMessage, setConfirmation }) => {
    const { collaborationId } = useParams();
    const navigate = useNavigate();
    const isRunningInElectron = window.electronAPI?.isElectron;

    const [collaboration, setCollaboration] = useState(null);
    const [members, setMembers] = useState([]);
    const [files, setFiles] = useState([]);
    const [uploads, setUploads] = useState([]);
    const [todos, setTodos] = useState([]);
    const [workSessions, setWorkSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('Project');

    const [userRole, setUserRole] = useState(null);
    const [isOwner, setIsOwner] = useState(false);

    const isSiteMod = userProfile?.role === 'moderator' || userProfile?.role === 'admin';
    const hasOwnerPermissions = isOwner || isSiteMod;

    const [showInviteModal, setShowInviteModal] = useState(false);
    const [showCheckOutModal, setShowCheckOutModal] = useState(null);
    const [showVersionsModal, setShowVersionsModal] = useState(null);

    const [newTodo, setNewTodo] = useState('');

    const tabRefs = useRef([]);
    const gliderRef = useRef(null);

    // Check if any file is currently checked out
    const activeCheckout = files.find(f => f.checkedOutBy);
    const isBuilding = !!activeCheckout;

    // Load collaboration data
    useEffect(() => {
        if (!collaborationId) return;

        const unsubCollaboration = onSnapshot(
            doc(db, 'collaborations', collaborationId),
            (docSnap) => {
                if (docSnap.exists()) {
                    setCollaboration({ id: docSnap.id, ...docSnap.data() });
                } else {
                    setModalMessage('Collaboration not found.');
                    navigate('/communitys');
                }
                setLoading(false);
            }
        );

        return () => unsubCollaboration();
    }, [collaborationId, navigate, setModalMessage]);

    // Load members
    useEffect(() => {
        if (!collaborationId) return;

        const unsubMembers = onSnapshot(
            collection(db, 'collaborations', collaborationId, 'members'),
            (snapshot) => {
                const membersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setMembers(membersData);

                if (user) {
                    const currentUserMember = membersData.find(m => m.id === user.uid);
                    if (currentUserMember) {
                        setUserRole(currentUserMember.role);
                        setIsOwner(currentUserMember.role === 'owner');
                    }
                }
            }
        );

        return () => unsubMembers();
    }, [collaborationId, user]);

    // Load files
    useEffect(() => {
        if (!collaborationId) return;

        const unsubFiles = onSnapshot(
            collection(db, 'collaborations', collaborationId, 'files'),
            (snapshot) => {
                const filesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                filesData.sort((a, b) => {
                    const aTime = a.updatedAt?.toMillis?.() || 0;
                    const bTime = b.updatedAt?.toMillis?.() || 0;
                    return bTime - aTime;
                });
                setFiles(filesData);
            }
        );

        return () => unsubFiles();
    }, [collaborationId]);

    // Load uploads (changelog entries)
    useEffect(() => {
        if (!collaborationId) return;

        const uploadsQuery = query(
            collection(db, 'collaborations', collaborationId, 'uploads'),
            orderBy('createdAt', 'desc')
        );

        const unsubUploads = onSnapshot(uploadsQuery, (snapshot) => {
            const uploadsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setUploads(uploadsData);
        });

        return () => unsubUploads();
    }, [collaborationId]);

    // Load todos
    useEffect(() => {
        if (!collaborationId) return;

        const todosQuery = query(
            collection(db, 'collaborations', collaborationId, 'todos'),
            orderBy('createdAt', 'asc')
        );

        const unsubTodos = onSnapshot(todosQuery, (snapshot) => {
            const todosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTodos(todosData);
        });

        return () => unsubTodos();
    }, [collaborationId]);

    // Load work sessions
    useEffect(() => {
        if (!collaborationId) return;

        const sessionsQuery = query(
            collection(db, 'collaborations', collaborationId, 'workSessions'),
            orderBy('startedAt', 'desc')
        );

        const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
            const sessionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setWorkSessions(sessionsData);
        });

        return () => unsubSessions();
    }, [collaborationId]);

    // Tab glider animation
    useEffect(() => {
        const activeIndex = TABS.indexOf(activeTab);
        const activeTabEl = tabRefs.current[activeIndex];
        if (activeTabEl && gliderRef.current) {
            gliderRef.current.style.width = `${activeTabEl.offsetWidth}px`;
            gliderRef.current.style.left = `${activeTabEl.offsetLeft}px`;
        }
    }, [activeTab]);

    const handleLeave = async () => {
        setConfirmation({
            message: 'Are you sure you want to leave this collaboration?',
            onConfirm: async () => {
                try {
                    await leaveCollaboration(collaborationId, user.uid);
                    setModalMessage('You have left the collaboration.');
                    navigate('/communitys');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const handleDelete = async () => {
        setConfirmation({
            message: 'Are you sure you want to DELETE this collaboration? This cannot be undone.',
            onConfirm: async () => {
                try {
                    await deleteCollaboration(collaborationId);
                    setModalMessage('Collaboration deleted.');
                    navigate('/communitys');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    const handleRegenerateInvite = async () => {
        try {
            const newCode = await regenerateInviteCode(collaborationId);
            setModalMessage(`New invite code: ${newCode}`);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleCheckOut = async (fileId, note, expectedMinutes) => {
        try {
            await checkOutFile(collaborationId, fileId, user.uid, note, expectedMinutes);
            setShowCheckOutModal(null);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleAddTodo = async (e) => {
        e.preventDefault();
        if (!newTodo.trim()) return;

        try {
            await addTodo(collaborationId, user.uid, newTodo.trim());
            setNewTodo('');
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleToggleTodo = async (todoId, completed) => {
        try {
            await toggleTodo(collaborationId, todoId, user.uid, !completed);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleDeleteTodo = async (todoId) => {
        try {
            await deleteTodo(collaborationId, todoId);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleShareFile = async () => {
        if (!isRunningInElectron) {
            setModalMessage('File sharing requires the desktop client.');
            return;
        }

        try {
            const result = await window.electronAPI.selectFile({
                filters: [
                    { name: 'Game Files', extensions: ['park2', 'zoo', 'blpr2', 'pzblueprint'] }
                ]
            });

            if (result && result.filePath) {
                setModalMessage('File upload coming soon!');
            }
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString();
    };

    const formatDuration = (minutes) => {
        if (!minutes) return '< 1 min';
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
    };

    if (loading) {
        return (
            <div className="h-full flex justify-center items-center">
                <Spinner />
            </div>
        );
    }

    if (!collaboration) {
        return null;
    }

    const storagePercent = collaboration.storage
        ? Math.round((collaboration.storage.totalBytes / collaboration.storage.limitBytes) * 100)
        : 0;

    const builderUsername = activeCheckout
        ? members.find(m => m.id === activeCheckout.checkedOutBy)?.username || 'Someone'
        : null;

    // Get recent work sessions (last 10)
    const recentSessions = workSessions.slice(0, 10);

    // Separate todos
    const pendingTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    const renderProjectTab = () => (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Upload Cards */}
            <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold text-gray-800">Updates</h2>
                    {isRunningInElectron && userRole !== 'viewer' && (
                        <button
                            onClick={handleShareFile}
                            className="inline-flex items-center text-sm bg-purple-500 hover:bg-purple-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                            <Icon path={ICONS.plus} className="w-4 h-4 mr-2" />
                            Upload New Version
                        </button>
                    )}
                </div>

                {/* Upload Cards */}
                {uploads.length > 0 ? (
                    <div className="space-y-4">
                        {uploads.map(upload => (
                            <div
                                key={upload.id}
                                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
                            >
                                {/* Card Header */}
                                <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-5 py-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                                                <Icon path={ICONS.database} className="w-5 h-5 text-white" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-white">{upload.fileName}</h3>
                                                <p className="text-white/70 text-sm">
                                                    Version {upload.versionNumber} • {formatBytes(upload.sizeBytes)}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="text-white/70 text-sm">
                                            {formatTime(upload.createdAt)}
                                        </span>
                                    </div>
                                </div>

                                {/* Card Body */}
                                <div className="p-5">
                                    {/* Changelog */}
                                    {upload.changelog && (
                                        <div className="mb-4">
                                            <h4 className="text-sm font-medium text-gray-500 mb-2">Changelog</h4>
                                            <p className="text-gray-700 whitespace-pre-wrap">{upload.changelog}</p>
                                        </div>
                                    )}

                                    {/* Meta Info */}
                                    <div className="flex items-center gap-6 text-sm text-gray-500">
                                        <div className="flex items-center gap-2">
                                            <Icon path={ICONS.user} className="w-4 h-4" />
                                            <span>{upload.username}</span>
                                        </div>
                                        {upload.workDurationMinutes > 0 && (
                                            <div className="flex items-center gap-2">
                                                <Icon path={ICONS.clock} className="w-4 h-4" />
                                                <span>{formatDuration(upload.workDurationMinutes)} work time</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : files.length > 0 ? (
                    // Show files if no uploads yet but files exist
                    <div className="space-y-3">
                        {files.map(file => (
                            <div
                                key={file.id}
                                className="bg-white rounded-xl shadow-sm border border-gray-200 p-5"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                            <Icon path={ICONS.database} className="w-5 h-5 text-purple-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-gray-800">{file.name}</h3>
                                            <p className="text-sm text-gray-500">
                                                {formatBytes(file.size)} • Updated {formatTime(file.updatedAt)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {file.checkedOutBy ? (
                                            <span className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-full">
                                                In Use
                                            </span>
                                        ) : (
                                            <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
                                                Available
                                            </span>
                                        )}
                                        <button
                                            onClick={() => setShowVersionsModal(file.id)}
                                            className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                        >
                                            <Icon path={ICONS.clock} className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                        <Icon path={ICONS.database} className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <h3 className="font-medium text-gray-700 mb-1">No Updates Yet</h3>
                        <p className="text-sm text-gray-500">
                            {isRunningInElectron
                                ? 'Upload your first file to get started.'
                                : 'Files can only be uploaded via the desktop client.'}
                        </p>
                    </div>
                )}
            </div>

            {/* Right Column - Todos & Work History */}
            <div className="space-y-6">
                {/* Todo List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                            <Icon path={ICONS.check} className="w-5 h-5 text-purple-500" />
                            To-Do List
                        </h2>
                    </div>

                    <div className="p-4">
                        {/* Add Todo Form */}
                        <form onSubmit={handleAddTodo} className="flex gap-2 mb-4">
                            <input
                                type="text"
                                value={newTodo}
                                onChange={(e) => setNewTodo(e.target.value)}
                                placeholder="Add a task..."
                                className="flex-1 px-3 py-2 bg-gray-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-colors"
                                disabled={!user}
                            />
                            <button
                                type="submit"
                                disabled={!newTodo.trim()}
                                className="px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                            >
                                <Icon path={ICONS.plus} className="w-5 h-5" />
                            </button>
                        </form>

                        {/* Pending Todos */}
                        <div className="space-y-2">
                            {pendingTodos.map(todo => (
                                <div
                                    key={todo.id}
                                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 group"
                                >
                                    <button
                                        onClick={() => handleToggleTodo(todo.id, todo.completed)}
                                        className="w-5 h-5 border-2 border-gray-300 rounded hover:border-purple-500 transition-colors flex-shrink-0"
                                    />
                                    <span className="flex-1 text-sm text-gray-700">{todo.text}</span>
                                    {hasOwnerPermissions && (
                                        <button
                                            onClick={() => handleDeleteTodo(todo.id)}
                                            className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Icon path={ICONS.xMark} className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Completed Todos */}
                        {completedTodos.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <p className="text-xs text-gray-400 mb-2">Completed ({completedTodos.length})</p>
                                <div className="space-y-2">
                                    {completedTodos.slice(0, 5).map(todo => (
                                        <div
                                            key={todo.id}
                                            className="flex items-center gap-3 p-2 rounded-lg group"
                                        >
                                            <button
                                                onClick={() => handleToggleTodo(todo.id, todo.completed)}
                                                className="w-5 h-5 bg-purple-500 border-2 border-purple-500 rounded flex items-center justify-center flex-shrink-0"
                                            >
                                                <Icon path={ICONS.check} className="w-3 h-3 text-white" />
                                            </button>
                                            <span className="flex-1 text-sm text-gray-400 line-through">{todo.text}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {todos.length === 0 && (
                            <p className="text-sm text-gray-400 text-center py-4">No tasks yet</p>
                        )}
                    </div>
                </div>

                {/* Work History */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                            <Icon path={ICONS.clock} className="w-5 h-5 text-purple-500" />
                            Work History
                        </h2>
                    </div>

                    <div className="p-4 max-h-80 overflow-y-auto">
                        {recentSessions.length > 0 ? (
                            <div className="space-y-3">
                                {recentSessions.map(session => (
                                    <div
                                        key={session.id}
                                        className="flex items-start gap-3 text-sm"
                                    >
                                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                                            <span className="text-gray-600 font-medium text-xs">
                                                {session.username?.charAt(0).toUpperCase() || '?'}
                                            </span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-gray-800">
                                                <span className="font-medium">{session.username}</span>
                                                {session.endedAt ? (
                                                    <span className="text-gray-500"> worked on {session.fileName}</span>
                                                ) : (
                                                    <span className="text-green-600"> is working on {session.fileName}</span>
                                                )}
                                            </p>
                                            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                                                <span>{formatTime(session.startedAt)}</span>
                                                {session.durationMinutes && (
                                                    <span>• {formatDuration(session.durationMinutes)}</span>
                                                )}
                                            </div>
                                            {session.note && (
                                                <p className="text-gray-500 text-xs mt-1 italic">"{session.note}"</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-400 text-center py-4">No work history yet</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    const renderSettingsTab = () => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - General Settings */}
            <div className="space-y-6">
                {/* Invite Code */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <Icon path={ICONS.share} className="w-5 h-5 text-purple-500" />
                        Invite Code
                    </h3>
                    <div className="flex items-center gap-3">
                        <code className="flex-1 bg-gray-100 px-4 py-2.5 rounded-lg font-mono text-lg text-center">
                            {collaboration.inviteCode}
                        </code>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(collaboration.inviteCode);
                                setModalMessage('Invite code copied!');
                            }}
                            className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Copy"
                        >
                            <Icon path={ICONS.copy} className="w-5 h-5" />
                        </button>
                        {hasOwnerPermissions && (
                            <button
                                onClick={handleRegenerateInvite}
                                className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Regenerate"
                            >
                                <Icon path={ICONS.refresh} className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                    <p className="text-sm text-gray-500 mt-3">
                        Share this code with people you want to invite.
                    </p>
                </div>

                {/* Storage */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <Icon path={ICONS.database} className="w-5 h-5 text-purple-500" />
                        Storage
                    </h3>
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                        <span>{formatBytes(collaboration.storage?.totalBytes)} used</span>
                        <span>{formatBytes(collaboration.storage?.limitBytes)} limit</span>
                    </div>
                    <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-300 ${
                                storagePercent > 90 ? 'bg-red-500' :
                                storagePercent > 70 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(storagePercent, 100)}%` }}
                        />
                    </div>
                </div>

                {/* Danger Zone */}
                <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                    <h3 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                        <Icon path={ICONS.xMark} className="w-5 h-5" />
                        Danger Zone
                    </h3>
                    <div className="space-y-3">
                        {userRole && !isOwner && (
                            <button
                                onClick={handleLeave}
                                className="w-full py-2.5 px-4 bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
                            >
                                Leave Collaboration
                            </button>
                        )}
                        {hasOwnerPermissions && (
                            <button
                                onClick={handleDelete}
                                className="w-full py-2.5 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium"
                            >
                                Delete Collaboration
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Right Column - Version Management */}
            {hasOwnerPermissions && (
                <div className="space-y-6">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                            <Icon path={ICONS.clock} className="w-5 h-5 text-purple-500" />
                            Version History
                        </h3>

                        {files.length > 0 ? (
                            <div className="space-y-4">
                                {files.map(file => (
                                    <div key={file.id} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="font-medium text-gray-800 text-sm">{file.name}</span>
                                            <button
                                                onClick={() => setShowVersionsModal(file.id)}
                                                className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                                            >
                                                View Versions
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span>{file.versionCount || 1} version{(file.versionCount || 1) !== 1 ? 's' : ''}</span>
                                            <span>{formatBytes(file.size)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 text-center py-4">
                                No files to manage yet.
                            </p>
                        )}
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                            <Icon path={ICONS.trash} className="w-5 h-5 text-purple-500" />
                            Auto-Cleanup
                        </h3>
                        <p className="text-sm text-gray-600 mb-3">
                            Old versions are automatically deleted when storage limit is reached.
                        </p>
                        <div className="bg-gray-50 rounded-lg p-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600">Keep versions per user</span>
                                <span className="font-medium text-gray-800">2</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderTabContent = () => {
        switch (activeTab) {
            case 'Project':
                return renderProjectTab();
            case 'Members':
                return (
                    <div className="max-w-3xl mx-auto">
                        <CollaborationMemberList
                            members={members}
                            currentUserId={user?.uid}
                            isOwner={hasOwnerPermissions}
                            collaborationId={collaborationId}
                            setModalMessage={setModalMessage}
                            setConfirmation={setConfirmation}
                        />
                    </div>
                );
            case 'Settings':
                return renderSettingsTab();
            default:
                return null;
        }
    };

    return (
        <div className="container mx-auto p-4 sm:p-8 max-w-6xl">
            {/* Back Button */}
            <button
                onClick={() => navigate('/communitys')}
                className="flex items-center text-gray-600 hover:text-gray-800 mb-6 transition-colors"
            >
                <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2" />
                Back to Community Hub
            </button>

            {/* Header Banner with Build Status */}
            <div className={`rounded-2xl p-6 mb-6 transition-colors duration-300 ${
                isBuilding ? 'bg-red-500' : 'bg-green-500'
            }`}>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div className="text-white">
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-2xl sm:text-3xl font-bold">{collaboration.title}</h1>
                            <span className="px-3 py-1 text-xs font-bold rounded-full bg-white/20">
                                {getGame(collaboration.game)?.shortName || collaboration.game}
                            </span>
                        </div>

                        {/* Build Status */}
                        <div className="flex items-center gap-2 mb-3">
                            <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
                            <span className="font-medium">
                                {isBuilding
                                    ? `${builderUsername} is currently building...`
                                    : 'Available - Ready to edit'}
                            </span>
                        </div>

                        {collaboration.description && (
                            <p className="text-white/80 text-sm mb-3">{collaboration.description}</p>
                        )}

                        <div className="flex items-center gap-4 text-sm text-white/70">
                            <span className="flex items-center gap-1">
                                <Icon path={ICONS.users} className="w-4 h-4" />
                                {members.length} members
                            </span>
                            <span className="flex items-center gap-1">
                                <Icon path={ICONS.database} className="w-4 h-4" />
                                {files.length} files
                            </span>
                            <span className="flex items-center gap-1">
                                <Icon path={ICONS.check} className="w-4 h-4" />
                                {pendingTodos.length} tasks
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowInviteModal(true)}
                        className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 text-white"
                    >
                        <Icon path={ICONS.userPlus} className="w-5 h-5" />
                        Invite
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex justify-center mb-8">
                <div className="relative flex items-center bg-gray-100 rounded-full p-1">
                    <div
                        ref={gliderRef}
                        className="absolute h-full bg-white rounded-full shadow-sm transition-all duration-300 ease-in-out"
                    />
                    {TABS.map((tab, index) => (
                        <button
                            key={tab}
                            ref={el => tabRefs.current[index] = el}
                            onClick={() => setActiveTab(tab)}
                            className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 text-sm font-medium ${
                                activeTab === tab ? 'text-gray-800' : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div>
                {renderTabContent()}
            </div>

            {/* Modals */}
            {showInviteModal && (
                <InviteMemberModal
                    inviteCode={collaboration.inviteCode}
                    onClose={() => setShowInviteModal(false)}
                    setModalMessage={setModalMessage}
                />
            )}

            {showCheckOutModal && (
                <CheckOutModal
                    file={files.find(f => f.id === showCheckOutModal)}
                    onConfirm={(note, expectedMinutes) => handleCheckOut(showCheckOutModal, note, expectedMinutes)}
                    onCancel={() => setShowCheckOutModal(null)}
                />
            )}

            {showVersionsModal && (
                <FileVersionsModal
                    collaborationId={collaborationId}
                    fileId={showVersionsModal}
                    file={files.find(f => f.id === showVersionsModal)}
                    currentUserId={user?.uid}
                    isElectron={isRunningInElectron}
                    onClose={() => setShowVersionsModal(null)}
                    setModalMessage={setModalMessage}
                    setConfirmation={setConfirmation}
                />
            )}
        </div>
    );
};

export default CollaborationDetailPage;
