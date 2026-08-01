import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
    addTodo,
    completeCollaboration,
    confirmCollaborationPublishConsent,
    deleteCollaboration,
    deleteTodo,
    endBuildSession,
    fetchPublicCollaborationView,
    getCollaborationVersionDownloadUrl,
    leaveCollaboration,
    publishCollaboration,
    regenerateInviteCode,
    toggleTodo,
    startBuildSession,
    updateCollaborationChangelogEntry,
    voteRevokeCollaborationPublish,
} from '../../firebase/collaboration';
import {
    endRememberedCollaborationBuild,
    rememberActiveCollaborationBuild,
} from '../../utils/collaborationBuildSession';
import {
    clearCollaborationBuildDraft,
    ensureCollaborationBuildDraft,
    readCollaborationBuildDraft,
    setCollaborationBuildDraftTodo,
    updateCollaborationBuildDraft,
} from '../../utils/collaborationBuildDraft';
import { buildCollaborationGalleryItems } from '../../utils/collaborationChangelog';
import { recordInstalledCollaborationVersion } from '../../utils/collaborationVersionUpdates';
import {
    dispatchCollaborationAvailableById,
    subscribeCollaborationAvailable,
} from '../../utils/collaborationAvailability';
import { getGameColor, ICONS, isSafeHttpUrl } from '../../utils/helpers';
import { getGame } from '../../utils/gamesRegistry';
import CollaborationMemberList from '../collaboration/CollaborationMemberList';
import CollaborationChangelogModal from '../modals/CollaborationChangelogModal';
import FileVersionsModal from '../modals/FileVersionsModal';
import InviteMemberModal from '../modals/InviteMemberModal';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';

const BUILD_TAB = { id: 'Build', icon: ICONS.checklist };
const BASE_TABS = [
    { id: 'Project', icon: ICONS.database },
    { id: 'Changelog', icon: ICONS.edit },
    { id: 'Members', icon: ICONS.users },
    { id: 'Settings', icon: ICONS.cog },
];

const toMillis = (timestamp) => {
    if (typeof timestamp?.toMillis === 'function') return timestamp.toMillis();
    if (Number.isFinite(timestamp)) return timestamp;
    const value = timestamp ? new Date(timestamp).getTime() : 0;
    return Number.isFinite(value) ? value : 0;
};

const formatTime = (timestamp) => {
    const milliseconds = toMillis(timestamp);
    if (!milliseconds) return '';
    const diff = Math.max(0, Date.now() - milliseconds);
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(milliseconds).toLocaleDateString();
};

const formatDuration = (minutes) => {
    if (!minutes) return '< 1 min';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
};

const formatBytes = (bytes) => {
    if (!bytes) return '0 MB';
    const megabytes = bytes / (1024 * 1024);
    return megabytes < 1
        ? `${(megabytes * 1024).toFixed(0)} KB`
        : `${megabytes.toFixed(1)} MB`;
};

