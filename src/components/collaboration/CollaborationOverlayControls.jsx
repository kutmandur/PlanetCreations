import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    endBuildSession,
    fetchUserCollaborationsForGame,
    getCollaborationVersionDownloadUrl,
    startBuildSession,
} from '../../firebase/collaboration';
import {
    endRememberedCollaborationBuild,
    readActiveCollaborationBuild,
    rememberActiveCollaborationBuild,
    subscribeActiveCollaborationBuild,
} from '../../utils/collaborationBuildSession';
import { ensureCollaborationBuildDraft } from '../../utils/collaborationBuildDraft';
import {
    findCollaborationVersionUpdates,
    readInstalledCollaborationVersions,
    recordInstalledCollaborationVersion,
    subscribeInstalledCollaborationVersions,
} from '../../utils/collaborationVersionUpdates';
import { subscribeCollaborationAvailable } from '../../utils/collaborationAvailability';

const expiresAtMillis = (expiresAt) => {
    if (typeof expiresAt?.toMillis === 'function') return expiresAt.toMillis();
    if (Number.isFinite(expiresAt)) return expiresAt;
    return 0;
};

const isLockActive = (lock) => (
    Boolean(lock?.activeBuilderId) && expiresAtMillis(lock.expiresAt) > Date.now()
);

