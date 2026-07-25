import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createCollaboration, fetchCollaborationById, updateCollaborationSettings } from '../../firebase/collaboration';
import { getGameColor, ICONS } from '../../utils/helpers';
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

const WIZARD_STEPS = [
    { id: 'details', label: 'Details' },
    { id: 'access', label: 'Access' },
    { id: 'review', label: 'Review' },
];

const inputClass = [
    'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-gray-900',
    'placeholder:text-gray-400 transition focus:border-[--game-color]',
    'focus:outline-none focus:ring-2 focus:ring-[--game-color]/25',
    'dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
].join(' ');

// Erstellen einer Collaboration im gleichen Wizard-Stil wie CreationForm/EventForm.
const CreateCollaborationForm = ({ user, setModalMessage }) => {
    const navigate = useNavigate();
    const { collaborationId } = useParams();
    const isEdit = Boolean(collaborationId);
    const [prefilling, setPrefilling] = useState(isEdit);
    const [loading, setLoading] = useState(false);
    const [activeStep, setActiveStep] = useState('details');
    const [mobileOpen, setMobileOpen] = useState(false);
    const [completedSteps, setCompletedSteps] = useState([]);
    const [form, setForm] = useState({
        title: '',
        description: '',
        game: 'planet-coaster-2',
        joinMode: 'invite',
        password: '',
    });

    const gameTabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const color = getGameColor(form.game);
    const activeStepIndex = WIZARD_STEPS.findIndex((s) => s.id === activeStep);
    const isLastStep = activeStepIndex === WIZARD_STEPS.length - 1;

    const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

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
                    joinMode: c.joinMode || 'invite',
                    password: '',
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
        }
        if (stepId === 'access' && !isEdit && form.joinMode === 'password' && form.password.trim().length < 4) {
            return 'Join password must be at least 4 characters.';
        }
        return null;
    };

    const goToStep = (stepId) => {
        setActiveStep(stepId);
        setMobileOpen(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSubmit = async () => {
        for (const step of WIZARD_STEPS) {
            const error = validateStep(step.id);
            if (error) {
                goToStep(step.id);
                setModalMessage(error);
                return;
            }
        }
        setLoading(true);
        try {
            const base = {
                title: form.title.trim(),
                description: form.description.trim(),
                joinMode: form.joinMode,
            };
            if (form.joinMode === 'password' && form.password.trim()) base.password = form.password.trim();
            if (isEdit) {
                await updateCollaborationSettings(collaborationId, base);
                setModalMessage('Collaboration updated.');
                navigate(`/collaboration/${collaborationId}`);
            } else {
                const newId = await createCollaboration(user.uid, { ...base, game: form.game });
                setModalMessage('Collaboration created successfully!');
                navigate(`/collaboration/${newId}`);
            }
        } catch (error) {
            console.error('Error saving collaboration:', error);
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
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
            goToStep(WIZARD_STEPS[activeStepIndex + 1].id);
        }
    };

    const goBack = () => {
        if (activeStepIndex > 0) goToStep(WIZARD_STEPS[activeStepIndex - 1].id);
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
                    </div>
                );

            case 'access':
                return (
                    <div className="space-y-5">
                        <p className="text-center text-gray-500 dark:text-gray-400">
                            Choose how people can join. This keeps unwanted members out.
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <h1 className="mb-6 text-center text-3xl font-bold text-gray-800 dark:text-gray-100">
                {isEdit ? 'Edit Collaboration' : 'New Collaboration'}
            </h1>
            <form onSubmit={(e) => { e.preventDefault(); goNext(); }}>
                <div className="lg:flex lg:items-start lg:gap-6">
                    <nav className={`${mobileOpen ? 'hidden' : 'block'} lg:block lg:w-64 lg:flex-shrink-0`}>
                        <div className="rounded-2xl bg-white p-2 shadow-md dark:bg-gray-800">
                            {WIZARD_STEPS.map((step, index) => {
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
                                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{WIZARD_STEPS[activeStepIndex].label}</h2>
                                <span className="absolute right-0 text-sm text-gray-400">{activeStepIndex + 1} / {WIZARD_STEPS.length}</span>
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
                                        {loading ? <Spinner size="small" /> : isLastStep ? (isEdit ? 'Save Changes' : 'Create Collaboration') : (
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
