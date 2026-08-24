import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '../../firebase/config';
import { getAppCheckTokenIfAvailable } from '../../firebase/appCheck';
import {
    finalizeCollaborationVersion,
    updateCollaborationChangelogEntry,
} from '../../firebase/collaboration';
import { ICONS, isSafeHttpUrl } from '../../utils/helpers';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';
import {
    DESKTOP_UPLOAD_BRIDGE_UNAVAILABLE_MESSAGE,
    supportsDesktopBackupUpload,
    uploadPreparedDesktopBackup,
} from '../../utils/desktopBackupUpload';

const formatBytes = (bytes) => {
    if (!bytes) return '0 MB';
    const megabytes = bytes / (1024 * 1024);
    return megabytes < 1
        ? `${(megabytes * 1024).toFixed(0)} KB`
        : `${megabytes.toFixed(1)} MB`;
};

const formatSaveAge = (ageMs) => {
    if (!Number.isFinite(ageMs) || ageMs < 60_000) return 'less than a minute ago';
    const minutes = Math.floor(ageMs / 60_000);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h${remainder ? ` ${remainder}m` : ''} ago`;
};

const CollaborationChangelogModal = ({
    collaborationId,
    collaboration,
    entry,
    currentVersion,
    game,
    retentionLimit,
    accentColor,
    onClose,
    onUploaded,
    setModalMessage,
}) => {
    const [text, setText] = useState(entry?.changelog || '');
    const [imageInput, setImageInput] = useState('');
    const [imageUrls, setImageUrls] = useState(entry?.imageUrls || []);
    const [latestSave, setLatestSave] = useState(null);
    const [checkingSave, setCheckingSave] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [savingNotes, setSavingNotes] = useState(false);
    const [staleOverrideKey, setStaleOverrideKey] = useState('');
    const completedTodos = Array.isArray(entry?.completedTodos)
        ? entry.completedTodos
        : [];

    const canAttachSave = Boolean(
        entry?.id &&
        entry.hasSave !== true &&
        !entry.versionId,
    );
    const expectedFileName = currentVersion?.originalFileName || '';
    const saveKey = latestSave
        ? `${latestSave.filePath}:${latestSave.modifiedAtMs || latestSave.modifiedAt}`
        : '';
    const staleUploadConfirmed = latestSave?.stale && staleOverrideKey === saveKey;

    const inspectLatestSave = useCallback(async () => {
        if (!canAttachSave) {
            setCheckingSave(false);
            return null;
        }
        if (!window.electronAPI?.getLatestCollaborationFile) {
            const result = {
                success: false,
                message: DESKTOP_UPLOAD_BRIDGE_UNAVAILABLE_MESSAGE,
            };
            setLatestSave(result);
            setCheckingSave(false);
            return result;
        }

        setCheckingSave(true);
        try {
            const result = await window.electronAPI.getLatestCollaborationFile(
                collaboration.game,
                expectedFileName,
            );
            setLatestSave(result);
            if (result?.success && !result.stale) setStaleOverrideKey('');
            return result;
        } catch (error) {
            const result = {
                success: false,
                message: error.message || 'The latest local save could not be inspected.',
            };
            setLatestSave(result);
            return result;
        } finally {
            setCheckingSave(false);
        }
    }, [canAttachSave, collaboration.game, expectedFileName]);

    useEffect(() => {
        inspectLatestSave();
    }, [inspectLatestSave]);

    const addImageUrls = (rawValue) => {
        const candidates = String(rawValue || '')
            .split(/[\s,]+/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (candidates.length === 0) return;
        if (candidates.some((value) => !isSafeHttpUrl(value))) {
            setModalMessage('Every attached image must use a valid http(s) URL.');
            return;
        }
        setImageUrls((current) => {
            const merged = [...new Set([...current, ...candidates])];
            if (merged.length > 10) {
                setModalMessage('A changelog entry can contain up to 10 images.');
            }
            return merged.slice(0, 10);
        });
        setImageInput('');
    };

    const handleImagePaste = (event) => {
        const pasted = event.clipboardData?.getData('text') || '';
        if (!pasted) return;
        event.preventDefault();
        addImageUrls(pasted);
    };

    const handleUploadNewest = async (event) => {
        event.preventDefault();
        if (!canAttachSave || !entry?.id) {
            setModalMessage('This changelog already has a save version.');
            return;
        }
        const note = text.trim();

        const selected = await inspectLatestSave();
        if (!selected?.success) {
            setModalMessage(selected?.message || 'The latest local save could not be found.');
            return;
        }

        const selectedKey = `${selected.filePath}:${selected.modifiedAtMs || selected.modifiedAt}`;
        if (selected.stale && staleOverrideKey !== selectedKey) {
            setStaleOverrideKey(selectedKey);
            return;
        }

        setUploading(true);
        let uploadId = null;
        let finalizationStarted = false;
        try {
            if (!supportsDesktopBackupUpload(window.electronAPI)) {
                throw new Error(DESKTOP_UPLOAD_BRIDGE_UNAVAILABLE_MESSAGE);
            }
            const [idToken, appCheckToken] = await Promise.all([
                auth.currentUser.getIdToken(true),
                getAppCheckTokenIfAvailable(),
            ]);
            const prepared = await window.electronAPI.prepareBackupForUpload(
                selected.filePath,
                idToken,
                appCheckToken,
            );
            if (!prepared?.success) {
                throw new Error(prepared?.message || 'Could not prepare the newest save.');
            }

            const result = await uploadPreparedDesktopBackup({
                api: window.electronAPI,
                preparedBackup: prepared,
                idToken,
                appCheckToken,
                ownershipConfirmed: true,
                hostingAccepted: true,
            });
            if (!result?.success) throw new Error(result?.message || 'Upload failed.');
            uploadId = result.uploadId;

            finalizationStarted = true;
            const finalized = await finalizeCollaborationVersion(
                uploadId,
                collaborationId,
                entry.id,
                note,
                imageUrls,
                completedTodos,
            );
            await onUploaded?.({
                ...finalized,
                localFilePath: selected.filePath,
            });
            setModalMessage(`Changelog and version ${finalized.versionNumber} uploaded.`);
            onClose();
        } catch (error) {
            if (uploadId && !finalizationStarted) {
                const abortUpload = httpsCallable(getFunctions(), 'abortBackupUpload');
                await abortUpload({ uploadId }).catch(() => null);
            }
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setUploading(false);
        }
    };

    const handleSaveNotes = async () => {
        if (!entry?.id) {
            setModalMessage('The changelog entry is not available yet.');
            return;
        }
        setSavingNotes(true);
        try {
            await updateCollaborationChangelogEntry(
                collaborationId,
                entry.id,
                text.trim(),
                imageUrls,
                completedTodos,
            );
            await onUploaded?.();
            setModalMessage('Changelog saved.');
            onClose();
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setSavingNotes(false);
        }
    };

    const saveStatus = useMemo(() => {
        if (checkingSave) {
            return {
                tone: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100',
                icon: ICONS.clock,
                title: 'Checking the newest local save…',
            };
        }
        if (!latestSave?.success) {
            return {
                tone: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100',
                icon: ICONS.xCircle,
                title: latestSave?.message || 'No matching local save found.',
            };
        }
        if (latestSave.stale) {
            return {
                tone: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
                icon: ICONS.infoCircle,
                title: staleUploadConfirmed
                    ? 'This save is still older than two minutes.'
                    : 'Save in the game before uploading.',
            };
        }
        return {
            tone: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100',
            icon: ICONS.checkCircle,
            title: 'The newest save is recent.',
        };
    }, [checkingSave, latestSave, staleUploadConfirmed]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-5"
            onClick={() => !uploading && !savingNotes && onClose()}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="collaboration-changelog-title"
                className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="h-2 flex-none" style={{ backgroundColor: accentColor }} />
                <header className="flex flex-none items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-700 sm:px-6">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: accentColor }}>
                            {canAttachSave ? 'Build finished' : 'Your changelog'}
                        </p>
                        <h2 id="collaboration-changelog-title" className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                            {canAttachSave
                                ? 'Complete changelog & provide save'
                                : 'Edit changelog'}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {canAttachSave
                                ? 'You can save the notes now and provide your newest local save now or later.'
                                : 'Only you can change the notes and images for this build turn.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={uploading || savingNotes}
                        className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        aria-label="Close changelog dialog"
                    >
                        <Icon path={ICONS.xMark} className="h-5 w-5" />
                    </button>
                </header>

                <form
                    id="collaboration-changelog-upload-form"
                    onSubmit={canAttachSave
                        ? handleUploadNewest
                        : (event) => {
                            event.preventDefault();
                            handleSaveNotes();
                        }}
                    className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6"
                >
                    {canAttachSave && (
                        <div className={`rounded-xl border p-4 ${saveStatus.tone}`}>
                            <div className="flex items-start gap-3">
                                <Icon path={saveStatus.icon} className="mt-0.5 h-5 w-5 flex-none" />
                                <div className="min-w-0 flex-1">
                                    <p className="font-bold">{saveStatus.title}</p>
                                    {latestSave?.success && (
                                        <>
                                            <p className="mt-1 break-all text-sm">
                                                {latestSave.fileName} · {formatBytes(latestSave.fileSize)}
                                            </p>
                                            <p className="mt-1 text-xs opacity-80">
                                                Last saved {formatSaveAge(latestSave.ageMs)}
                                                {!latestSave.nameMatchesExpected && expectedFileName
                                                    ? ` · local name differs from ${expectedFileName}`
                                                    : ''}
                                            </p>
                                            {latestSave.stale && !staleUploadConfirmed && (
                                                <p className="mt-2 text-sm font-semibold">
                                                    Save now in {game?.shortName || 'the game'}, then click Upload newest again.
                                                    A second click without a newer save lets you upload anyway.
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={inspectLatestSave}
                                    disabled={checkingSave || uploading}
                                    className="rounded-lg border border-current/25 px-3 py-1.5 text-xs font-bold hover:bg-white/30 disabled:opacity-40"
                                >
                                    Refresh
                                </button>
                            </div>
                        </div>
                    )}

                    <div>
                        <label htmlFor="collaboration-changelog-text" className="mb-2 block font-bold text-gray-800 dark:text-gray-200">
                            What changed?
                        </label>
                        <textarea
                            id="collaboration-changelog-text"
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            rows={4}
                            maxLength={1000}
                            placeholder="e.g. Finished the entrance plaza and reworked the queue"
                            className="w-full resize-y rounded-xl border border-gray-300 bg-white p-3 text-gray-900 outline-none focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                            style={{ '--tw-ring-color': accentColor }}
                        />
                        <p className="mt-1 text-right text-xs text-gray-400">{text.length}/1000</p>
                    </div>

                    {completedTodos.length > 0 && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/25">
                            <p className="font-bold text-emerald-900 dark:text-emerald-100">
                                Completed during this build
                            </p>
                            <ul className="mt-3 space-y-2">
                                {completedTodos.map((todo) => (
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

                    <div>
                        <label htmlFor="collaboration-changelog-image" className="mb-2 block font-bold text-gray-800 dark:text-gray-200">
                            Attach image URLs
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="collaboration-changelog-image"
                                type="url"
                                value={imageInput}
                                onChange={(event) => setImageInput(event.target.value)}
                                onPaste={handleImagePaste}
                                placeholder="https://…"
                                className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                                style={{ '--tw-ring-color': accentColor }}
                            />
                            <button
                                type="button"
                                onClick={() => addImageUrls(imageInput)}
                                disabled={!imageInput.trim() || imageUrls.length >= 10}
                                className="rounded-xl border border-gray-300 px-3 font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                aria-label="Attach image URL"
                            >
                                <Icon path={ICONS.plus} className="h-5 w-5" />
                            </button>
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Images use the same external URL model as other site galleries and are not stored in R2.
                        </p>
                    </div>

                    {imageUrls.length > 0 && (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {imageUrls.map((url, index) => (
                                <div key={url} className="relative aspect-video overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-gray-700">
                                    <img src={url} alt={`Changelog attachment ${index + 1}`} className="h-full w-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => setImageUrls((current) => current.filter((item) => item !== url))}
                                        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-600"
                                        aria-label={`Remove image ${index + 1}`}
                                    >
                                        <Icon path={ICONS.xMark} className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </form>

                <footer className="flex flex-none flex-col-reverse gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-700 sm:flex-row sm:justify-end sm:px-6">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={uploading || savingNotes}
                        className="rounded-xl border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                        {canAttachSave ? 'Do this later' : 'Cancel'}
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveNotes}
                        disabled={uploading || savingNotes}
                        className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-5 py-2.5 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                        {savingNotes ? <Spinner size="small" /> : <Icon path={ICONS.edit} className="h-5 w-5" />}
                        {savingNotes ? 'Saving…' : (canAttachSave ? 'Save notes only' : 'Save changes')}
                    </button>
                    {canAttachSave && (
                        <button
                            type="submit"
                            form="collaboration-changelog-upload-form"
                            disabled={uploading || savingNotes || checkingSave || !latestSave?.success}
                            className="flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ backgroundColor: accentColor }}
                        >
                            {uploading ? <Spinner size="small" /> : <Icon path={ICONS.share} className="h-5 w-5" />}
                            {uploading
                                ? 'Uploading…'
                                : (staleUploadConfirmed ? 'Upload newest anyway' : 'Upload newest')}
                        </button>
                    )}
                </footer>
                <p className="sr-only">Each changelog upload retains {retentionLimit} versions per contributor.</p>
            </section>
        </div>
    );
};

export default CollaborationChangelogModal;