const CollaborationDetailPage = ({
    user,
    userProfile,
    setModalMessage,
    setConfirmation,
}) => {
    const { collaborationId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const isRunningInElectron = Boolean(window.electronAPI?.isElectron);
    const isGameOverlay = Boolean(window.electronAPI?.isGameOverlay);

    const [collaboration, setCollaboration] = useState(null);
    const [publicReadOnly, setPublicReadOnly] = useState(false);
    const [members, setMembers] = useState([]);
    const [files, setFiles] = useState([]);
    const [versions, setVersions] = useState([]);
    const [uploads, setUploads] = useState([]);
    const [todos, setTodos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('Project');
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [showVersionsModal, setShowVersionsModal] = useState(false);
    const [newTodo, setNewTodo] = useState('');
    const [buildDraft, setBuildDraft] = useState(null);
    const [changelogModalOpen, setChangelogModalOpen] = useState(false);
    const [changelogEntryToEdit, setChangelogEntryToEdit] = useState(null);
    const [downloadingVersionId, setDownloadingVersionId] = useState(null);
    const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
    const [activeSettingsSection, setActiveSettingsSection] = useState('project');
    const [settingsMobileOpen, setSettingsMobileOpen] = useState(false);
    const [publishingBusy, setPublishingBusy] = useState('');
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const galleryRef = useRef(null);
    const recoveredDraftSyncRef = useRef('');

    const game = getGame(collaboration?.game);
    const gameColor = getGameColor(collaboration?.game || 'default');
    const currentMember = members.find((member) => member.id === user?.uid);
    const loadedCollaborationId = collaboration?.id || null;
    const ownerMember = members.find((member) => member.id === collaboration?.ownerId);
    const userRole = currentMember?.role || null;
    const isOwner = userRole === 'owner';
    const isSiteMod = ['moderator', 'admin'].includes(userProfile?.role);
    const hasOwnerPermissions = isOwner || isSiteMod;
    const collaborationActive = collaboration?.status === 'active';
    const canEdit = userRole && userRole !== 'viewer' && collaborationActive;
    const canDownloadVersions = Boolean(currentMember);
    const buildLock = collaboration?.buildLock;
    const lockActive = Boolean(
        buildLock?.activeBuilderId &&
        toMillis(buildLock.expiresAt) > Date.now(),
    );
    const iAmBuilder = lockActive && buildLock.activeBuilderId === user?.uid;
    const buildWorkspaceActive = iAmBuilder && isRunningInElectron;
    const visibleTabs = useMemo(
        () => {
            if (publicReadOnly) {
                return BASE_TABS.filter((tab) => tab.id !== 'Settings');
            }
            return buildWorkspaceActive
                ? [BUILD_TAB, ...BASE_TABS]
                : BASE_TABS;
        },
        [buildWorkspaceActive, publicReadOnly],
    );
    const pendingTodos = todos.filter((todo) => !todo.completed);
    const completedTodos = todos.filter((todo) => todo.completed);
    const buildCompletedTodoIds = new Set(
        (buildDraft?.completedTodos || []).map((todo) => todo.id),
    );
    const buildTodos = todos.filter((todo) => (
        !todo.completed || buildCompletedTodoIds.has(todo.id)
    ));
    const currentFile = files.find((file) => file.id === 'save') || files[0] || null;
    const currentVersion = collaboration?.currentVersion || currentFile?.currentVersion || null;
    const retentionLimit = members.length > 10 ? 2 : 3;
    const retainedVersionIds = new Set(versions.map((version) => version.id));
    const safeBannerImageUrl = isSafeHttpUrl(collaboration?.bannerImageUrl)
        ? collaboration.bannerImageUrl.trim()
        : '';
    const startingGalleryImageUrls = (collaboration?.galleryImageUrls || [])
        .filter(isSafeHttpUrl)
        .slice(0, 10);
    const galleryItems = buildCollaborationGalleryItems(uploads, {
        imageUrls: startingGalleryImageUrls,
        username: ownerMember?.username || 'Collaboration owner',
        text: `${collaboration?.title || 'Collaboration'} starting gallery`,
        createdAt: collaboration?.createdAt,
    });
    const activeGalleryItem = galleryItems[activeGalleryIndex] || null;
    const myPendingChangelog = uploads.find((entry) => (
        entry.userId === user?.uid &&
        entry.hasSave !== true &&
        !entry.versionId
    )) || null;
    const publishInfo = collaboration?.publish || {};
    const activeMemberIds = new Set(members.map((member) => member.id));
    const revokeVoterIds = (publishInfo.revokeVoterIds || [])
        .filter((memberId) => activeMemberIds.has(memberId));
    const hasVotedToRevoke = revokeVoterIds.includes(user?.uid);
    const consentedMemberCount = members.filter(
        (member) => member.publishConsent?.agreed === true,
    ).length;
    const allMembersConsented = members.length > 0 &&
        consentedMemberCount === members.length;

    const formatTimeLeft = (timestamp) => {
        const minutes = Math.max(0, Math.ceil((toMillis(timestamp) - Date.now()) / 60000));
        if (minutes < 60) return `~${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return `~${hours}h${remainder ? ` ${remainder}m` : ''}`;
    };

    const loadMembers = useCallback(async () => {
        const snapshot = await getDocs(collection(db, 'collaborations', collaborationId, 'members'));
        setMembers(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() })));
    }, [collaborationId]);

    const loadProjectData = useCallback(async () => {
        const [fileSnapshot, versionSnapshot, uploadSnapshot, todoSnapshot] = await Promise.all([
            getDocs(collection(db, 'collaborations', collaborationId, 'files')),
            getDocs(query(
                collection(db, 'collaborations', collaborationId, 'files', 'save', 'versions'),
                orderBy('versionNumber', 'desc'),
            )),
            getDocs(query(
                collection(db, 'collaborations', collaborationId, 'uploads'),
                orderBy('createdAt', 'desc'),
            )),
            getDocs(query(
                collection(db, 'collaborations', collaborationId, 'todos'),
                orderBy('createdAt', 'asc'),
            )),
        ]);
        setFiles(fileSnapshot.docs
            .map((fileDoc) => ({ id: fileDoc.id, ...fileDoc.data() }))
            .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)));
        setVersions(versionSnapshot.docs.map((versionDoc) => ({
            id: versionDoc.id,
            ...versionDoc.data(),
        })));
        setUploads(uploadSnapshot.docs.map((uploadDoc) => ({ id: uploadDoc.id, ...uploadDoc.data() })));
        setTodos(todoSnapshot.docs.map((todoDoc) => ({ id: todoDoc.id, ...todoDoc.data() })));
    }, [collaborationId]);

    useEffect(() => {
        if (!collaborationId) return undefined;
        let mounted = true;
        setLoading(true);
        setCollaboration(null);
        setPublicReadOnly(false);
        setMembers([]);
        setFiles([]);
        setVersions([]);
        setUploads([]);
        setTodos([]);
        const unsubscribe = onSnapshot(
            doc(db, 'collaborations', collaborationId),
            (snapshot) => {
                if (!mounted) return;
                if (!snapshot.exists()) {
                    setModalMessage('Collaboration not found.');
                    navigate('/communitys');
                    return;
                }
                setPublicReadOnly(false);
                setCollaboration({ id: snapshot.id, ...snapshot.data() });
                setLoading(false);
            },
            async () => {
                try {
                    const publicView = await fetchPublicCollaborationView(collaborationId);
                    if (!mounted) return;
                    setCollaboration(publicView.collaboration);
                    setMembers(publicView.members || []);
                    setFiles([]);
                    setVersions(publicView.versions || []);
                    setUploads(publicView.uploads || []);
                    setTodos(publicView.todos || []);
                    setPublicReadOnly(true);
                    setLoading(false);
                } catch (error) {
                    if (!mounted) return;
                    setLoading(false);
                    setModalMessage(`Could not load collaboration: ${error.message}`);
                    navigate('/communitys');
                }
            },
        );
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [collaborationId, navigate, setModalMessage]);

    useEffect(() => {
        if (!collaborationId || !user ||
            loadedCollaborationId !== collaborationId ||
            publicReadOnly) {
            return undefined;
        }
        let mounted = true;
        Promise.all([loadMembers(), loadProjectData()])
            .catch((error) => {
                if (mounted) setModalMessage(`Could not load project details: ${error.message}`);
            });
        return () => { mounted = false; };
    }, [
        collaborationId,
        loadedCollaborationId,
        loadMembers,
        loadProjectData,
        publicReadOnly,
        setModalMessage,
        user,
    ]);

    useEffect(() => subscribeCollaborationAvailable(
        collaborationId,
        () => {
            Promise.all([loadMembers(), loadProjectData()])
                .catch((error) => console.warn(
                    'Could not refresh the released collaboration in the background:',
                    error.message,
                ));
        },
    ), [collaborationId, loadMembers, loadProjectData]);

    useEffect(() => {
        const activeIndex = visibleTabs.findIndex((tab) => tab.id === activeTab);
        const element = tabRefs.current[activeIndex];
        if (element && gliderRef.current) {
            gliderRef.current.style.width = `${element.offsetWidth}px`;
            gliderRef.current.style.left = `${element.offsetLeft}px`;
        }
    }, [activeTab, visibleTabs]);

    useEffect(() => {
        if (!location.state?.openChangelog || !collaboration || !canEdit) return;
        if (isRunningInElectron) {
            setChangelogEntryToEdit({
                id: location.state.changelogEntryId || null,
                userId: location.state.changelogUserId || user?.uid,
                username: location.state.username || userProfile?.username || 'You',
                createdAt: location.state.createdAtMillis || Date.now(),
                changelog: location.state.changelog || '',
                imageUrls: [],
                completedTodos: location.state.completedTodos || [],
                hasSave: false,
                versionId: null,
            });
            setChangelogModalOpen(true);
        }
        navigate(location.pathname, { replace: true, state: null });
    }, [
        canEdit,
        collaboration,
        isRunningInElectron,
        location.pathname,
        location.state,
        navigate,
        user?.uid,
        userProfile?.username,
    ]);

    useEffect(() => {
        if (!collaborationId || !user?.uid) {
            setBuildDraft(null);
            return;
        }
        setBuildDraft(readCollaborationBuildDraft(
            collaborationId,
            user.uid,
        ));
    }, [collaborationId, user?.uid]);

    useEffect(() => {
        if (!buildWorkspaceActive || !collaboration || !user?.uid) return;
        const activeDraft = ensureCollaborationBuildDraft({
            collaborationId,
            gameId: collaboration.game,
            userId: user.uid,
            buildSessionId: buildLock?.sessionId || null,
        });
        setBuildDraft(activeDraft);
    }, [
        buildLock?.sessionId,
        collaboration,
        collaborationId,
        buildWorkspaceActive,
        user?.uid,
    ]);

    useEffect(() => {
        if (location.state?.openBuildWorkspace && buildWorkspaceActive) {
            setActiveTab('Build');
            navigate(location.pathname, {replace: true, state: null});
        }
    }, [
        buildWorkspaceActive,
        location.pathname,
        location.state?.openBuildWorkspace,
        navigate,
    ]);

    useEffect(() => {
        if (!visibleTabs.some((tab) => tab.id === activeTab)) {
            setActiveTab('Project');
        }
    }, [activeTab, visibleTabs]);

    useEffect(() => {
        if (buildWorkspaceActive ||
            !myPendingChangelog ||
            !buildDraft ||
            !user?.uid) {
            return;
        }
        const sameSession = !myPendingChangelog.buildSessionId ||
            !buildDraft.buildSessionId ||
            myPendingChangelog.buildSessionId === buildDraft.buildSessionId;
        if (!sameSession) return;

        const todoMap = new Map();
        [
            ...(myPendingChangelog.completedTodos || []),
            ...(buildDraft.completedTodos || []),
        ].forEach((todo) => {
            if (todo?.id && todo?.text) todoMap.set(todo.id, todo);
        });
        const completedTodosForRecovery = [...todoMap.values()];
        const changelogForRecovery =
            myPendingChangelog.changelog || buildDraft.changelog || '';
        const needsRecovery =
            changelogForRecovery !== (myPendingChangelog.changelog || '') ||
            completedTodosForRecovery.length !==
                (myPendingChangelog.completedTodos || []).length;
        const recoveryKey =
            `${myPendingChangelog.id}:${buildDraft.updatedAtMillis}`;
        if (recoveredDraftSyncRef.current === recoveryKey) return;

        if (!needsRecovery) {
            clearCollaborationBuildDraft(collaborationId, user.uid);
            setBuildDraft(null);
            return;
        }
        recoveredDraftSyncRef.current = recoveryKey;
        updateCollaborationChangelogEntry(
            collaborationId,
            myPendingChangelog.id,
            changelogForRecovery,
            myPendingChangelog.imageUrls || [],
            completedTodosForRecovery,
        ).then(() => {
            clearCollaborationBuildDraft(collaborationId, user.uid);
            setBuildDraft(null);
            return loadProjectData();
        }).catch((error) => {
            recoveredDraftSyncRef.current = '';
            console.warn('Could not recover the local build draft:', error.message);
        });
    }, [
        buildDraft,
        collaborationId,
        buildWorkspaceActive,
        loadProjectData,
        myPendingChangelog,
        user?.uid,
    ]);

    useEffect(() => {
        if (activeGalleryIndex >= galleryItems.length) setActiveGalleryIndex(0);
    }, [activeGalleryIndex, galleryItems.length]);

    const handleStartBuild = async (acknowledgeMissingSave = false) => {
        try {
            if (!isGameOverlay || !window.electronAPI?.getActiveGame) {
                throw new Error('Start building from the in-game overlay while the matching game is open.');
            }
            const activeGameId = await window.electronAPI.getActiveGame();
            if (!activeGameId || activeGameId !== collaboration.game) {
                throw new Error("Open this collaboration's game before starting a build session.");
            }
            const result = await startBuildSession(
                collaborationId,
                60,
                acknowledgeMissingSave,
            );
            if (result.requiresMissingSaveConfirmation) {
                const missingUsername =
                    result.missingSave?.username || 'The previous builder';
                setConfirmation({
                    message: `${missingUsername} has not provided the newest save yet. If you continue, you will build from an older version.`,
                    onConfirm: () => handleStartBuild(true),
                });
                return;
            }
            rememberActiveCollaborationBuild({
                collaborationId,
                gameId: collaboration.game,
                userId: user.uid,
                buildSessionId: result.buildSessionId || null,
            });
            setBuildDraft(ensureCollaborationBuildDraft({
                collaborationId,
                gameId: collaboration.game,
                userId: user.uid,
                buildSessionId: result.buildSessionId || null,
            }));
            setActiveTab('Build');
            setModalMessage("You're logged on to build. Other members can see that the save is in use.");
        } catch (error) {
            setModalMessage(error.message);
        }
    };

    const handleStopBuild = async (force = false) => {
        try {
            if (!force && iAmBuilder) {
                rememberActiveCollaborationBuild({
                    collaborationId,
                    gameId: collaboration.game,
                    userId: user.uid,
                    buildSessionId: buildLock?.sessionId || null,
                });
                const result = await endRememberedCollaborationBuild({
                    userId: user.uid,
                    gameId: collaboration.game,
                    endSession: (
                        id,
                        endedAtMillis,
                        buildDraft,
                        buildSessionId,
                    ) => endBuildSession(
                        id,
                        false,
                        endedAtMillis,
                        buildDraft,
                        buildSessionId,
                    ),
                });
                setChangelogEntryToEdit({
                    id: result.changelogEntryId || null,
                    userId: result.changelogUserId || user.uid,
                    username: result.username || userProfile?.username || 'You',
                    createdAt: result.createdAtMillis || Date.now(),
                    changelog: result.changelog ||
                        result.buildDraft?.changelog ||
                        '',
                    imageUrls: [],
                    completedTodos: result.completedTodos ||
                        result.buildDraft?.completedTodos ||
                        [],
                    hasSave: false,
                    versionId: null,
                });
                loadProjectData().catch((error) => {
                    console.warn('Could not refresh the pending changelog:', error.message);
                });
            } else {
                await endBuildSession(collaborationId, force);
                loadProjectData().catch((error) => {
                    console.warn('Could not refresh the forced build hand-off:', error.message);
                });
            }
            if (force) {
                setModalMessage('Build lock released.');
            } else {
                setChangelogModalOpen(true);
            }
            dispatchCollaborationAvailableById(collaborationId);
        } catch (error) {
            setModalMessage(!force && iAmBuilder
                ? `Log-off will be retried when online: ${error.message}`
                : error.message);
        }
    };

    const handleLeave = () => {
        setConfirmation({
            message: 'Are you sure you want to leave this collaboration?',
            onConfirm: async () => {
                try {
                    await leaveCollaboration(collaborationId);
                    setModalMessage('You have left the collaboration.');
                    navigate('/communitys');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            },
        });
    };

    const handleDelete = () => {
        setConfirmation({
            message: 'Delete this collaboration and its project history? This cannot be undone.',
            onConfirm: async () => {
                try {
                    await deleteCollaboration(collaborationId);
                    setModalMessage('Collaboration deleted.');
                    navigate('/communitys');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            },
        });
    };

    const handleConfirmPublishConsent = async () => {
        setPublishingBusy('consent');
        try {
            await confirmCollaborationPublishConsent(collaborationId);
            await loadMembers();
            setModalMessage('Your publication consent is recorded.');
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setPublishingBusy('');
        }
    };

    const handleCompleteCollaboration = () => {
        setConfirmation({
            message: 'Mark this collaboration as complete? Building, tasks, comments and changelogs will be frozen.',
            onConfirm: async () => {
                setPublishingBusy('complete');
                try {
                    await completeCollaboration(collaborationId);
                    setModalMessage('Collaboration completed. It is ready to publish.');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                } finally {
                    setPublishingBusy('');
                }
            },
        });
    };

    const handlePublishCollaboration = () => {
        setConfirmation({
            message: 'Publish the final signed version as a public Creation with permanent contributor credits?',
            onConfirm: async () => {
                setPublishingBusy('publish');
                try {
                    const result = await publishCollaboration(collaborationId);
                    setModalMessage('Collaboration published as a Creation.');
                    if (result.creationId) navigate(`/creation/${result.creationId}`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                } finally {
                    setPublishingBusy('');
                }
            },
        });
    };

    const handleVoteRevokePublish = () => {
        setConfirmation({
            message: 'Vote to remove the published Creation? It is removed only after every current member has voted.',
            onConfirm: async () => {
                setPublishingBusy('revoke');
                try {
                    const result = await voteRevokeCollaborationPublish(
                        collaborationId,
                    );
                    setModalMessage(result.revoked
                        ? 'The unanimous vote is complete. The published Creation was removed.'
                        : `Your vote was recorded (${result.voteCount}/${result.requiredCount}).`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                } finally {
                    setPublishingBusy('');
                }
            },
        });
    };

    const handleRegenerateInvite = () => {
        setConfirmation({
            message: 'Generate a new invite code? Existing join links will stop working.',
            onConfirm: async () => {
                try {
                    const newCode = await regenerateInviteCode(collaborationId);
                    setModalMessage(`New invite code: ${newCode}`);
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            },
        });
    };

    const handleAddTodo = async (event) => {
        event.preventDefault();
        const text = newTodo.trim();
        if (!text) return;
        try {
            await addTodo(collaborationId, user.uid, text);
            setNewTodo('');
            await loadProjectData();
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleToggleTodo = async (todo) => {
        const nextCompleted = !todo.completed;
        const previousDraft = buildDraft;
        setTodos((current) => current.map((item) => (
            item.id === todo.id ? { ...item, completed: nextCompleted } : item
        )));
        if (buildWorkspaceActive) {
            setBuildDraft(setCollaborationBuildDraftTodo(
                collaborationId,
                user.uid,
                todo,
                nextCompleted,
            ));
        }
        try {
            await toggleTodo(
                collaborationId,
                todo.id,
                user.uid,
                nextCompleted,
            );
        } catch (error) {
            setTodos((current) => current.map((item) => (
                item.id === todo.id ? { ...item, completed: todo.completed } : item
            )));
            if (buildWorkspaceActive && previousDraft) {
                setBuildDraft(updateCollaborationBuildDraft(
                    collaborationId,
                    user.uid,
                    {completedTodos: previousDraft.completedTodos},
                ));
            }
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleBuildChangelogChange = (event) => {
        const changelog = event.target.value.slice(0, 1000);
        setBuildDraft(updateCollaborationBuildDraft(
            collaborationId,
            user.uid,
            {changelog},
        ));
    };

    const handleDeleteTodo = async (todoId) => {
        const previous = todos;
        setTodos((current) => current.filter((todo) => todo.id !== todoId));
        try {
            await deleteTodo(collaborationId, todoId);
        } catch (error) {
            setTodos(previous);
            setModalMessage(`Error: ${error.message}`);
        }
    };

    const handleDownloadChangelogVersion = async (entry) => {
        if (!canDownloadVersions) {
            setModalMessage('Only collaboration members can download save versions.');
            return;
        }
        if (!entry?.versionId || !retainedVersionIds.has(entry.versionId)) return;
        if (!isRunningInElectron || !window.electronAPI?.saveCollaborationVersion) {
            setModalMessage('Version downloads require the desktop client.');
            return;
        }

        setDownloadingVersionId(entry.versionId);
        try {
            const download = await getCollaborationVersionDownloadUrl(
                collaborationId,
                entry.versionId,
            );
            const result = await window.electronAPI.saveCollaborationVersion({
                downloadUrl: download.downloadUrl,
                gameId: collaboration.game,
            });
            if (result?.status === 'canceled') return;
            if (!result?.success) {
                throw new Error(result?.message || 'The version could not be saved.');
            }
            if (entry.versionId === currentVersion?.versionId) {
                recordInstalledCollaborationVersion({
                    userId: user.uid,
                    collaborationId,
                    gameId: collaboration.game,
                    versionId: entry.versionId,
                    versionNumber: entry.versionNumber,
                    targetPath: result.targetPath,
                });
            }
            setModalMessage(`Version ${entry.versionNumber} saved to ${result.targetPath}.`);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setDownloadingVersionId(null);
        }
    };

    const openGalleryImage = (index) => {
        setActiveGalleryIndex(Math.max(0, index));
        setActiveTab('Project');
        window.setTimeout(() => {
            galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
    };

    const openChangelogEditor = (entry) => {
        if (!isRunningInElectron) {
            setModalMessage('Changelogs can only be edited in the desktop client.');
            return;
        }
        if (!entry || entry.userId !== user?.uid) {
            setModalMessage('Only the original builder can edit this changelog.');
            return;
        }
        const recoveredDraft = readCollaborationBuildDraft(
            collaborationId,
            user.uid,
        );
        const sameSession = recoveredDraft && (
            !entry.buildSessionId ||
            !recoveredDraft.buildSessionId ||
            entry.buildSessionId === recoveredDraft.buildSessionId
        );
        const todoMap = new Map();
        [
            ...(entry.completedTodos || []),
            ...(sameSession ? recoveredDraft.completedTodos : []),
        ].forEach((todo) => {
            if (todo?.id && todo?.text) todoMap.set(todo.id, todo);
        });
        setChangelogEntryToEdit({
            ...entry,
            changelog: entry.changelog ||
                (sameSession ? recoveredDraft.changelog : '') ||
                '',
            completedTodos: [...todoMap.values()],
        });
        setChangelogModalOpen(true);
    };

    const copyInviteCode = async () => {
        try {
            await navigator.clipboard.writeText(collaboration.inviteCode);
            setModalMessage('Invite code copied.');
        } catch (error) {
            setModalMessage(`Could not copy invite code: ${error.message}`);
        }
    };

    const buildStatus = !lockActive
        ? {
            title: 'Free to build',
            detail: 'No active builder. Start your turn from the in-game overlay.',
            dot: 'bg-emerald-500',
            surface: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30',
            icon: ICONS.checkCircle,
            iconClass: 'bg-emerald-600',
        }
        : {
            title: iAmBuilder ? 'You are building' : `${buildLock.username || 'Someone'} is building`,
            detail: `The save is reserved${buildLock.expiresAt ? ` · fallback expiry in ${formatTimeLeft(buildLock.expiresAt)}` : ''}.`,
            dot: iAmBuilder ? 'bg-blue-500' : 'bg-red-500',
            surface: iAmBuilder
                ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30'
                : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
            icon: ICONS.lockClosed,
            iconClass: iAmBuilder ? 'bg-blue-600' : 'bg-red-600',
        };

    if (loading) {
        return <div className="flex min-h-[420px] items-center justify-center"><Spinner /></div>;
    }
    if (!collaboration) return null;

    const renderBuildActions = () => (
        <div className="flex flex-wrap items-center justify-center gap-2">
            {!lockActive && canEdit && isGameOverlay && (
                <button
                    type="button"
                    onClick={handleStartBuild}
                    className="rounded-xl bg-emerald-600 px-4 py-2.5 font-bold text-white transition hover:bg-emerald-700"
                >
                    Start building
                </button>
            )}
            {!lockActive && canEdit && !isGameOverlay && (
                <span className="max-w-sm text-sm text-gray-600 dark:text-gray-300">
                    Open the matching game and use its overlay to start your turn.
                </span>
            )}
            {iAmBuilder && (
                <button
                    type="button"
                    onClick={() => handleStopBuild(false)}
                    className="rounded-xl bg-gray-800 px-4 py-2.5 font-bold text-white transition hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                >
                    Log off
                </button>
            )}
            {lockActive && !iAmBuilder && hasOwnerPermissions && (
                <button
                    type="button"
                    onClick={() => handleStopBuild(true)}
                    className="rounded-xl border border-red-300 bg-white px-4 py-2.5 font-bold text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                    Force release
                </button>
            )}
        </div>
    );

    const renderTasks = () => (
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-200 px-5 py-4 text-center dark:border-gray-700">
                <div className="mx-auto">
                    <h2 className="flex items-center justify-center gap-2 font-bold text-gray-900 dark:text-gray-100">
                        <Icon path={ICONS.checklist} className="game-text h-5 w-5" />
                        Project tasks
                    </h2>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{pendingTodos.length} remaining</p>
                </div>
            </div>
            <div className="p-4">
                {canEdit && (
                    <form onSubmit={handleAddTodo} className="mb-4 flex gap-2">
                        <input
                            value={newTodo}
                            onChange={(event) => setNewTodo(event.target.value)}
                            maxLength={160}
                            placeholder="Add a task"
                            className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                            style={{ '--tw-ring-color': gameColor.hex }}
                        />
                        <button
                            type="submit"
                            disabled={!newTodo.trim()}
                            className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                            style={newTodo.trim() ? { backgroundColor: gameColor.hex } : undefined}
                            aria-label="Add task"
                        >
                            <Icon path={ICONS.plus} className="h-5 w-5" />
                        </button>
                    </form>
                )}

                <div className="space-y-1">
                    {pendingTodos.map((todo) => (
                        <div key={todo.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <button
                                type="button"
                                onClick={() => handleToggleTodo(todo)}
                                disabled={!canEdit}
                                className="h-5 w-5 flex-none rounded-md border-2 border-gray-300 transition hover:border-[--game-color] dark:border-gray-600"
                                style={gameColor.style}
                                aria-label={`Complete ${todo.text}`}
                            />
                            <span className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-200">{todo.text}</span>
                            {(hasOwnerPermissions || todo.createdBy === user.uid) && (
                                <button
                                    type="button"
                                    onClick={() => handleDeleteTodo(todo.id)}
                                    className="rounded-lg p-1 text-gray-400 opacity-100 transition hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-red-950/30"
                                    aria-label={`Delete ${todo.text}`}
                                >
                                    <Icon path={ICONS.xMark} className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {completedTodos.length > 0 && (
                    <details className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
                        <summary className="cursor-pointer text-xs font-semibold text-gray-500 dark:text-gray-400">
                            Completed ({completedTodos.length})
                        </summary>
                        <div className="mt-2 space-y-1">
                            {completedTodos.map((todo) => (
                                <button
                                    type="button"
                                    key={todo.id}
                                    onClick={() => handleToggleTodo(todo)}
                                    disabled={!canEdit}
                                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-gray-50 disabled:cursor-default dark:hover:bg-gray-700/50"
                                >
                                    <span className="flex h-5 w-5 items-center justify-center rounded-md text-white" style={{ backgroundColor: gameColor.hex }}>
                                        <Icon path={ICONS.check} className="h-3 w-3" />
                                    </span>
                                    <span className="text-sm text-gray-400 line-through">{todo.text}</span>
                                </button>
                            ))}
                        </div>
                    </details>
                )}

                {todos.length === 0 && (
                    <p className="py-5 text-center text-sm text-gray-400">No tasks yet.</p>
                )}
            </div>
        </section>
    );

    const renderGallery = () => (
        <section ref={galleryRef} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="relative border-b border-gray-200 px-5 py-4 text-center dark:border-gray-700">
                <div className="mx-auto max-w-2xl">
                    <h2 className="flex items-center justify-center gap-2 font-bold text-gray-900 dark:text-gray-100">
                        <Icon path={ICONS.image} className="game-text h-5 w-5" />
                        Gallery
                    </h2>
                    <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        Changelog images appear newest first, followed by the owner's starting gallery.
                    </p>
                </div>
                {galleryItems.length > 0 && (
                    <span className="mt-3 inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {galleryItems.length} {galleryItems.length === 1 ? 'image' : 'images'}
                    </span>
                )}
            </div>

            {activeGalleryItem ? (
                <>
                    <div className="group relative flex aspect-video items-center justify-center bg-black">
                        <img
                            src={activeGalleryItem.url}
                            alt={activeGalleryItem.text || 'Collaboration changelog'}
                            className="max-h-full max-w-full object-contain"
                            onError={(event) => {
                                event.target.onerror = null;
                                event.target.src = 'https://placehold.co/1200x675/111827/ffffff?text=Image+not+available';
                            }}
                        />
                        {galleryItems.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setActiveGalleryIndex((current) => (
                                        (current - 1 + galleryItems.length) % galleryItems.length
                                    ))}
                                    className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-100 transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100"
                                    aria-label="Previous gallery image"
                                >
                                    <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveGalleryIndex((current) => (
                                        (current + 1) % galleryItems.length
                                    ))}
                                    className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-100 transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100"
                                    aria-label="Next gallery image"
                                >
                                    <Icon path={ICONS.chevronRight} className="h-5 w-5" />
                                </button>
                            </>
                        )}
                    </div>
                    <div className="border-t border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <p className="line-clamp-2 text-sm text-gray-700 dark:text-gray-200">{activeGalleryItem.text}</p>
                                <p className="mt-1 text-xs text-gray-400">
                                    {activeGalleryItem.username || 'Unknown contributor'} · {formatTime(activeGalleryItem.createdAt)}
                                </p>
                            </div>
                            {activeGalleryItem.versionId && (
                                !canDownloadVersions ? (
                                    <span className="flex-none text-xs font-semibold text-gray-500 dark:text-gray-400">
                                        Version {activeGalleryItem.versionNumber}
                                    </span>
                                ) : retainedVersionIds.has(activeGalleryItem.versionId) ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowVersionsModal(true)}
                                        className="flex-none rounded-full border px-3 py-1.5 text-xs font-bold"
                                        style={{ borderColor: gameColor.hex, color: gameColor.hex }}
                                    >
                                        Open v{activeGalleryItem.versionNumber}
                                    </button>
                                ) : (
                                    <span className="flex-none text-xs text-gray-400">
                                        v{activeGalleryItem.versionNumber} no longer retained
                                    </span>
                                )
                            )}
                        </div>
                    </div>
                    {galleryItems.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                            {galleryItems.map((item, index) => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => setActiveGalleryIndex(index)}
                                    className="h-16 w-24 flex-none overflow-hidden rounded-lg border-2 bg-black"
                                    style={{ borderColor: index === activeGalleryIndex ? gameColor.hex : 'transparent' }}
                                    aria-label={`Show gallery image ${index + 1}`}
                                >
                                    <img src={item.url} alt="" className="h-full w-full object-cover" />
                                </button>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                <div className="px-6 py-14 text-center">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-700">
                        <Icon path={ICONS.image} className="h-7 w-7 text-gray-400" />
                    </span>
                    <h3 className="mt-4 font-bold text-gray-900 dark:text-gray-100">No gallery images yet</h3>
                    <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
                        The owner can add starting images in project settings. Changelog attachments appear here automatically.
                    </p>
                </div>
            )}
        </section>
    );

    const renderChangelog = () => (
        <div className="space-y-5">
            <section className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="mx-auto max-w-2xl">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Changelog</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Build hand-offs, attached images and the save supplied for each turn.
                    </p>
                </div>
                {canEdit && myPendingChangelog && (
                    <button
                        type="button"
                        onClick={() => openChangelogEditor(myPendingChangelog)}
                        disabled={!isRunningInElectron || collaboration.status !== 'active'}
                        className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-gray-400"
                        style={isRunningInElectron && collaboration.status === 'active'
                            ? { backgroundColor: gameColor.hex }
                            : undefined}
                        title={!isRunningInElectron ? 'Changelogs can only be created in the desktop client' : undefined}
                    >
                        <Icon path={ICONS.share} className="h-5 w-5" />
                        Complete your pending update
                    </button>
                )}
            </section>

            {uploads.length > 0 ? uploads.map((entry) => {
                const versionRetained = entry.versionId && retainedVersionIds.has(entry.versionId);
                const isDownloading = downloadingVersionId === entry.versionId;
                const isEntryAuthor = entry.userId === user?.uid;
                const savePending = entry.hasSave === false || !entry.versionId;
                return (
                    <article
                        key={entry.id}
                        className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
                    >
                        <div className="p-5 sm:p-6">
                            <div className="flex items-start gap-3">
                                <span
                                    className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-white"
                                    style={{ backgroundColor: gameColor.hex }}
                                >
                                    <Icon path={ICONS.edit} className="h-5 w-5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <p className="font-bold text-gray-900 dark:text-gray-100">
                                                {entry.username || 'Unknown contributor'}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {formatTime(entry.createdAt)}
                                                {entry.workDurationMinutes > 0
                                                    ? ` · ${formatDuration(entry.workDurationMinutes)} work time`
                                                    : ''}
                                            </p>
                                        </div>
                                        <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                                            savePending
                                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200'
                                        }`}>
                                            {savePending
                                                ? 'Save pending'
                                                : `Version ${entry.versionNumber}`}
                                        </span>
                                    </div>
                                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-gray-200">
                                        {entry.changelog || (savePending
                                            ? 'No changelog details added yet.'
                                            : 'Uploaded a new save version.')}
                                    </p>
                                    {(entry.completedTodos || []).length > 0 && (
                                        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/25">
                                            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                                Completed during this build
                                            </p>
                                            <ul className="mt-2 space-y-1.5">
                                                {entry.completedTodos.map((todo) => (
                                                    <li
                                                        key={todo.id}
                                                        className="flex items-start gap-2 text-sm text-emerald-900/80 dark:text-emerald-100/80"
                                                    >
                                                        <Icon path={ICONS.checkCircle} className="mt-0.5 h-4 w-4 flex-none" />
                                                        <span>{todo.text}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {(entry.imageUrls || []).length > 0 && (
                                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    {entry.imageUrls.map((url, imageIndex) => {
                                        const galleryIndex = galleryItems.findIndex((item) => (
                                            item.entryId === entry.id && item.url === url
                                        ));
                                        return (
                                            <button
                                                type="button"
                                                key={`${url}-${imageIndex}`}
                                                onClick={() => openGalleryImage(galleryIndex)}
                                                className="group relative aspect-video overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-gray-700"
                                                aria-label={`Open changelog image ${imageIndex + 1} in gallery`}
                                            >
                                                <img
                                                    src={url}
                                                    alt=""
                                                    className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <footer className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-900/40 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                {entry.fileName && <span className="font-semibold">{entry.fileName}</span>}
                                {entry.sizeBytes > 0 && <span>{formatBytes(entry.sizeBytes)}</span>}
                                {entry.versionId && !versionRetained && (
                                    <span>Version {entry.versionNumber} is no longer retained</span>
                                )}
                                {savePending && (
                                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                                        {entry.username || 'This contributor'} has not provided the newest save.
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {!publicReadOnly && isEntryAuthor && (
                                    <button
                                        type="button"
                                        onClick={() => openChangelogEditor(entry)}
                                        disabled={!isRunningInElectron}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 font-bold text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                                    >
                                        <Icon path={ICONS.edit} className="h-4 w-4" />
                                        {savePending ? 'Edit & provide save' : 'Edit changelog'}
                                    </button>
                                )}
                                {canDownloadVersions && versionRetained && (
                                    <button
                                        type="button"
                                        onClick={() => handleDownloadChangelogVersion(entry)}
                                        disabled={isDownloading}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 font-bold text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                                        title={!isRunningInElectron ? 'Version downloads require the desktop client' : undefined}
                                    >
                                        {isDownloading
                                            ? <Spinner size="small" />
                                            : <Icon path={ICONS.download} className="h-4 w-4" />}
                                        Download version {entry.versionNumber}
                                    </button>
                                )}
                            </div>
                        </footer>
                    </article>
                );
            }) : (
                <section className="rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <Icon path={ICONS.edit} className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
                    <h3 className="mt-3 font-bold text-gray-700 dark:text-gray-200">No changelog entries yet</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Finish a build in the desktop client to add the first update.
                    </p>
                </section>
            )}
        </div>
    );

    const renderBuildWorkspace = () => (
        <div className="space-y-6">
            <section className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 shadow-sm dark:border-blue-900 dark:bg-blue-950/25">
                <div className="flex flex-col items-center gap-4 p-5 text-center sm:p-6">
                    <div className="flex min-w-0 flex-col items-center gap-3">
                        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-600 text-white">
                            <Icon path={ICONS.edit} className="h-5 w-5" />
                        </span>
                        <div className="mx-auto max-w-2xl">
                            <p className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                                Active build workspace
                            </p>
                            <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">
                                Notes are saved locally while you build
                            </h2>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                                If the game or client closes unexpectedly, this draft is carried into your pending changelog.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => handleStopBuild(false)}
                        className="inline-flex flex-none items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 font-bold text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                    >
                        <Icon path={ICONS.logout} className="h-4 w-4" />
                        Finish build
                    </button>
                </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
                    <div className="mb-4 text-center">
                        <h2 className="flex items-center justify-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
                            <Icon path={ICONS.checklist} className="game-text h-5 w-5" />
                            Current todos
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Todos completed during this turn are added to its changelog.
                        </p>
                    </div>

                    <form onSubmit={handleAddTodo} className="mb-4 flex gap-2">
                        <input
                            value={newTodo}
                            onChange={(event) => setNewTodo(event.target.value)}
                            maxLength={200}
                            placeholder="Add a todo"
                            className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                            style={{'--tw-ring-color': gameColor.hex}}
                        />
                        <button
                            type="submit"
                            disabled={!newTodo.trim()}
                            className="flex h-11 w-11 items-center justify-center rounded-xl text-white disabled:opacity-40"
                            style={{backgroundColor: gameColor.hex}}
                            aria-label="Add todo"
                        >
                            <Icon path={ICONS.plus} className="h-5 w-5" />
                        </button>
                    </form>

                    <div className="space-y-2">
                        {buildTodos.map((todo) => {
                            const completedThisBuild =
                                buildCompletedTodoIds.has(todo.id);
                            return (
                                <button
                                    type="button"
                                    key={todo.id}
                                    onClick={() => handleToggleTodo(todo)}
                                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                                        completedThisBuild
                                            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/25'
                                            : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50'
                                    }`}
                                >
                                    <span
                                        className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border-2 ${
                                            completedThisBuild
                                                ? 'border-transparent text-white'
                                                : 'border-gray-300 dark:border-gray-600'
                                        }`}
                                        style={completedThisBuild
                                            ? {backgroundColor: gameColor.hex}
                                            : undefined}
                                    >
                                        {completedThisBuild && (
                                            <Icon path={ICONS.check} className="h-3 w-3" />
                                        )}
                                    </span>
                                    <span className={`min-w-0 flex-1 text-sm ${
                                        completedThisBuild
                                            ? 'text-gray-500 line-through dark:text-gray-400'
                                            : 'text-gray-800 dark:text-gray-200'
                                    }`}>
                                        {todo.text}
                                    </span>
                                </button>
                            );
                        })}
                        {buildTodos.length === 0 && (
                            <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400 dark:border-gray-600">
                                No open todos. Add one above or continue with your notes.
                            </p>
                        )}
                    </div>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
                    <div className="flex flex-col items-center gap-3 text-center">
                        <div>
                            <h2 className="flex items-center justify-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
                                <Icon path={ICONS.edit} className="game-text h-5 w-5" />
                                Changelog draft
                            </h2>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                Local to this client until the build session ends.
                            </p>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                            Saved locally
                        </span>
                    </div>

                    <textarea
                        value={buildDraft?.changelog || ''}
                        onChange={handleBuildChangelogChange}
                        rows={10}
                        maxLength={1000}
                        placeholder="Write down what you are changing while you build…"
                        className="mt-5 w-full resize-y rounded-xl border border-gray-300 bg-white p-4 text-gray-900 outline-none focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        style={{'--tw-ring-color': gameColor.hex}}
                    />
                    <p className="mt-1 text-right text-xs text-gray-400">
                        {(buildDraft?.changelog || '').length}/1000
                    </p>

                    <div className="mt-5 border-t border-gray-200 pt-5 dark:border-gray-700">
                        <h3 className="text-center text-sm font-bold text-gray-800 dark:text-gray-200">
                            Completed this build
                        </h3>
                        {(buildDraft?.completedTodos || []).length > 0 ? (
                            <ul className="mt-3 space-y-2">
                                {buildDraft.completedTodos.map((todo) => (
                                    <li
                                        key={todo.id}
                                        className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300"
                                    >
                                        <Icon path={ICONS.checkCircle} className="mt-0.5 h-4 w-4 flex-none text-emerald-500" />
                                        <span>{todo.text}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-center text-sm text-gray-400">
                                Checked todos will appear here and later on the changelog card.
                            </p>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );

    const renderProjectTab = () => (
        <div className="space-y-6">
            <section className={`rounded-2xl border p-5 shadow-sm ${buildStatus.surface}`}>
                <div className="flex flex-col items-center gap-4 text-center">
                    <div className="flex min-w-0 flex-col items-center gap-3">
                        <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl text-white ${buildStatus.iconClass}`}>
                            <Icon path={buildStatus.icon} className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center justify-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${buildStatus.dot}`} />
                                <h2 className="font-bold text-gray-900 dark:text-gray-100">{buildStatus.title}</h2>
                            </div>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{buildStatus.detail}</p>
                        </div>
                    </div>
                    {renderBuildActions()}
                </div>
            </section>

            {renderGallery()}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.75fr)_minmax(280px,1fr)]">
                <div className="space-y-6">
                    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <div className="border-b border-gray-200 p-5 dark:border-gray-700">
                            <div className="flex flex-col items-center gap-4 text-center">
                                <div className="flex min-w-0 flex-col items-center gap-3">
                                    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-white" style={{ backgroundColor: gameColor.hex }}>
                                        <Icon path={ICONS.database} className="h-6 w-6" />
                                    </span>
                                    <div className="min-w-0 max-w-full">
                                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Shared save</p>
                                        <h2 className="truncate text-lg font-bold text-gray-900 dark:text-gray-100">
                                            {currentVersion?.originalFileName || currentFile?.name || 'No save uploaded'}
                                        </h2>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">
                                            {currentVersion?.number
                                                ? `Version ${currentVersion.number} · ${formatBytes(currentVersion.sizeBytes)} · ${formatTime(currentVersion.uploadedAt)}`
                                                : 'Upload the first version from the desktop client.'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap justify-center gap-2">
                                    {canDownloadVersions && (
                                        <button
                                            type="button"
                                            onClick={() => setShowVersionsModal(true)}
                                            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                                        >
                                            <Icon path={ICONS.clock} className="h-4 w-4" />
                                            History
                                        </button>
                                    )}
                                    {canEdit && myPendingChangelog && (
                                        <button
                                            type="button"
                                            onClick={() => openChangelogEditor(myPendingChangelog)}
                                            disabled={!isRunningInElectron || collaboration.status !== 'active'}
                                            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-bold text-white transition disabled:cursor-not-allowed disabled:bg-gray-400"
                                            style={isRunningInElectron && collaboration.status === 'active' ? { backgroundColor: gameColor.hex } : undefined}
                                            title={!isRunningInElectron ? 'Requires the desktop client' : undefined}
                                        >
                                            <Icon path={ICONS.share} className="h-4 w-4" />
                                            Upload newest
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 divide-x divide-gray-200 bg-gray-50 dark:divide-gray-700 dark:bg-gray-900/40 sm:grid-cols-4">
                            {[
                                { label: 'Version', value: currentVersion?.number ? `v${currentVersion.number}` : '—' },
                                { label: 'Contributor', value: currentVersion?.uploadedByUsername || '—' },
                                { label: 'Members', value: members.length },
                                { label: 'Retention', value: `${retentionLimit} each` },
                            ].map((item) => (
                                <div key={item.label} className="px-4 py-3 text-center">
                                    <p className="truncate font-bold text-gray-900 dark:text-gray-100">{item.value}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                </div>

                <aside className="space-y-6">
                    {renderTasks()}
                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <h2 className="text-center font-bold text-gray-900 dark:text-gray-100">Safe hand-off</h2>
                        <ol className="mt-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                            {[
                                'Start your turn from the game overlay.',
                                'Build and save in the game while the project is reserved.',
                                'Log off to free the collaboration for the next contributor.',
                                'Complete the changelog popover and upload the newest save.',
                            ].map((step, index) => (
                                <li key={step} className="flex gap-3">
                                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: gameColor.hex }}>
                                        {index + 1}
                                    </span>
                                    <span>{step}</span>
                                </li>
                            ))}
                        </ol>
                    </section>
                </aside>
            </div>
        </div>
    );

    const renderSettingsTab = () => {
        const categories = [
            { id: 'project', label: 'Project', hint: 'Details, media and visibility', icon: ICONS.cog, tint: 'bg-blue-500' },
            { id: 'access', label: 'Access & invite', hint: 'Join mode and share code', icon: ICONS.share, tint: 'bg-emerald-500' },
            { id: 'versions', label: 'Versions', hint: 'History and retention', icon: ICONS.refresh, tint: 'bg-purple-500' },
            { id: 'publishing', label: 'Publishing', hint: 'Completion, credits and release', icon: ICONS.shieldCheck, tint: 'bg-amber-500' },
            { id: 'danger', label: 'Danger zone', hint: 'Leave or delete', icon: ICONS.trash, tint: 'bg-red-500' },
        ];
        const openSection = (sectionId) => {
            setActiveSettingsSection(sectionId);
            setSettingsMobileOpen(true);
        };
        const panelClass = 'rounded-lg bg-white p-6 shadow-md dark:bg-gray-800';

        return (
            <div className="lg:flex lg:items-start lg:gap-6">
                <nav className={`${settingsMobileOpen ? 'hidden' : 'block'} lg:block lg:w-72 lg:flex-shrink-0`}>
                    <div className="rounded-2xl bg-white p-2 shadow-md dark:bg-gray-800">
                        {categories.map((category) => {
                            const active = activeSettingsSection === category.id;
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    onClick={() => openSection(category.id)}
                                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors last:mb-0 ${
                                        active
                                            ? 'lg:bg-[--game-color] lg:text-white'
                                            : 'text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg text-white ${category.tint}`}>
                                        <Icon path={category.icon} className="h-5 w-5" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-semibold leading-tight">{category.label}</span>
                                        <span className={`block truncate text-xs ${
                                            active ? 'text-gray-400 lg:text-white/80' : 'text-gray-400'
                                        }`}>
                                            {category.hint}
                                        </span>
                                    </span>
                                    <Icon path={ICONS.chevronRight} className="h-4 w-4 flex-none text-gray-300 lg:hidden" />
                                </button>
                            );
                        })}
                    </div>
                </nav>

                <section className={`${settingsMobileOpen ? 'block' : 'hidden'} min-w-0 flex-1 lg:block`}>
                    <button
                        type="button"
                        onClick={() => setSettingsMobileOpen(false)}
                        className="mb-3 flex items-center gap-1 font-semibold lg:hidden"
                        style={{ color: gameColor.hex }}
                    >
                        <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                        Settings
                    </button>

                    {activeSettingsSection === 'project' && (
                        <div className={panelClass}>
                            <div className="flex flex-col items-center gap-4 text-center">
                                <div className="mx-auto max-w-2xl">
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Project & appearance</h2>
                                    <p className="mt-1 text-gray-600 dark:text-gray-300">
                                        Change the title, visibility, banner and up to 10 starting gallery images.
                                    </p>
                                </div>
                                {isOwner && (
                                    <button
                                        type="button"
                                        onClick={() => navigate(`/collaboration/${collaboration.id}/edit`)}
                                        className="rounded-lg px-4 py-2 font-bold text-white"
                                        style={{ backgroundColor: gameColor.hex }}
                                    >
                                        Edit
                                    </button>
                                )}
                            </div>
                            <dl className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                                {[
                                    ['Game', game?.name || collaboration.game],
                                    ['Status', collaboration.status || 'active'],
                                    [
                                        'Visibility',
                                        collaboration.visibility === 'public' ?
                                            'Public on overview' :
                                            'Unlisted',
                                    ],
                                    ['Banner', safeBannerImageUrl ? 'Custom image' : 'Theme card'],
                                    [
                                        'Starting gallery',
                                        `${startingGalleryImageUrls.length} ${
                                            startingGalleryImageUrls.length === 1 ? 'image' : 'images'
                                        }`,
                                    ],
                                    ['Created', formatTime(collaboration.createdAt) || 'Unknown'],
                                ].map(([label, value]) => (
                                    <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                                        <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                                        <dd className="text-right font-semibold capitalize text-gray-900 dark:text-white">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    )}

                    {activeSettingsSection === 'access' && (
                        <div className={panelClass}>
                            <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">Access & invite</h2>
                            <p className="mt-1 text-center text-gray-600 dark:text-gray-300">
                                The share code opens the correct invite, password or application flow.
                            </p>
                            <div className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                                <div className="mb-4 flex items-center justify-between gap-4">
                                    <span className="text-gray-500 dark:text-gray-400">Join mode</span>
                                    <span className="font-bold capitalize text-gray-900 dark:text-white">{collaboration.joinMode || 'invite'}</span>
                                </div>
                                <div className="flex gap-2">
                                    <code className="min-w-0 flex-1 truncate rounded-lg bg-gray-100 px-4 py-3 text-center font-mono text-lg font-bold tracking-wider text-gray-900 dark:bg-gray-900 dark:text-white">
                                        {collaboration.inviteCode}
                                    </code>
                                    <button type="button" onClick={copyInviteCode} className="rounded-lg border border-gray-300 p-3 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" title="Copy share code">
                                        <Icon path={ICONS.copy} className="h-5 w-5" />
                                    </button>
                                    {hasOwnerPermissions && collaborationActive && (
                                        <button type="button" onClick={handleRegenerateInvite} className="rounded-lg border border-gray-300 p-3 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700" title="Generate a new share code">
                                            <Icon path={ICONS.refresh} className="h-5 w-5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            {isOwner && (
                                <button
                                    type="button"
                                    onClick={() => navigate(`/collaboration/${collaboration.id}/edit`)}
                                    className="mt-5 w-full rounded-lg py-3 font-bold text-white"
                                    style={{ backgroundColor: gameColor.hex }}
                                >
                                    Change access settings
                                </button>
                            )}
                        </div>
                    )}

                    {activeSettingsSection === 'versions' && (
                        <div className={panelClass}>
                            <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">Version safety net</h2>
                            <p className="mt-1 text-center text-gray-600 dark:text-gray-300">
                                Retention is applied per contributor after each successful save upload.
                            </p>
                            <div className="mt-6 rounded-lg bg-gray-50 p-5 dark:bg-gray-900/50">
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-gray-600 dark:text-gray-300">Versions kept per contributor</span>
                                    <span className="text-3xl font-bold text-gray-900 dark:text-white">{retentionLimit}</span>
                                </div>
                                <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
                                    {members.length > 10
                                        ? 'More than 10 members are active, so the limit is 2 each.'
                                        : 'The limit changes to 2 each when the collaboration exceeds 10 members.'}
                                </p>
                            </div>
                            {canDownloadVersions && (
                                <button
                                    type="button"
                                    onClick={() => setShowVersionsModal(true)}
                                    className="mt-5 w-full rounded-lg py-3 font-bold text-white"
                                    style={{ backgroundColor: gameColor.hex }}
                                >
                                    Open version history
                                </button>
                            )}
                        </div>
                    )}

                    {activeSettingsSection === 'publishing' && (
                        <div className={panelClass}>
                            <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">Publish this project</h2>
                            <p className="mx-auto mt-1 max-w-2xl text-center text-gray-600 dark:text-gray-300">
                                The final signed save becomes a normal public Creation. Everyone who contributed stays credited, even after leaving the collaboration.
                            </p>

                            <div className="mt-6 rounded-lg border border-gray-200 p-5 text-center dark:border-gray-700">
                                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Publication consent</p>
                                <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">
                                    {consentedMemberCount}/{members.length}
                                </p>
                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                    New members agree when joining. Older memberships can confirm here once.
                                </p>
                                {currentMember && !currentMember.publishConsent?.agreed && publishInfo.state !== 'revoked' && (
                                    <button
                                        type="button"
                                        onClick={handleConfirmPublishConsent}
                                        disabled={Boolean(publishingBusy)}
                                        className="pc-tactile-button mt-4 rounded-lg px-5 py-2.5 font-bold text-white disabled:cursor-wait disabled:opacity-60"
                                        style={{ backgroundColor: gameColor.hex }}
                                    >
                                        {publishingBusy === 'consent' ? 'Recording...' : 'Agree to credit & publication'}
                                    </button>
                                )}
                            </div>

                            {collaboration.status === 'active' && (
                                <div className="mt-5 rounded-lg bg-gray-50 p-5 text-center dark:bg-gray-900/50">
                                    <h3 className="font-bold text-gray-900 dark:text-white">1. Complete the collaboration</h3>
                                    <p className="mx-auto mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">
                                        This permanently ends building and freezes tasks, comments and changelogs for review.
                                    </p>
                                    {isOwner ? (
                                        <button
                                            type="button"
                                            onClick={handleCompleteCollaboration}
                                            disabled={Boolean(publishingBusy) || lockActive}
                                            className="pc-tactile-button mt-4 rounded-lg px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                                            style={!publishingBusy && !lockActive ? { backgroundColor: gameColor.hex } : undefined}
                                        >
                                            {publishingBusy === 'complete' ? 'Completing...' : 'Mark as complete'}
                                        </button>
                                    ) : (
                                        <p className="mt-4 font-semibold text-gray-600 dark:text-gray-300">The owner completes the project.</p>
                                    )}
                                    {lockActive && (
                                        <p className="mt-2 text-sm font-semibold text-amber-600 dark:text-amber-300">Finish the active build session first.</p>
                                    )}
                                </div>
                            )}

                            {collaboration.status === 'completed' && publishInfo.state === 'ready' && (
                                <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50/70 p-5 text-center dark:border-gray-700 dark:bg-gray-900/45">
                                    <h3 className="font-bold text-emerald-800 dark:text-emerald-200">2. Publish the final version</h3>
                                    <p className="mx-auto mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">
                                        Version {currentVersion?.number || 'current'} will be copied to the regular Creation download system.
                                    </p>
                                    {isOwner ? (
                                        <button
                                            type="button"
                                            onClick={handlePublishCollaboration}
                                            disabled={Boolean(publishingBusy) || !allMembersConsented}
                                            className="pc-tactile-button mt-4 rounded-lg bg-emerald-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                                        >
                                            {publishingBusy === 'publish' ? 'Publishing...' : 'Publish as Creation'}
                                        </button>
                                    ) : (
                                        <p className="mt-4 font-semibold text-emerald-800 dark:text-emerald-200">Ready for the owner to publish.</p>
                                    )}
                                    {!allMembersConsented && (
                                        <p className="mt-2 text-sm font-semibold text-amber-600 dark:text-amber-300">Waiting for every current member's consent.</p>
                                    )}
                                </div>
                            )}

                            {publishInfo.state === 'published' && (
                                <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50/70 p-5 text-center dark:border-gray-700 dark:bg-gray-900/45">
                                    <h3 className="font-bold text-blue-800 dark:text-blue-200">Published</h3>
                                    <button
                                        type="button"
                                        onClick={() => navigate(`/creation/${publishInfo.publishedCreationId}`)}
                                        className="pc-tactile-button mt-3 rounded-lg px-5 py-2.5 font-bold text-white"
                                        style={{ backgroundColor: gameColor.hex }}
                                    >
                                        Open published Creation
                                    </button>
                                    <div className="mt-5 border-t border-gray-200 pt-5 dark:border-gray-700">
                                        <p className="font-semibold text-gray-900 dark:text-gray-100">Removal vote: {revokeVoterIds.length}/{members.length}</p>
                                        <p className="mx-auto mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">
                                            The Creation is removed only after every current member votes. Members who leave no longer count toward the total.
                                        </p>
                                        {currentMember && (
                                            <button
                                                type="button"
                                                onClick={handleVoteRevokePublish}
                                                disabled={Boolean(publishingBusy) || hasVotedToRevoke}
                                                className="pc-tactile-button mt-4 rounded-lg border border-red-300 bg-white px-5 py-2.5 font-bold text-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-gray-900 dark:text-red-300"
                                            >
                                                {hasVotedToRevoke ? 'Removal vote recorded' : publishingBusy === 'revoke' ? 'Recording vote...' : 'Vote to remove publication'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {publishInfo.state === 'revoked' && (
                                <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-5 text-center dark:border-gray-700 dark:bg-gray-900/50">
                                    <h3 className="font-bold text-gray-900 dark:text-white">Publication removed</h3>
                                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">This collaboration cannot be published again.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeSettingsSection === 'danger' && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-md dark:border-red-900 dark:bg-red-950/20">
                            <h2 className="text-center text-2xl font-bold text-red-700 dark:text-red-200">Danger zone</h2>
                            <p className="mt-2 text-center text-red-600 dark:text-red-300">
                                Leaving removes active membership. Deleting permanently removes the collaboration and its project history.
                            </p>
                            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                                {userRole && !isOwner && (
                                    <button type="button" onClick={handleLeave} className="rounded-lg border border-red-300 bg-white px-5 py-3 font-bold text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300">
                                        Leave collaboration
                                    </button>
                                )}
                                {hasOwnerPermissions && (
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={publishInfo.state === 'published'}
                                        className="rounded-lg bg-red-600 px-5 py-3 font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                                    >
                                        Delete collaboration
                                    </button>
                                )}
                            </div>
                            {publishInfo.state === 'published' && (
                                <p className="mt-3 text-center text-sm font-semibold text-red-600 dark:text-red-300">
                                    The published Creation must be unanimously removed first.
                                </p>
                            )}
                        </div>
                    )}
                </section>
            </div>
        );
    };

    const renderTabContent = () => {
        if (activeTab === 'Build' && buildWorkspaceActive) {
            return renderBuildWorkspace();
        }
        if (activeTab === 'Changelog') return renderChangelog();
        if (activeTab === 'Members') {
            return (
                <CollaborationMemberList
                    members={members}
                    currentUserId={user?.uid}
                    isOwner={hasOwnerPermissions}
                    collaborationId={collaborationId}
                    setModalMessage={setModalMessage}
                    setConfirmation={setConfirmation}
                    onMembersChanged={loadMembers}
                    accentColor={gameColor.hex}
                />
            );
        }
        if (activeTab === 'Settings') return renderSettingsTab();
        return renderProjectTab();
    };

    return (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8" style={gameColor.style}>
            <button
                type="button"
                onClick={() => navigate('/communitys')}
                className="mb-5 inline-flex items-center gap-2 font-semibold text-gray-600 transition hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
                <Icon path={ICONS.arrowLeft} className="h-5 w-5" />
                Back to Community Hub
            </button>

            <header
                className={`relative overflow-hidden rounded-2xl border p-6 shadow-lg transition-colors sm:p-8 ${
                    safeBannerImageUrl
                        ? 'min-h-[300px] border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
                }`}
                style={{ '--collaboration-accent': gameColor.hex }}
            >
                {safeBannerImageUrl && (
                    <>
                        <img
                            src={safeBannerImageUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            aria-hidden="true"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/60 to-black/75" />
                    </>
                )}
                <div className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: gameColor.hex }} />
                {!safeBannerImageUrl && (
                    <div
                        className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-10 blur-3xl dark:opacity-20"
                        style={{ backgroundColor: gameColor.hex }}
                    />
                )}
                <div className="relative z-10 flex min-h-[220px] flex-col items-center justify-center text-center">
                    <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
                            <span className="rounded-full px-3 py-1 text-xs font-bold text-white" style={{ backgroundColor: gameColor.hex }}>
                                {game?.shortName || collaboration.game}
                            </span>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                                safeBannerImageUrl
                                    ? 'bg-black/35 text-white'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200'
                            }`}>
                                {collaboration.status || 'active'}
                            </span>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                                safeBannerImageUrl
                                    ? 'bg-black/35 text-white'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200'
                            }`}>
                                {userRole || 'visitor'}
                            </span>
                        </div>
                        <h1 className="mx-auto max-w-3xl break-words text-3xl font-bold sm:text-4xl">{collaboration.title}</h1>
                        {collaboration.description && (
                            <p className={`mx-auto mt-3 max-w-3xl text-sm leading-6 sm:text-base ${
                                safeBannerImageUrl
                                    ? 'text-white/85'
                                    : 'text-gray-600 dark:text-gray-300'
                            }`}>
                                {collaboration.description}
                            </p>
                        )}
                        <div className={`mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm ${
                            safeBannerImageUrl
                                ? 'text-white/85'
                                : 'text-gray-600 dark:text-gray-300'
                        }`}>
                            <span className="flex items-center gap-1.5">
                                <Icon path={ICONS.users} className="h-4 w-4" />
                                {members.length} members
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Icon path={ICONS.refresh} className="h-4 w-4" />
                                {currentVersion?.number ? `Version ${currentVersion.number}` : 'No version yet'}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Icon path={ICONS.checklist} className="h-4 w-4" />
                                {pendingTodos.length} open tasks
                            </span>
                        </div>
                    </div>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        {!publicReadOnly && userRole && collaborationActive && (
                        <button
                            type="button"
                            onClick={() => setShowInviteModal(true)}
                            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 font-bold transition ${
                                safeBannerImageUrl
                                    ? 'border-white/30 bg-black/30 text-white hover:bg-black/45'
                                    : 'border-gray-300 bg-gray-50 text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600'
                            }`}
                        >
                            <Icon path={ICONS.share} className="h-5 w-5" />
                            Share invite
                        </button>
                        )}
                        {canEdit && myPendingChangelog && (
                            <button
                                type="button"
                                onClick={() => openChangelogEditor(myPendingChangelog)}
                                disabled={!isRunningInElectron || collaboration.status !== 'active'}
                                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-bold text-white transition disabled:cursor-not-allowed disabled:bg-gray-500 disabled:text-gray-300"
                                style={isRunningInElectron && collaboration.status === 'active' ? { backgroundColor: gameColor.hex } : undefined}
                            >
                                <Icon path={ICONS.share} className="h-5 w-5" />
                                Upload newest
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <nav className="my-6 flex justify-center">
                <div className="relative flex max-w-full items-center overflow-x-auto rounded-full bg-gray-200 p-1 dark:bg-gray-800">
                    <div
                        ref={gliderRef}
                        className="absolute bottom-1 top-1 rounded-full shadow-sm transition-all duration-300"
                        style={{ backgroundColor: gameColor.hex }}
                    />
                    {visibleTabs.map((tab, index) => (
                        <button
                            type="button"
                            key={tab.id}
                            ref={(element) => { tabRefs.current[index] = element; }}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative z-10 flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:px-6 ${
                                activeTab === tab.id ? 'text-white' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                            }`}
                        >
                            <Icon path={tab.icon} className="h-4 w-4" />
                            {tab.id}
                            {tab.id === 'Changelog' && <span className="text-xs opacity-70">{uploads.length}</span>}
                            {tab.id === 'Members' && <span className="text-xs opacity-70">{members.length}</span>}
                        </button>
                    ))}
                </div>
            </nav>

            {publicReadOnly && (
                <div className="mb-6 rounded-2xl border border-purple-200 bg-purple-50 px-5 py-4 text-center text-purple-900 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-100">
                    <p className="font-bold">Public read-only view</p>
                    <p className="mx-auto mt-1 max-w-2xl text-sm text-purple-700 dark:text-purple-300">
                        Visibility lets you follow this project, but it does not grant membership or save downloads. Joining still requires the collaboration's share code and configured access method.
                    </p>
                </div>
            )}

            {renderTabContent()}

            {showInviteModal && (
                <InviteMemberModal
                    inviteCode={collaboration.inviteCode}
                    accentColor={gameColor.hex}
                    onClose={() => setShowInviteModal(false)}
                    setModalMessage={setModalMessage}
                />
            )}

            {showVersionsModal && canDownloadVersions && (
                <FileVersionsModal
                    collaborationId={collaborationId}
                    fileId="save"
                    file={currentFile || { name: currentVersion?.originalFileName || 'Shared save' }}
                    gameId={collaboration.game}
                    currentUserId={user.uid}
                    retentionLimit={retentionLimit}
                    isElectron={isRunningInElectron}
                    accentColor={gameColor.hex}
                    onClose={() => setShowVersionsModal(false)}
                    setModalMessage={setModalMessage}
                />
            )}

            {changelogModalOpen && isRunningInElectron && (
                <CollaborationChangelogModal
                    collaborationId={collaborationId}
                    collaboration={collaboration}
                    entry={changelogEntryToEdit}
                    currentVersion={currentVersion}
                    game={game}
                    retentionLimit={retentionLimit}
                    accentColor={gameColor.hex}
                    onClose={() => {
                        setChangelogModalOpen(false);
                        setChangelogEntryToEdit(null);
                    }}
                    onUploaded={async (finalized) => {
                        if (finalized?.promotedToCurrent &&
                            finalized.versionId &&
                            finalized.versionNumber) {
                            recordInstalledCollaborationVersion({
                                userId: user.uid,
                                collaborationId,
                                gameId: collaboration.game,
                                versionId: finalized.versionId,
                                versionNumber: finalized.versionNumber,
                                targetPath: finalized.localFilePath,
                            });
                        }
                        return loadProjectData();
                    }}
                    setModalMessage={setModalMessage}
                />
            )}
        </div>
    );
};

export default CollaborationDetailPage;