const formatTimeLeft = (expiresAt) => {
    const minutes = Math.max(0, Math.ceil((expiresAtMillis(expiresAt) - Date.now()) / 60000));
    if (minutes < 60) return `~${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `~${hours}h${remainder ? ` ${remainder}m` : ''}`;
};

const CollaborationOverlayControls = ({
    user,
    activeGameId,
    currentPath,
    onOpenCollaboration,
    setModalMessage,
}) => {
    const [collaborations, setCollaborations] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [loading, setLoading] = useState(false);
    const [acting, setActing] = useState(false);
    const [updatingVersionId, setUpdatingVersionId] = useState(null);
    const [startWarning, setStartWarning] = useState(null);
    const [installedVersions, setInstalledVersions] = useState(
        () => readInstalledCollaborationVersions(user?.uid),
    );
    const [rememberedBuild, setRememberedBuild] = useState(
        () => readActiveCollaborationBuild(),
    );

    const loadCollaborations = useCallback(async () => {
        if (!user?.uid || !activeGameId) {
            setCollaborations([]);
            setSelectedId('');
            return;
        }
        setLoading(true);
        try {
            const next = await fetchUserCollaborationsForGame(user.uid, activeGameId);
            setCollaborations(next);
            const pendingUpdates = findCollaborationVersionUpdates(
                next,
                readInstalledCollaborationVersions(user.uid),
            );
            setSelectedId((current) => (
                next.some((collaboration) => collaboration.id === current)
                    ? current
                    : (pendingUpdates[0]?.collaborationId || next[0]?.id || '')
            ));
        } catch (error) {
            setModalMessage?.(`Could not load collaborations: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [activeGameId, setModalMessage, user?.uid]);

    useEffect(() => {
        loadCollaborations();
    }, [loadCollaborations]);

    useEffect(() => {
        if (!selectedId) return undefined;
        return subscribeCollaborationAvailable(selectedId, () => {
            // Clear the local lock synchronously before the async refresh. This
            // prevents the lock-adoption effect from recreating a just-cleared
            // remembered build while the Firestore read is still in flight.
            setCollaborations((current) => current.map((item) => (
                item.id === selectedId ? { ...item, buildLock: null } : item
            )));
            loadCollaborations();
        });
    }, [loadCollaborations, selectedId]);

    useEffect(() => {
        setStartWarning(null);
    }, [selectedId]);

    useEffect(() => {
        setInstalledVersions(readInstalledCollaborationVersions(user?.uid));
        return subscribeInstalledCollaborationVersions(
            user?.uid,
            setInstalledVersions,
        );
    }, [user?.uid]);

    useEffect(() => subscribeActiveCollaborationBuild(
        setRememberedBuild,
    ), []);

    useEffect(() => {
        if (rememberedBuild?.gameId !== activeGameId) return;
        if (collaborations.some((item) =>
            item.id === rememberedBuild.collaborationId)) {
            setSelectedId(rememberedBuild.collaborationId);
        }
    }, [activeGameId, collaborations, rememberedBuild]);

    const collaboration = useMemo(
        () => collaborations.find((item) => item.id === selectedId) || null,
        [collaborations, selectedId],
    );
    const versionUpdates = useMemo(
        () => findCollaborationVersionUpdates(
            collaborations,
            installedVersions,
        ),
        [collaborations, installedVersions],
    );
    const versionUpdate = versionUpdates.find(
        (update) => update.collaborationId === collaboration?.id,
    ) || null;
    const serverLockActive = isLockActive(collaboration?.buildLock);
    const rememberedIAmBuilder = !serverLockActive &&
        rememberedBuild?.collaborationId === collaboration?.id &&
        rememberedBuild?.userId === user?.uid &&
        rememberedBuild?.pendingEnd !== true;
    const lockActive = serverLockActive || rememberedIAmBuilder;
    const iAmBuilder = rememberedIAmBuilder || (
        serverLockActive &&
        collaboration.buildLock.activeBuilderId === user?.uid
    );
    const isRelevantCollaborationOpen =
        currentPath === `/collaboration/${collaboration?.id}`;

    // If this lock was created by an older client/page, adopt it locally so the
    // game-close event can still perform the reliable auto-logoff.
    useEffect(() => {
        if (!iAmBuilder || !collaboration) return;
        rememberActiveCollaborationBuild({
            collaborationId: collaboration.id,
            gameId: activeGameId,
            userId: user.uid,
            buildSessionId: collaboration.buildLock?.sessionId ||
                rememberedBuild?.buildSessionId ||
                null,
        });
        ensureCollaborationBuildDraft({
            collaborationId: collaboration.id,
            gameId: activeGameId,
            userId: user.uid,
            buildSessionId: collaboration.buildLock?.sessionId ||
                rememberedBuild?.buildSessionId ||
                null,
        });
    }, [
        activeGameId,
        collaboration,
        iAmBuilder,
        rememberedBuild?.buildSessionId,
        user?.uid,
    ]);

    const updateSelectedLock = (buildLock) => {
        setCollaborations((current) => current.map((item) => (
            item.id === selectedId ? { ...item, buildLock } : item
        )));
    };

    const handleStart = async () => {
        if (!collaboration || acting || updatingVersionId) return;
        setActing(true);
        try {
            const acknowledgeMissingSave =
                startWarning?.collaborationId === collaboration.id;
            const result = await startBuildSession(
                collaboration.id,
                60,
                acknowledgeMissingSave,
            );
            if (result.requiresMissingSaveConfirmation) {
                setStartWarning({
                    collaborationId: collaboration.id,
                    ...result.missingSave,
                });
                return;
            }
            setStartWarning(null);
            rememberActiveCollaborationBuild({
                collaborationId: collaboration.id,
                gameId: activeGameId,
                userId: user.uid,
                buildSessionId: result.buildSessionId || null,
            });
            ensureCollaborationBuildDraft({
                collaborationId: collaboration.id,
                gameId: activeGameId,
                userId: user.uid,
                buildSessionId: result.buildSessionId || null,
            });
            updateSelectedLock({
                sessionId: result.buildSessionId || null,
                activeBuilderId: user.uid,
                username: user.displayName || user.email || 'You',
                expiresAt: result.expiresAt,
            });
            setModalMessage?.("You're logged on to build.");
        } catch (error) {
            setModalMessage?.(error.message);
            await loadCollaborations();
        } finally {
            setActing(false);
        }
    };

    const handleEnd = async () => {
        if (!collaboration || acting || updatingVersionId) return;
        setActing(true);
        try {
            // Ensure the remembered entry exists even for a lock made by an
            // earlier desktop build, then use the shared retry-safe end path.
            rememberActiveCollaborationBuild({
                collaborationId: collaboration.id,
                gameId: activeGameId,
                userId: user.uid,
                buildSessionId: collaboration.buildLock?.sessionId ||
                    rememberedBuild?.buildSessionId ||
                    null,
            });
            const result = await endRememberedCollaborationBuild({
                userId: user.uid,
                gameId: activeGameId,
                endSession: (
                    collaborationId,
                    endedAtMillis,
                    buildDraft,
                    buildSessionId,
                ) => endBuildSession(
                    collaborationId,
                    false,
                    endedAtMillis,
                    buildDraft,
                    buildSessionId,
                ),
            });
            updateSelectedLock(null);
            onOpenCollaboration?.(collaboration.id, {
                openChangelog: true,
                source: 'manual-logoff',
                changelogEntryId: result.changelogEntryId || null,
                changelogUserId: result.changelogUserId || user.uid,
                username: result.username || user.displayName || user.email || null,
                createdAtMillis: result.createdAtMillis || Date.now(),
                changelog: result.changelog ||
                    result.buildDraft?.changelog ||
                    '',
                completedTodos: result.completedTodos ||
                    result.buildDraft?.completedTodos ||
                    [],
            });
        } catch (error) {
            setModalMessage?.(`Log-off will be retried when online: ${error.message}`);
        } finally {
            setActing(false);
        }
    };

    const handleInstallCurrentVersion = async () => {
        if (!collaboration || !versionUpdate || updatingVersionId) return;
        if (!window.electronAPI?.saveCollaborationVersion) {
            setModalMessage?.(
                'Install collaboration updates with the desktop client.',
            );
            return;
        }
        const remoteVersion = versionUpdate.currentVersion;
        setUpdatingVersionId(remoteVersion.versionId);
        try {
            const download = await getCollaborationVersionDownloadUrl(
                collaboration.id,
                remoteVersion.versionId,
            );
            const saveRequest = {
                downloadUrl: download.downloadUrl,
                gameId: activeGameId,
            };
            if (versionUpdate.installedVersion?.targetPath) {
                saveRequest.suggestedTargetPath =
                    versionUpdate.installedVersion.targetPath;
            }
            const result = await window.electronAPI.saveCollaborationVersion(
                saveRequest,
            );
            if (result?.status === 'canceled') return;
            if (!result?.success) {
                throw new Error(
                    result?.message ||
                    'The collaboration update could not be installed.',
                );
            }
            const installed = recordInstalledCollaborationVersion({
                userId: user.uid,
                collaborationId: collaboration.id,
                gameId: activeGameId,
                versionId: remoteVersion.versionId,
                versionNumber: remoteVersion.versionNumber,
                targetPath: result.targetPath,
            });
            if (installed) {
                setInstalledVersions((current) => ({
                    ...current,
                    [collaboration.id]: installed,
                }));
            }
            const nextUpdate = versionUpdates.find(
                (update) => update.collaborationId !== collaboration.id,
            );
            if (nextUpdate) setSelectedId(nextUpdate.collaborationId);
            setModalMessage?.(
                `Version ${remoteVersion.versionNumber} of ${collaboration.title} saved to ${result.targetPath}.`,
            );
        } catch (error) {
            setModalMessage?.(`Collaboration update failed: ${error.message}`);
        } finally {
            setUpdatingVersionId(null);
        }
    };

    if (!user) {
        return <span className="truncate text-xs text-gray-400">Sign in to use collaboration build locks</span>;
    }
    if (!activeGameId) {
        return <span className="truncate text-xs text-gray-400">No supported game detected</span>;
    }
    if (loading) {
        return <span className="truncate text-xs text-gray-400">Loading collaborations…</span>;
    }
    if (!collaborations.length) {
        return <span className="truncate text-xs text-gray-400">No active collaboration for this game</span>;
    }

    return (
        <div data-overlay-interactive className="flex min-w-0 flex-1 items-center justify-center gap-2 px-3 text-xs">
            {collaborations.length > 1 ? (
                <select
                    value={selectedId}
                    onChange={(event) => setSelectedId(event.target.value)}
                    className="max-w-[190px] rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-100"
                    aria-label="Active collaboration"
                >
                    {collaborations.map((item) => {
                        const itemUpdate = versionUpdates.find(
                            (update) => update.collaborationId === item.id,
                        );
                        return (
                            <option key={item.id} value={item.id}>
                                {item.title}
                                {itemUpdate
                                    ? ` · v${itemUpdate.currentVersion.versionNumber} available`
                                    : ''}
                            </option>
                        );
                    })}
                </select>
            ) : (
                <span className="max-w-[190px] truncate font-medium text-gray-100">{collaboration.title}</span>
            )}

            <span className={`h-2.5 w-2.5 flex-none rounded-full ${lockActive ? (iAmBuilder ? 'bg-blue-400' : 'bg-red-400') : 'bg-green-400'}`} />
            <span className="max-w-[170px] truncate text-gray-300">
                {startWarning && !lockActive
                    ? `${startWarning.username} has not uploaded the newest save`
                    : versionUpdate
                    ? versionUpdate.reason === 'not-synced'
                        ? `Version ${versionUpdate.currentVersion.versionNumber} is ready to sync`
                        : `Update available: v${versionUpdate.installedVersion.versionNumber} → v${versionUpdate.currentVersion.versionNumber}`
                    : lockActive
                    ? iAmBuilder
                        ? `You are building${collaboration.buildLock?.expiresAt
                            ? ` · ${formatTimeLeft(collaboration.buildLock.expiresAt)}`
                            : ''}`
                        : `${collaboration.buildLock?.username || 'Someone'} is building · ${formatTimeLeft(collaboration.buildLock?.expiresAt)}`
                    : 'Free to build'}
            </span>

            {versionUpdate && (
                <button
                    type="button"
                    className="overlay-action-button bg-purple-600 hover:bg-purple-500"
                    onClick={handleInstallCurrentVersion}
                    disabled={Boolean(updatingVersionId) || acting}
                >
                    {updatingVersionId
                        ? 'Installing…'
                        : `Install v${versionUpdate.currentVersion.versionNumber}`}
                </button>
            )}
            {!lockActive && (
                <button
                    type="button"
                    className={`overlay-action-button ${
                        startWarning
                            ? 'bg-amber-600 hover:bg-amber-500'
                            : 'bg-green-600 hover:bg-green-500'
                    }`}
                    onClick={handleStart}
                    disabled={acting || Boolean(updatingVersionId)}
                >
                    {acting
                        ? 'Starting…'
                        : (startWarning ? 'Build older version' : 'Start building')}
                </button>
            )}
            {iAmBuilder && (
                <button
                    type="button"
                    className="overlay-action-button bg-gray-600 hover:bg-gray-500"
                    onClick={handleEnd}
                    disabled={acting || Boolean(updatingVersionId)}
                >
                    {acting ? 'Ending…' : 'Log off'}
                </button>
            )}
            {iAmBuilder && !isRelevantCollaborationOpen ? (
                <button
                    type="button"
                    className="overlay-action-button max-w-[280px] truncate border border-blue-300/60 bg-blue-600 hover:bg-blue-500"
                    onClick={() => onOpenCollaboration?.(collaboration.id, {
                        openBuildWorkspace: true,
                    })}
                >
                    Build workspace: {collaboration.title} →
                </button>
            ) : !iAmBuilder ? (
                <button
                    type="button"
                    className="overlay-action-button bg-blue-600 hover:bg-blue-500"
                    onClick={() => onOpenCollaboration?.(collaboration.id)}
                >
                    Open project
                </button>
            ) : null}
            <button
                type="button"
                className="overlay-refresh-button"
                onClick={loadCollaborations}
                title="Refresh collaboration status"
                aria-label="Refresh collaboration status"
            >
                ↻
            </button>
        </div>
    );
};

export default CollaborationOverlayControls;
