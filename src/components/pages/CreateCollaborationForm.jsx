import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { createCollaboration, fetchCollaborationById, updateCollaborationSettings } from '../../firebase/collaboration';
import { auth } from '../../firebase/config';
import { getAppCheckTokenIfAvailable } from '../../firebase/appCheck';
import { getGameColor, ICONS, isSafeHttpUrl } from '../../utils/helpers';
import { recordInstalledCollaborationVersion } from '../../utils/collaborationVersionUpdates';
import SelectBackupModal from '../modals/SelectBackupModal';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';

const GAMES = [
    { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
    { id: 'planet-zoo', name: 'Planet Zoo' },
];

const JOIN_MODES = [
    { id: 'invite', label: 'Invite only', hint: 'People join with an invite code or a direct invite from a member.', icon: ICONS.share },
    { id: 'password', label: 'Password', hint: 'Anyone with the collaboration password can join.', icon: ICONS.lockClosed },
    { id: 'application', label: 'Application', hint: 'People request to join and an owner approves them.', icon: ICONS.user },
];

const CREATE_WIZARD_STEPS = [
    { id: 'details', label: 'Details' },
    { id: 'save', label: 'Initial save' },
    { id: 'access', label: 'Access' },
    { id: 'review', label: 'Review' },
];

const EDIT_WIZARD_STEPS = CREATE_WIZARD_STEPS.filter((step) => step.id !== 'save');

const inputClass = [
    'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-gray-900',
    'placeholder:text-gray-400 transition focus:border-[--game-color]',
    'focus:outline-none focus:ring-2 focus:ring-[--game-color]/25',
    'dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
].join(' ');

const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const megabytes = bytes / (1024 * 1024);
    return megabytes < 1
        ? `${Math.round(megabytes * 1024)} KB`
        : `${megabytes.toFixed(1)} MB`;
};

// Erstellen einer Collaboration im gleichen Wizard-Stil wie CreationForm/EventForm.
const CreateCollaborationForm = ({ user, setModalMessage }) => {
    const navigate = useNavigate();
    const { collaborationId } = useParams();
    const isEdit = Boolean(collaborationId);
    const [prefilling, setPrefilling] = useState(isEdit);
    const [loading, setLoading] = useState(false);
    const [activeStep, setActiveStep] = useState('details');
    const [mobileOpen, setMobileOpen] = useState(true);
    const [completedSteps, setCompletedSteps] = useState([]);
    const [initialSave, setInitialSave] = useState(null);
    const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
    const [initialNote, setInitialNote] = useState('Initial save');
    const [galleryImageInput, setGalleryImageInput] = useState('');
    const [submissionStage, setSubmissionStage] = useState('');
    const [form, setForm] = useState({
        title: '',
        description: '',
        game: 'planet-coaster-2',
        visibility: 'unlisted',
        joinMode: 'invite',
        password: '',
        bannerImageUrl: '',
        galleryImageUrls: [],
    });

    const gameTabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const color = getGameColor(form.game);
    const isRunningInElectron = Boolean(window.electronAPI?.isElectron);
    const wizardSteps = isEdit ? EDIT_WIZARD_STEPS : CREATE_WIZARD_STEPS;
    const activeStepIndex = wizardSteps.findIndex((s) => s.id === activeStep);
    const isLastStep = activeStepIndex === wizardSteps.length - 1;

    const setField = (name, value) => {
        if (name === 'game' && value !== form.game) setInitialSave(null);
        setForm((prev) => ({ ...prev, [name]: value }));
    };

    // Edit-Modus: bestehende Collaboration laden und vorbefüllen (nur Owner).
    useEffect(() => {
        if (!isEdit) return undefined;
        let mounted = true;
        (async () => {
            try {
                const c = await fetchCollaborationById(collaborationId);
                if (!mounted) return;
                if (!c) {
                    setModalMessage('Collaboration not found.');
                    navigate('/communitys');
                    return;
                }
                if (c.ownerId !== user.uid) {
                    setModalMessage('Only the owner can edit this collaboration.');
                    navigate(`/collaboration/${collaborationId}`);
                    return;
                }
                setForm({
                    title: c.title || '',
                    description: c.description || '',
                    game: c.game || 'planet-coaster-2',
                    visibility: c.visibility === 'public' ? 'public' : 'unlisted',
                    joinMode: c.joinMode || 'invite',
                    password: '',
                    bannerImageUrl: c.bannerImageUrl || '',
                    galleryImageUrls: Array.isArray(c.galleryImageUrls)
                        ? c.galleryImageUrls.slice(0, 10)
                        : [],
                });
            } catch (err) {
                setModalMessage(`Error: ${err.message}`);
            } finally {
                if (mounted) setPrefilling(false);
            }
        })();
        return () => { mounted = false; };
    }, [isEdit, collaborationId, user, navigate, setModalMessage]);

    useEffect(() => {
        const timer = setTimeout(() => {
            const index = GAMES.findIndex((g) => g.id === form.game);
            const node = gameTabRefs.current[index];
            if (node) setGliderStyle({ left: node.offsetLeft, width: node.offsetWidth });
        }, 50);
        return () => clearTimeout(timer);
    }, [form.game, activeStep, mobileOpen]);

    const validateStep = (stepId) => {
        if (stepId === 'details') {
            const title = form.title.trim();
            if (title.length < 3) return 'Title must be at least 3 characters.';
            if (title.length > 50) return 'Title must be 50 characters or fewer.';
            if (form.description.length > 500) return 'Description must be 500 characters or fewer.';
            if (form.bannerImageUrl.trim() && !isSafeHttpUrl(form.bannerImageUrl)) {
                return 'The banner must use a valid http(s) URL.';
            }
            if (form.galleryImageUrls.length > 10) return 'The project gallery can contain up to 10 starting images.';
            if (form.galleryImageUrls.some((url) => !isSafeHttpUrl(url))) {
                return 'Every gallery image must use a valid http(s) URL.';
            }
        }
        if (stepId === 'save' && !isEdit) {
            if (!isRunningInElectron) return 'Creating a collaboration requires the PlanetCreations desktop client.';
            if (!initialSave?.filePath) return 'Choose the initial save file before continuing.';
            if (initialNote.length > 500) return 'The initial changelog note must be 500 characters or fewer.';
        }
        if (stepId === 'access' && !isEdit && form.joinMode === 'password' && form.password.trim().length < 4) {
            return 'Join password must be at least 4 characters.';
        }
        return null;
    };

    const handleChooseInitialSave = () => {
        if (!isRunningInElectron || !window.electronAPI?.listAllLocalCreationsAndBackups) {
            setModalMessage('Please use an up-to-date PlanetCreations desktop client to choose the initial save.');
            return;
        }
        setIsBackupModalOpen(true);
    };

    const handleInitialSaveSelected = (file) => {
        setIsBackupModalOpen(false);
        if (!file?.path) return;
        setInitialSave({
            filePath: file.path,
            fileName: file.name,
            fileSize: file.size,
            modifiedAt: file.modifiedAt,
        });
    };

    const addGalleryImageUrls = (rawValue) => {
        const candidates = String(rawValue || '')
            .split(/[\s,]+/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (candidates.length === 0) return;
        if (candidates.some((value) => !isSafeHttpUrl(value))) {
            setModalMessage('Every gallery image must use a valid http(s) URL.');
            return;
        }
        setForm((current) => {
            const merged = [...new Set([...current.galleryImageUrls, ...candidates])];
            if (merged.length > 10) {
                setModalMessage('The project gallery can contain up to 10 starting images.');
            }
            return { ...current, galleryImageUrls: merged.slice(0, 10) };
        });
        setGalleryImageInput('');
    };

    const handleGalleryImagePaste = (event) => {
        const pasted = event.clipboardData?.getData('text') || '';
        if (!pasted) return;
        event.preventDefault();
        addGalleryImageUrls(pasted);
    };

    const goToStep = (stepId) => {
        setActiveStep(stepId);
        setMobileOpen(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = async () => {
        for (const step of wizardSteps) {
            const error = validateStep(step.id);
            if (error) {
                goToStep(step.id);
                setModalMessage(error);
                return;
            }
        }
        setLoading(true);
        let initialUploadId = null;
        let creationStarted = false;
        try {
            const base = {
                title: form.title.trim(),
                description: form.description.trim(),
                visibility: form.visibility,
                joinMode: form.joinMode,
                bannerImageUrl: form.bannerImageUrl.trim(),
                galleryImageUrls: form.galleryImageUrls,
            };
            if (form.joinMode === 'password' && form.password.trim()) base.password = form.password.trim();
            if (isEdit) {
                await updateCollaborationSettings(collaborationId, base);
                setModalMessage('Collaboration updated.');
                navigate(`/collaboration/${collaborationId}`);
            } else {
                setSubmissionStage('Preparing initial save…');
                const [idToken, appCheckToken] = await Promise.all([
                    auth.currentUser.getIdToken(true),
                    getAppCheckTokenIfAvailable(),
                ]);
                const prepared = await window.electronAPI.prepareBackupForUpload(
                    initialSave.filePath,
                    idToken,
                    appCheckToken,
                );
                if (!prepared?.success) {
                    throw new Error(prepared?.message || 'Could not prepare the initial save.');
                }
                setSubmissionStage('Uploading initial save…');
                const getUploadUrl = httpsCallable(getFunctions(), 'getUploadUrl');
                const { data: upload } = await getUploadUrl({
                    fileName: prepared.fileName,
                    fileSize: prepared.fileSize,
                    ownershipConfirmed: true,
                    hostingAccepted: true,
                });
                initialUploadId = upload.uploadId;
                const uploadResult = await window.electronAPI.uploadBackupFile(
                    prepared.filePath,
                    upload.uploadUrl,
                    upload.contentType,
                );
                if (!uploadResult?.success) {
                    throw new Error(uploadResult?.message || 'Initial save upload failed.');
                }
                setSubmissionStage('Creating collaboration…');
                creationStarted = true;
                const created = await createCollaboration(user.uid, {
                    ...base,
                    game: form.game,
                    initialUploadId,
                    initialNote: initialNote.trim() || 'Initial save',
                });
                const newId = created.collaborationId;
                recordInstalledCollaborationVersion({
                    userId: user.uid,
                    collaborationId: newId,
                    gameId: form.game,
                    versionId: created.versionId,
                    versionNumber: created.versionNumber,
                    targetPath: initialSave.filePath,
                });
                setModalMessage('Collaboration created successfully!');
                navigate(`/collaboration/${newId}`);
            }
        } catch (error) {
            console.error('Error saving collaboration:', error);
            if (initialUploadId && !creationStarted) {
                const abortUpload = httpsCallable(getFunctions(), 'abortBackupUpload');
                await abortUpload({ uploadId: initialUploadId }).catch(() => null);
            }
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
            setSubmissionStage('');
        }
    };

    const goNext = () => {
        const error = validateStep(activeStep);
        if (error) {
            setCompletedSteps((prev) => prev.filter((s) => s !== activeStep));
            setModalMessage(error);
            return;
        }
        setCompletedSteps((prev) => (prev.includes(activeStep) ? prev : [...prev, activeStep]));
        if (isLastStep) {
            handleSubmit();
        } else {
            goToStep(wizardSteps[activeStepIndex + 1].id);
        }
    };

    const goBack = () => {
        if (activeStepIndex > 0) goToStep(wizardSteps[activeStepIndex - 1].id);
    };

    const selectedJoinMode = JOIN_MODES.find((m) => m.id === form.joinMode);

    const renderStep = () => {
        switch (activeStep) {
            case 'details':
                return (
                    <div className="space-y-6">
                        <div>
                            <label className="mb-2 block text-center font-bold text-gray-700 dark:text-gray-200">Game</label>
                            <div className="flex justify-center">
                                <div className="relative flex items-center rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-700">
                                    <div
                                        className="absolute h-full rounded-full transition-all duration-500 ease-in-out"
                                        style={{ ...gliderStyle, backgroundColor: color.hex }}
                                    />
                                    {GAMES.map((game, index) => (
                                        <button
                                            key={game.id}
                                            type="button"
                                            ref={(el) => (gameTabRefs.current[index] = el)}
                                            onClick={() => setField('game', game.id)}
                                            disabled={isEdit}
                                            className={`relative z-10 whitespace-nowrap rounded-full px-6 py-2 text-sm font-medium transition-colors duration-300 disabled:cursor-not-allowed sm:text-base ${
                                                form.game === game.id ? 'text-white' : 'text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white'
                                            }`}
                                        >
                                            {game.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {isEdit && (
                                <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">The game can't be changed after creation.</p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="collab-title" className="mb-2 block font-bold text-gray-700 dark:text-gray-200">
                                Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="collab-title"
                                type="text"
                                value={form.title}
                                onChange={(e) => setField('title', e.target.value)}
                                maxLength={50}
                                placeholder="e.g., My Awesome Theme Park"
                                className={inputClass}
                            />
                            <p className="mt-1 text-right text-xs text-gray-500 dark:text-gray-400">{form.title.length}/50</p>
                        </div>
                        <div>
                            <label htmlFor="collab-desc" className="mb-2 block font-bold text-gray-700 dark:text-gray-200">Description</label>
                            <textarea
                                id="collab-desc"
                                value={form.description}
                                onChange={(e) => setField('description', e.target.value)}
                                rows={4}
                                maxLength={500}
                                placeholder="What are you building together? Any goals?"
                                className={`${inputClass} resize-y`}
                            />
                            <p className="mt-1 text-right text-xs text-gray-500 dark:text-gray-400">{form.description.length}/500</p>
                        </div>
                        <div className="border-t border-gray-100 pt-6 dark:border-gray-700">
                            <label htmlFor="collab-banner" className="mb-2 block font-bold text-gray-700 dark:text-gray-200">
                                Banner image
                            </label>
                            <input
                                id="collab-banner"
                                type="url"
                                value={form.bannerImageUrl}
                                onChange={(event) => setField('bannerImageUrl', event.target.value)}
                                maxLength={2048}
                                placeholder="https://…"
                                className={inputClass}
                            />
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                This image fills the collaboration header. Leave it empty to use the light/dark theme card.
                            </p>
                            {isSafeHttpUrl(form.bannerImageUrl) && (
                                <img
                                    src={form.bannerImageUrl.trim()}
                                    alt="Collaboration banner preview"
                                    className="mt-3 h-40 w-full rounded-2xl border border-gray-200 object-cover dark:border-gray-700"
                                />
                            )}
                        </div>
                        <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <label htmlFor="collab-gallery-image" className="font-bold text-gray-700 dark:text-gray-200">
                                    Starting gallery images
                                </label>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                    {form.galleryImageUrls.length}/10
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    id="collab-gallery-image"
                                    type="url"
                                    value={galleryImageInput}
                                    onChange={(event) => setGalleryImageInput(event.target.value)}
                                    onPaste={handleGalleryImagePaste}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            addGalleryImageUrls(galleryImageInput);
                                        }
                                    }}
                                    maxLength={2048}
                                    placeholder="https://…"
                                    className={`${inputClass} min-w-0 flex-1`}
                                />
                                <button
                                    type="button"
                                    onClick={() => addGalleryImageUrls(galleryImageInput)}
                                    disabled={!galleryImageInput.trim() || form.galleryImageUrls.length >= 10}
                                    className="flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-gray-300 text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                    aria-label="Add gallery image URL"
                                >
                                    <Icon path={ICONS.plus} className="h-5 w-5" />
                                </button>
                            </div>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                Paste one or several external image URLs. They use the site's normal image model and are not stored in R2.
                            </p>
                            {form.galleryImageUrls.length > 0 && (
                                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    {form.galleryImageUrls.map((url, index) => (
                                        <div
                                            key={url}
                                            className="relative aspect-video overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-gray-700"
                                        >
                                            <img src={url} alt={`Starting gallery ${index + 1}`} className="h-full w-full object-cover" />
                                            <button
                                                type="button"
                                                onClick={() => setForm((current) => ({
                                                    ...current,
                                                    galleryImageUrls: current.galleryImageUrls.filter((item) => item !== url),
                                                }))}
                                                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-red-600"
                                                aria-label={`Remove gallery image ${index + 1}`}
                                            >
                                                <Icon path={ICONS.xMark} className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );

            case 'save':
                return (
                    <div className="space-y-5">
                        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                            <div className="flex gap-3">
                                <Icon path={ICONS.infoCircle} className="mt-0.5 h-5 w-5 flex-none" />
                                <div>
                                    <p className="font-bold">Every collaboration starts with version 1</p>
                                    <p className="mt-1 text-blue-700 dark:text-blue-300">
                                        The project is created only after this save has been signed, uploaded and validated.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {!isRunningInElectron ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-950/30">
                                <Icon path={ICONS.desktop} className="mx-auto h-9 w-9 text-amber-600 dark:text-amber-300" />
                                <h3 className="mt-3 font-bold text-amber-900 dark:text-amber-100">Desktop client required</h3>
                                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                                    Open this form in the PlanetCreations desktop client to select and sign the first save file.
                                </p>
                            </div>
                        ) : initialSave ? (
                            <div className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30 sm:flex-row sm:items-center">
                                <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-emerald-600 text-white">
                                    <Icon path={ICONS.checkCircle} className="h-6 w-6" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-bold text-emerald-900 dark:text-emerald-100">{initialSave.fileName || 'Selected save'}</p>
                                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                        {formatBytes(initialSave.fileSize) || 'Ready to prepare and upload'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleChooseInitialSave}
                                    className="rounded-xl border border-emerald-300 bg-white px-4 py-2.5 font-bold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-gray-900 dark:text-emerald-300"
                                >
                                    Replace
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handleChooseInitialSave}
                                className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-gray-300 px-6 py-10 text-center transition hover:border-[--game-color] hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-900/40"
                            >
                                <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: color.hex }}>
                                    <Icon path={ICONS.database} className="h-7 w-7" />
                                </span>
                                <span className="mt-4 font-bold text-gray-900 dark:text-white">Choose initial save file</span>
                                <span className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                    Only save formats belonging to {GAMES.find((game) => game.id === form.game)?.name} are accepted.
                                </span>
                            </button>
                        )}

                        <div>
                            <label htmlFor="initial-save-note" className="mb-2 block font-bold text-gray-700 dark:text-gray-200">
                                Version 1 changelog note
                            </label>
                            <textarea
                                id="initial-save-note"
                                value={initialNote}
                                onChange={(event) => setInitialNote(event.target.value)}
                                rows={3}
                                maxLength={500}
                                placeholder="What is included in this first save?"
                                className={`${inputClass} resize-y`}
                            />
                            <p className="mt-1 text-right text-xs text-gray-500 dark:text-gray-400">{initialNote.length}/500</p>
                        </div>
                    </div>
                );

            case 'access':
                return (
                    <div className="space-y-7">
                        <div>
                            <h3 className="text-center text-lg font-bold text-gray-900 dark:text-gray-100">
                                Overview visibility
                            </h3>
                            <p className="mx-auto mt-1 max-w-2xl text-center text-sm text-gray-500 dark:text-gray-400">
                                Public projects can be viewed from the overview. Visibility never grants membership or bypasses the join option below.
                            </p>
                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {[
                                    {
                                        id: 'public',
                                        label: 'Public on overview',
                                        hint: 'Other signed-in users see a card and can open a read-only project view.',
                                        icon: ICONS.eye,
                                    },
                                    {
                                        id: 'unlisted',
                                        label: 'Unlisted',
                                        hint: 'The project is absent from the overview and can only be found with its share code.',
                                        icon: ICONS.eyeSlash,
                                    },
                                ].map((option) => {
                                    const selected = form.visibility === option.id;
                                    return (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => setField('visibility', option.id)}
                                            aria-pressed={selected}
                                            style={selected ? { borderColor: color.hex } : undefined}
                                            className={`rounded-2xl border-2 p-4 text-center transition ${
                                                selected
                                                    ? 'shadow-md'
                                                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                                            }`}
                                        >
                                            <span
                                                className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-white"
                                                style={{ backgroundColor: selected ? color.hex : '#9CA3AF' }}
                                            >
                                                <Icon path={option.icon} className="h-5 w-5" />
                                            </span>
                                            <span className="block font-bold text-gray-800 dark:text-gray-100">{option.label}</span>
                                            <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400">{option.hint}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="border-t border-gray-100 pt-6 dark:border-gray-700">
                            <h3 className="text-center text-lg font-bold text-gray-900 dark:text-gray-100">
                                Joining
                            </h3>
                            <p className="text-center text-gray-500 dark:text-gray-400">
                                Choose how people can join. This keeps unwanted members out.
                            </p>
                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                {JOIN_MODES.map((mode) => {
                                    const selected = form.joinMode === mode.id;
                                    return (
                                        <button
                                            key={mode.id}
                                            type="button"
                                            onClick={() => setField('joinMode', mode.id)}
                                            aria-pressed={selected}
                                            style={selected ? { borderColor: color.hex } : undefined}
                                            className={`rounded-2xl border-2 p-4 text-left transition ${
                                                selected ? 'shadow-md' : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                                            }`}
                                        >
                                            <span
                                                className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-white"
                                                style={{ backgroundColor: selected ? color.hex : '#9CA3AF' }}
                                            >
                                                <Icon path={mode.icon} className="h-5 w-5" />
                                            </span>
                                            <span className="block font-bold text-gray-800 dark:text-gray-100">{mode.label}</span>
                                            <span className="block text-sm text-gray-500 dark:text-gray-400">{mode.hint}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {form.joinMode === 'password' && (
                                <div>
                                    <label htmlFor="collab-pw" className="mb-2 block font-bold text-gray-700 dark:text-gray-200">
                                        Join password <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id="collab-pw"
                                        type="text"
                                        value={form.password}
                                        onChange={(e) => setField('password', e.target.value)}
                                        placeholder="At least 4 characters"
                                        className={inputClass}
                                    />
                                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        {isEdit ? 'Leave blank to keep the current password.' : 'Share this password with people you want to join.'}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                );

            case 'review':
                return (
                    <div className="space-y-5">
                        <div className="rounded-2xl border border-gray-200 p-5 dark:border-gray-700">
                            <dl className="space-y-3">
                                <div className="flex justify-between gap-4">
                                    <dt className="font-semibold text-gray-500 dark:text-gray-400">Game</dt>
                                    <dd className="text-right font-bold text-gray-800 dark:text-gray-100">{GAMES.find((g) => g.id === form.game)?.name}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="font-semibold text-gray-500 dark:text-gray-400">Title</dt>
                                    <dd className="text-right font-bold text-gray-800 dark:text-gray-100">{form.title.trim() || '—'}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="font-semibold text-gray-500 dark:text-gray-400">Access</dt>
                                    <dd className="text-right font-bold text-gray-800 dark:text-gray-100">{selectedJoinMode?.label}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="font-semibold text-gray-500 dark:text-gray-400">Visibility</dt>
                                    <dd className="text-right font-bold text-gray-800 dark:text-gray-100">
                                        {form.visibility === 'public' ? 'Public on overview' : 'Unlisted'}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="font-semibold text-gray-500 dark:text-gray-400">Banner</dt>
                                    <dd className="text-right font-bold text-gray-800 dark:text-gray-100">
                                        {form.bannerImageUrl.trim() ? 'Custom image' : 'Theme card'}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="font-semibold text-gray-500 dark:text-gray-400">Starting gallery</dt>
                                    <dd className="text-right font-bold text-gray-800 dark:text-gray-100">
                                        {form.galleryImageUrls.length} {form.galleryImageUrls.length === 1 ? 'image' : 'images'}
                                    </dd>
                                </div>
                                {!isEdit && (
                                    <div className="flex justify-between gap-4">
                                        <dt className="font-semibold text-gray-500 dark:text-gray-400">Initial save</dt>
                                        <dd className="min-w-0 truncate text-right font-bold text-gray-800 dark:text-gray-100">
                                            {initialSave?.fileName || 'Required'}
                                        </dd>
                                    </div>
                                )}
                                {form.description.trim() && (
                                    <div>
                                        <dt className="mb-1 font-semibold text-gray-500 dark:text-gray-400">Description</dt>
                                        <dd className="whitespace-pre-wrap text-gray-700 dark:text-gray-200">{form.description.trim()}</dd>
                                    </div>
                                )}
                            </dl>
                        </div>
                        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                            <p className="mb-2 flex items-center gap-2 font-bold">
                                <Icon path={ICONS.infoCircle} className="h-5 w-5" />
                                How it works
                            </p>
                            <ul className="space-y-1">
                                <li>• You get an invite code to share; joining is gated by your Access choice.</li>
                                <li>• Only one person builds at a time — log on/off in the game overlay so nobody overwrites each other.</li>
                                <li>• Everyone keeps their last 3 versions (2 once the group passes 10 members) as a merge safety net.</li>
                                <li>• When it's done, publish it as one creation crediting everyone who worked on it.</li>
                            </ul>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    if (prefilling) {
        return (
            <div className="mt-16 flex justify-center">
                <Spinner />
            </div>
        );
    }

    return (
        <div className="mx-auto mt-10 max-w-5xl px-4" style={color.style}>
            <SelectBackupModal
                isOpen={isBackupModalOpen}
                onClose={() => setIsBackupModalOpen(false)}
                onFileSelect={handleInitialSaveSelected}
                game={form.game}
            />
            <h1 className="mb-6 text-center text-3xl font-bold text-gray-800 dark:text-gray-100">
                {isEdit ? 'Edit Collaboration' : 'New Collaboration'}
            </h1>
            <form onSubmit={(e) => { e.preventDefault(); goNext(); }}>
                <div className="lg:flex lg:items-start lg:gap-6">
                    <nav className={`${mobileOpen ? 'hidden' : 'block'} lg:block lg:w-64 lg:flex-shrink-0`}>
                        <div className="rounded-2xl bg-white p-2 shadow-md dark:bg-gray-800">
                            {wizardSteps.map((step, index) => {
                                const active = step.id === activeStep;
                                const completed = completedSteps.includes(step.id) && !validateStep(step.id);
                                return (
                                    <button
                                        key={step.id}
                                        type="button"
                                        onClick={() => goToStep(step.id)}
                                        style={active ? { backgroundColor: color.hex, color: '#fff' } : undefined}
                                        className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors last:mb-0 ${
                                            active ? '' : 'text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        <span
                                            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                                                completed ? 'bg-green-500 text-white' : active ? 'bg-white/20' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                                            }`}
                                        >
                                            {completed ? '✓' : index + 1}
                                        </span>
                                        <span className="min-w-0 flex-grow truncate text-sm font-semibold">{step.label}</span>
                                        <Icon path={ICONS.chevronRight} className={`h-4 w-4 flex-shrink-0 lg:hidden ${active ? 'text-white' : 'text-gray-300'}`} />
                                    </button>
                                );
                            })}
                        </div>
                    </nav>

                    <section className={`${mobileOpen ? 'block' : 'hidden'} mt-4 min-w-0 flex-1 lg:mt-0 lg:block`}>
                        <button
                            type="button"
                            onClick={() => setMobileOpen(false)}
                            className="mb-3 flex items-center gap-1 font-semibold lg:hidden"
                            style={{ color: color.hex }}
                        >
                            <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                            All steps
                        </button>

                        <div className="space-y-6 rounded-2xl bg-white p-6 shadow-md dark:bg-gray-800 sm:p-8">
                            <div className="relative flex items-center justify-center">
                                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{wizardSteps[activeStepIndex].label}</h2>
                                <span className="absolute right-0 text-sm text-gray-400">{activeStepIndex + 1} / {wizardSteps.length}</span>
                            </div>

                            {renderStep()}

                            <div className="flex items-center justify-between gap-4 border-t border-gray-100 pt-6 dark:border-gray-700">
                                <button
                                    type="button"
                                    onClick={() => navigate(-1)}
                                    disabled={loading}
                                    className="rounded-xl bg-gray-200 px-5 py-2.5 font-bold text-gray-800 transition hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                >
                                    Cancel
                                </button>
                                <div className="flex items-center gap-2">
                                    {activeStepIndex > 0 && (
                                        <button
                                            type="button"
                                            onClick={goBack}
                                            disabled={loading}
                                            className="flex items-center gap-1 rounded-xl px-4 py-2.5 font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
                                        >
                                            <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                                            Back
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={goNext}
                                        disabled={loading}
                                        style={{ backgroundColor: color.hex }}
                                        className="flex items-center gap-2 rounded-xl px-6 py-2.5 font-bold text-white transition hover:brightness-95 disabled:opacity-50"
                                    >
                                        {loading ? (
                                            <>
                                                <Spinner size="small" />
                                                <span>{submissionStage || 'Saving…'}</span>
                                            </>
                                        ) : isLastStep ? (isEdit ? 'Save Changes' : 'Create Collaboration') : (
                                            <>
                                                Next
                                                <Icon path={ICONS.chevronRight} className="h-5 w-5" />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </form>
        </div>
    );
};

export default CreateCollaborationForm;
