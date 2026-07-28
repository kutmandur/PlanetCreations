import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { setCommunityJoinPassword } from '../../firebase/community';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import InfoBox from '../ui/InfoBox';
import BannerImageSizeTooltip from '../community/BannerImageSizeTooltip';
import {
  getGameColor,
  ICONS,
  SOCIAL_PLATFORMS,
} from '../../utils/helpers';
import { scheduleDataRefresh } from '../../utils/appRefresh';
import { getDefaultGameId, getGames } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import RankPermissionsEditor, {
  FixedRankPermissionsInfo,
} from '../community/RankPermissionsEditor';
import {
  COMMUNITY_PERMISSION_DEFINITIONS,
  getRankPermissionFields,
  getRankPermissionValue,
  withDefaultRankPermissions,
} from '../../utils/communityPermissions';
import {
  cleanCommunitySocialLinks,
  COMMUNITY_JOIN_MODES,
  getCommunityWizardStepError,
  getFirstCommunityWizardError,
  slugifyCommunityName,
} from '../../utils/communityWizard';

const API_BASE_URL =
  'https://us-central1-planetcreationsdotnet.cloudfunctions.net/api';
const DISCORD_BOT_URL =
  'https://discord.com/oauth2/authorize?client_id=1407474623511269427&permissions=268435456&integration_type=0&scope=bot';
const GRAB_HANDLE_ICON =
  'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5';

const WIZARD_STEPS = [
  { id: 'basics', label: 'Basics', hint: 'Name & description' },
  { id: 'appearance', label: 'Appearance', hint: 'Color & images' },
  { id: 'games', label: 'Games', hint: 'Supported & main game' },
  { id: 'membership', label: 'Membership & Privacy', hint: 'Joining & visibility' },
  { id: 'connections', label: 'Connections', hint: 'Social links & Discord' },
  { id: 'ranks', label: 'Ranks & Permissions', hint: 'Roles & access' },
  { id: 'review', label: 'Review', hint: 'Check & create' },
];

const VALIDATED_STEP_IDS = WIZARD_STEPS
  .map(step => step.id)
  .filter(stepId => stepId !== 'review');

const inputClass =
  'w-full p-3 border rounded-xl bg-white focus:outline-none focus:ring-2 community-ring';

const StepIntro = ({ title, description, optional = false }) => (
  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-bold text-gray-800">{title}</h3>
      {optional && (
        <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600">
          Optional
        </span>
      )}
    </div>
    <p className="mt-1 text-sm text-gray-500">{description}</p>
  </div>
);

const ReviewRow = ({ label, value, onEdit }) => (
  <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-3 last:border-0">
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1 text-sm font-semibold text-gray-800 break-words">{value}</div>
    </div>
    <button
      type="button"
      onClick={onEdit}
      className="flex-shrink-0 text-sm font-semibold community-text hover:underline"
    >
      Edit
    </button>
  </div>
);

const CommunityPagePreview = ({
  bannerImageUrl,
  description,
  name,
  themeColor,
}) => (
  <section aria-label="Community page preview">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="font-bold text-gray-800">Community Page Preview</h3>
      <span className="text-xs text-gray-400">Updates live</span>
    </div>
    <div
      className="overflow-hidden rounded-2xl border bg-gray-100 shadow-sm dark:border-gray-700 dark:bg-gray-950"
      style={{ '--theme-color': themeColor }}
    >
      <div className="relative h-32 bg-gray-300 dark:bg-gray-700 sm:h-44">
        {bannerImageUrl ? (
          <img
            src={bannerImageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-500 dark:text-gray-300">
            Community Banner
          </div>
        )}
      </div>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid items-start gap-4 sm:grid-cols-[9rem_1fr_9rem]">
          <button
            type="button"
            tabIndex={-1}
            className="rounded-lg community-bg px-3 py-2 text-sm font-bold text-white"
          >
            Back to Hub
          </button>
          <div className="text-center">
            <p className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {name.trim() || 'Your Community'}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-300">
              {description.trim() || 'Your community description will appear here.'}
            </p>
          </div>
          <div className="hidden h-9 sm:block" />
        </div>

        <div className="flex justify-center">
          <div className="relative flex items-center rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-700">
            <span className="rounded-full community-bg px-5 py-2 text-xs font-bold text-white">
              Creations
            </span>
            <span className="px-5 py-2 text-xs font-semibold text-gray-500 dark:text-gray-300">
              Events
            </span>
            <span className="hidden px-5 py-2 text-xs font-semibold text-gray-500 dark:text-gray-300 sm:inline">
              Members
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map(item => (
            <div
              key={item}
              className={`${item === 2 ? 'hidden sm:block' : ''} overflow-hidden rounded-lg bg-white shadow dark:bg-gray-800`}
            >
              <div className="h-12 bg-gray-200 dark:bg-gray-700" />
              <div className="space-y-2 p-3">
                <div
                  className="h-2.5 w-2/3 rounded-full"
                  style={{ backgroundColor: themeColor }}
                />
                <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-600" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

const CreateCommunityForm = ({ setModalMessage, blacklist, userProfile }) => {
  const games = useGames();
  const navigate = useNavigate();
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  const mainGamePillRefs = useRef([]);
  const mainGameGliderRef = useRef(null);

  const [activeStep, setActiveStep] = useState('basics');
  const [completedSteps, setCompletedSteps] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerImageUrl, setBannerImageUrl] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [themeColor, setThemeColor] = useState('#6B7280');
  const [allowedGames, setAllowedGames] = useState(() =>
    getGames().map(game => game.id));
  const [mainGame, setMainGame] = useState(getDefaultGameId());

  const [joinMode, setJoinMode] = useState('open');
  const [joinPassword, setJoinPassword] = useState('');
  const [allowApplicationMessage, setAllowApplicationMessage] = useState(false);
  const [membersOnlyInfoPage, setMembersOnlyInfoPage] = useState(false);

  const [socialLinks, setSocialLinks] = useState({});
  const [discordServerId, setDiscordServerId] = useState('');
  const [showDiscordInput, setShowDiscordInput] = useState(false);
  const [suggestedRanks, setSuggestedRanks] = useState([]);
  const [isFetchingRanks, setIsFetchingRanks] = useState(false);

  const [ranks, setRanks] = useState([
    withDefaultRankPermissions({
      name: 'Member',
      color: '#6B7280',
      imageUrl: '',
      discordRoleId: '',
    }),
  ]);
  const [defaultRankIndex, setDefaultRankIndex] = useState(0);
  const [ownerRankData, setOwnerRankData] = useState({
    name: 'Owner',
    color: '#EF4444',
    imageUrl: '',
  });
  const [moderatorRankData, setModeratorRankData] = useState(
    withDefaultRankPermissions({
      name: 'Moderator',
      color: '#3B82F6',
      imageUrl: '',
      discordRoleId: '',
    }, 'moderator')
  );

  const activeStepIndex = WIZARD_STEPS.findIndex(step => step.id === activeStep);
  const activeStepMeta = WIZARD_STEPS[activeStepIndex] || WIZARD_STEPS[0];
  const isLastStep = activeStep === 'review';

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const visible = activeStep === 'appearance';
    window.dispatchEvent(new CustomEvent('pc-theme-coachmark', {
      detail: visible,
    }));
    return () => {
      if (visible) {
        window.dispatchEvent(new CustomEvent('pc-theme-coachmark', {
          detail: false,
        }));
      }
    };
  }, [activeStep]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const positionGlider = () => {
      const mainGameOptions = games.filter(game =>
        allowedGames.includes(game.id));
      const selectedIndex = mainGameOptions.findIndex(game =>
        game.id === mainGame);
      const selectedPill = mainGamePillRefs.current[selectedIndex];
      if (!selectedPill || !mainGameGliderRef.current) return;
      mainGameGliderRef.current.style.left = `${selectedPill.offsetLeft}px`;
      mainGameGliderRef.current.style.width = `${selectedPill.offsetWidth}px`;
    };
    const animationFrame = window.requestAnimationFrame(positionGlider);
    window.addEventListener('resize', positionGlider);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', positionGlider);
    };
  }, [allowedGames, games, mainGame]);

  const getWizardState = () => ({
    name,
    description,
    bannerImageUrl,
    profileImageUrl,
    allowedGames,
    mainGame,
    joinMode,
    joinPassword,
    socialLinks,
    discordServerId,
    ranks,
    defaultRankIndex,
    ownerRankData,
    moderatorRankData,
  });

  const openStep = (stepId) => {
    setActiveStep(stepId);
    setMobileOpen(true);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const validateStep = (stepId, showMessage = true) => {
    const error = getCommunityWizardStepError(
      stepId,
      getWizardState(),
      blacklist
    );
    if (error && showMessage) setModalMessage(error);
    return !error;
  };

  const goNext = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!validateStep(activeStep)) return;
    setCompletedSteps(previous =>
      previous.includes(activeStep) ? previous : [...previous, activeStep]);
    const nextStep = WIZARD_STEPS[activeStepIndex + 1];
    if (nextStep) openStep(nextStep.id);
  };

  const goPrevious = () => {
    const previousStep = WIZARD_STEPS[activeStepIndex - 1];
    if (previousStep) openStep(previousStep.id);
  };

  const handleGameToggle = (gameId) => {
    setAllowedGames(previous => {
      if (previous.includes(gameId)) {
        if (previous.length === 1) {
          setModalMessage('A community must support at least one game.');
          return previous;
        }
        const next = previous.filter(id => id !== gameId);
        if (mainGame === gameId) setMainGame(next[0]);
        return next;
      }
      const next = [...previous, gameId];
      if (!mainGame) setMainGame(gameId);
      return next;
    });
  };

  const handleRankChange = (index, field, value) => {
    setRanks(previous => previous.map((rank, rankIndex) =>
      rankIndex === index ? { ...rank, [field]: value } : rank));
  };

  const addRank = (rankName = '', color = '#4F46E5', discordRoleId = '') => {
    if (ranks.length >= 90) return;
    setRanks(previous => [
      ...previous,
      withDefaultRankPermissions({
        name: rankName,
        color,
        imageUrl: '',
        discordRoleId,
      }),
    ]);
  };

  const removeRank = (index) => {
    if (ranks.length <= 1) {
      setModalMessage('You must have at least one custom rank.');
      return;
    }
    setRanks(previous => previous.filter((_, rankIndex) => rankIndex !== index));
    setDefaultRankIndex(previous => {
      if (index === previous) return 0;
      return index < previous ? previous - 1 : previous;
    });
  };

  const handleRankSort = () => {
    if (
      dragItem.current === null ||
      dragOverItem.current === null ||
      dragItem.current === dragOverItem.current
    ) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }
    const next = [...ranks];
    const previousDefaultRank = ranks[defaultRankIndex];
    const [movedRank] = next.splice(dragItem.current, 1);
    next.splice(dragOverItem.current, 0, movedRank);
    setRanks(next);
    setDefaultRankIndex(Math.max(0, next.indexOf(previousDefaultRank)));
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const fetchDiscordRanks = useCallback(async () => {
    const serverId = discordServerId.trim();
    if (!/^\d{17,20}$/.test(serverId)) {
      setModalMessage('Enter a valid Discord Server ID before importing ranks.');
      return;
    }
    setIsFetchingRanks(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/getDiscordRoles?serverId=${serverId}`
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setSuggestedRanks(await response.json());
      setModalMessage('Discord ranks imported. Add the ones you want below.');
    } catch (error) {
      setModalMessage(`Could not import Discord ranks: ${error.message}`);
    } finally {
      setIsFetchingRanks(false);
    }
  }, [discordServerId, setModalMessage]);

  const getTextColorForBackground = (hexColor) => {
    if (!hexColor || hexColor === '#000000') return '#ffffff';
    const red = parseInt(hexColor.slice(1, 3), 16);
    const green = parseInt(hexColor.slice(3, 5), 16);
    const blue = parseInt(hexColor.slice(5, 7), 16);
    return ((red * 299) + (green * 587) + (blue * 114)) / 1000 >= 128
      ? '#000000'
      : '#ffffff';
  };

  const buildRanks = () => {
    const specialRanks = [
      {
        ...ownerRankData,
        name: 'Owner',
        weight: 0,
        discordRoleId: '',
      },
      {
        ...moderatorRankData,
        ...getRankPermissionFields(moderatorRankData, 'moderator'),
        name: 'Moderator',
        weight: 1,
      },
    ];
    const customRanks = ranks.map((rank, index) => ({
      name: rank.name.trim(),
      color: rank.color,
      imageUrl: rank.imageUrl || '',
      discordRoleId: rank.discordRoleId || '',
      ...getRankPermissionFields(rank),
      weight: specialRanks.length + index,
    }));
    return [...specialRanks, ...customRanks];
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isLastStep) {
      goNext(event);
      return;
    }

    const firstError = getFirstCommunityWizardError(
      VALIDATED_STEP_IDS,
      getWizardState(),
      blacklist
    );
    if (firstError) {
      setModalMessage(firstError.error);
      openStep(firstError.stepId);
      return;
    }

    setLoading(true);
    let communityRef = null;
    let ownerMembershipCreated = false;
    try {
      await auth.currentUser?.getIdToken(true);
      const slug = slugifyCommunityName(name);
      const duplicateChecks = [
        getDocs(query(collection(db, 'communitys'), where('slug', '==', slug))),
      ];
      const trimmedDiscordServerId = discordServerId.trim();
      if (trimmedDiscordServerId) {
        duplicateChecks.push(getDocs(query(
          collection(db, 'communitys'),
          where('discordServerId', '==', trimmedDiscordServerId)
        )));
      }
      const [slugSnapshot, discordSnapshot] = await Promise.all(duplicateChecks);
      if (!slugSnapshot.empty) {
        setModalMessage('A community with this name already exists.');
        openStep('basics');
        return;
      }
      if (discordSnapshot && !discordSnapshot.empty) {
        setModalMessage('This Discord server is already linked to another community.');
        openStep('connections');
        return;
      }

      const finalMainGame = allowedGames.includes(mainGame)
        ? mainGame
        : allowedGames[0];
      const defaultRankName = ranks[defaultRankIndex].name.trim();
      const initialJoinMode = joinMode === 'password' ? 'invite' : joinMode;

      communityRef = await addDoc(collection(db, 'communitys'), {
        name: name.trim(),
        slug,
        description: description.trim(),
        bannerImageUrl: bannerImageUrl.trim(),
        profileImageUrl: profileImageUrl.trim(),
        themeColor,
        ownerId: auth.currentUser.uid,
        ownerUsername: userProfile?.username || '',
        ranks: buildRanks(),
        defaultRankName,
        joinMode: initialJoinMode,
        allowApplicationMessage:
          joinMode === 'application' && allowApplicationMessage,
        hasJoinPassword: false,
        membersOnlyInfoPage,
        allowedGames,
        mainGame: finalMainGame,
        socialLinks: cleanCommunitySocialLinks(socialLinks),
        discordServerId: trimmedDiscordServerId,
      });

      const batch = writeBatch(db);
      batch.set(
        doc(db, 'communitys', communityRef.id, 'members', auth.currentUser.uid),
        {
          roles: ['owner'],
          joinedAt: new Date(),
          username: userProfile?.username || '',
        }
      );
      batch.set(
        doc(
          db,
          'profiles',
          auth.currentUser.uid,
          'communityMemberships',
          communityRef.id
        ),
        {
          communityId: communityRef.id,
          communityName: name.trim(),
          roles: ['owner'],
          joinedAt: new Date(),
        }
      );
      await batch.commit();
      ownerMembershipCreated = true;

      let passwordWarning = '';
      if (joinMode === 'password') {
        try {
          await setCommunityJoinPassword(communityRef.id, joinPassword);
        } catch {
          passwordWarning =
            ' The password could not be activated, so the community remains invite-only. Configure it in Membership settings.';
        }
      }

      setModalMessage(`Community created successfully!${passwordWarning}`);
      scheduleDataRefresh();
      navigate(`/community/${slug}`);
    } catch (error) {
      if (communityRef && !ownerMembershipCreated) {
        await deleteDoc(communityRef).catch(() => null);
      }
      setModalMessage(`Error creating community: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderBasics = () => (
    <>
      <StepIntro
        title="Start with a clear identity"
        description="The community name becomes part of its URL and can normally only be changed by a site admin later."
      />
      <div>
        <label className="mb-2 block font-bold text-gray-700">
          Community Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          maxLength={100}
          onChange={event => setName(event.target.value)}
          className={inputClass}
          placeholder="Coaster Builders"
        />
        <p className="mt-1 text-xs text-gray-400">
          URL preview: /community/{slugifyCommunityName(name) || 'your-community'}
        </p>
      </div>
      <div>
        <label className="mb-2 block font-bold text-gray-700">
          Description <span className="text-red-500">*</span>
        </label>
        <textarea
          value={description}
          maxLength={2000}
          rows={7}
          onChange={event => setDescription(event.target.value)}
          className={inputClass}
          placeholder="What is this community about, and who is it for?"
        />
        <p className="mt-1 text-right text-xs text-gray-400">
          {description.length} / 2,000
        </p>
      </div>
    </>
  );

  const renderAppearance = () => (
    <>
      <StepIntro
        title="Make the community recognizable"
        description="Choose the accent color and images shown on the community page and cards. You can refine custom creation-card fields later in Settings."
        optional
      />
      <div>
        <label className="mb-2 block font-bold text-gray-700">Theme Color</label>
        <div className="flex items-center gap-4">
          <input
            type="color"
            value={themeColor}
            onChange={event => setThemeColor(event.target.value)}
            className="h-12 w-20 cursor-pointer rounded-xl border p-1"
          />
          <div
            className="flex h-12 flex-grow items-center justify-center rounded-xl font-mono font-bold text-white"
            style={{ backgroundColor: themeColor }}
          >
            {themeColor.toUpperCase()}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center gap-2">
          <label className="block font-bold text-gray-700">Banner Image URL</label>
          <BannerImageSizeTooltip />
        </div>
        <input
          type="url"
          value={bannerImageUrl}
          onChange={event => setBannerImageUrl(event.target.value)}
          className={inputClass}
          placeholder="https://..."
        />
        <div className="mt-2"><InfoBox /></div>
        {bannerImageUrl && (
          <img
            src={bannerImageUrl}
            alt="Banner preview"
            className="mt-3 h-36 w-full rounded-xl border object-cover"
          />
        )}
      </div>
      <div>
        <label className="mb-2 block font-bold text-gray-700">
          Profile Image URL (Square)
        </label>
        <input
          type="url"
          value={profileImageUrl}
          onChange={event => setProfileImageUrl(event.target.value)}
          className={inputClass}
          placeholder="https://..."
        />
        <div className="mt-2"><InfoBox /></div>
        {profileImageUrl && (
          <img
            src={profileImageUrl}
            alt="Profile preview"
            className="mt-3 h-24 w-24 rounded-full border-4 object-cover"
            style={{ borderColor: themeColor }}
          />
        )}
      </div>
      <CommunityPagePreview
        bannerImageUrl={bannerImageUrl}
        description={description}
        name={name}
        themeColor={themeColor}
      />
    </>
  );

  const renderGames = () => {
    const mainGameOptions = games.filter(game =>
      allowedGames.includes(game.id));
    const mainGameColor = getGameColor(mainGame);
    return (
      <>
      <StepIntro
        title="Choose the community's games"
        description="Enabled games control filters, creation submissions and showcase organization. The main game is selected by default for visitors."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {games.map(game => {
          const selected = allowedGames.includes(game.id);
          return (
            <button
              key={game.id}
              type="button"
              onClick={() => handleGameToggle(game.id)}
              className={`rounded-xl border-2 p-4 text-left transition ${
                selected
                  ? 'community-border bg-gray-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold text-gray-800">{game.name}</span>
                <span
                  className={`h-5 w-5 rounded-full border-2 ${
                    selected ? 'community-border community-bg' : 'border-gray-300'
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
      <div>
        <label className="mb-2 block font-bold text-gray-700">Main Game</label>
        <p className="mb-3 text-sm text-gray-500">
          This game is preselected on community pages and filters.
        </p>
        <div
          className="relative flex max-w-full items-center overflow-x-auto rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-700"
          style={mainGameColor.style}
        >
          <div
            ref={mainGameGliderRef}
            className={`absolute bottom-1 top-1 w-0 rounded-full ${mainGameColor.bg} transition-all duration-500 ease-in-out`}
          />
          {mainGameOptions.map((game, index) => (
            <button
              key={game.id}
              ref={element => { mainGamePillRefs.current[index] = element; }}
              type="button"
              aria-pressed={mainGame === game.id}
              onClick={() => setMainGame(game.id)}
              title={game.name}
              className={`relative z-10 min-w-0 flex-1 truncate rounded-full px-2 py-2 text-center text-sm font-medium transition-colors duration-300 sm:px-4 ${
                mainGame === game.id
                  ? 'text-white'
                  : 'text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white'
              }`}
            >
              {game.name}
            </button>
          ))}
        </div>
      </div>
      </>
    );
  };

  const renderMembership = () => (
    <>
      <StepIntro
        title="Decide how people join"
        description="This can be changed later. Application and invite workflows are available immediately in the Community Manager."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {COMMUNITY_JOIN_MODES.map(mode => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setJoinMode(mode.id)}
            className={`rounded-xl border-2 p-4 text-left transition ${
              joinMode === mode.id
                ? 'community-border bg-gray-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className="block font-bold text-gray-800">{mode.label}</span>
            <span className="mt-1 block text-sm text-gray-500">
              {mode.description}
            </span>
          </button>
        ))}
      </div>

      {joinMode === 'application' && (
        <label className="flex items-start gap-3 rounded-xl bg-gray-50 p-4">
          <input
            type="checkbox"
            checked={allowApplicationMessage}
            onChange={event => setAllowApplicationMessage(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <span>
            <span className="block font-semibold text-gray-800">
              Allow an application message
            </span>
            <span className="block text-sm text-gray-500">
              Applicants can add up to 1,000 characters for reviewers.
            </span>
          </span>
        </label>
      )}

      {joinMode === 'password' && (
        <div>
          <label className="mb-2 block font-bold text-gray-700">
            Join Password <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            value={joinPassword}
            onChange={event => setJoinPassword(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            The password is hashed by a Cloud Function and never stored in the public
            community document.
          </p>
        </div>
      )}

      <div className="border-t pt-5">
        <label className="flex items-start gap-3 rounded-xl bg-gray-50 p-4">
          <input
            type="checkbox"
            checked={membersOnlyInfoPage}
            onChange={event => setMembersOnlyInfoPage(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <span>
            <span className="block font-semibold text-gray-800">
              Members-only community info page
            </span>
            <span className="block text-sm text-gray-500">
              Non-members can discover and join the community, but its content page is
              replaced by an access screen.
            </span>
          </span>
        </label>
      </div>
    </>
  );

  const renderConnections = () => {
    const usedDiscordRoleIds = new Set([
      moderatorRankData.discordRoleId,
      ...ranks.map(rank => rank.discordRoleId),
    ].filter(Boolean));
    return (
      <>
        <StepIntro
          title="Connect your existing audience"
          description="Social links appear on the community banner. Discord can sync roles and later post notifications."
          optional
        />
        <section className="space-y-3">
          <h3 className="font-bold text-gray-800">Social Links</h3>
          <p className="text-sm text-gray-500">
            A YouTube channel also enables YouTube content on the community Videos page.
          </p>
          {SOCIAL_PLATFORMS.map(platform => (
            <div key={platform.id} className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600"
                title={platform.label}
              >
                <Icon
                  path={platform.icon}
                  solid={platform.solid}
                  className="h-5 w-5"
                />
              </span>
              <input
                type="url"
                value={socialLinks[platform.id] || ''}
                onChange={event => setSocialLinks(previous => ({
                  ...previous,
                  [platform.id]: event.target.value,
                }))}
                placeholder={platform.placeholder}
                className={inputClass}
              />
            </div>
          ))}
        </section>

        <section className="space-y-3 border-t pt-5">
          <div>
            <h3 className="font-bold text-gray-800">Discord Integration</h3>
            <p className="text-sm text-gray-500">
              Invite the bot, link the server ID, then import roles for the rank setup.
              Notification channels become selectable after the community exists and
              <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">
                /import-community-setup
              </code>
              has synced the server.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <a
              href={DISCORD_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-indigo-500 px-4 py-2.5 text-center font-bold text-white hover:bg-indigo-600"
            >
              1. Invite Bot
            </a>
            <button
              type="button"
              onClick={() => setShowDiscordInput(previous => !previous)}
              className={`rounded-xl px-4 py-2.5 font-bold text-white ${
                discordServerId
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-indigo-500 hover:bg-indigo-600'
              }`}
            >
              2. {discordServerId ? 'Server Linked' : 'Link Server ID'}
            </button>
            <button
              type="button"
              onClick={fetchDiscordRanks}
              disabled={isFetchingRanks || !discordServerId.trim()}
              className="rounded-xl bg-indigo-500 px-4 py-2.5 font-bold text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {isFetchingRanks ? <Spinner size="small" /> : '3. Import Ranks'}
            </button>
          </div>
          {showDiscordInput && (
            <input
              type="text"
              inputMode="numeric"
              value={discordServerId}
              onChange={event => setDiscordServerId(event.target.value)}
              className={inputClass}
              placeholder="Paste your Discord Server ID..."
            />
          )}
          {suggestedRanks.length > 0 && (
            <div className="rounded-xl border bg-gray-50 p-4">
              <h4 className="mb-2 text-sm font-bold text-gray-700">
                Imported Discord Roles
              </h4>
              <div className="flex flex-wrap gap-2">
                {suggestedRanks
                  .filter(rank => !usedDiscordRoleIds.has(rank.id))
                  .map(rank => (
                    <button
                      key={rank.id}
                      type="button"
                      onClick={() => addRank(rank.name, rank.color, rank.id)}
                      className="rounded-full px-3 py-1 text-sm font-semibold"
                      style={{
                        backgroundColor: rank.color,
                        color: getTextColorForBackground(rank.color),
                      }}
                    >
                      + {rank.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </section>
      </>
    );
  };

  const renderRanks = () => (
    <>
      <StepIntro
        title="Define responsibilities before inviting members"
        description="Owner is fixed. Moderator permissions start enabled but can be changed. Management permissions on custom ranks start disabled."
      />
      <div className="space-y-3">
        <div className="rounded-xl bg-gray-200 p-3">
          <div className="flex items-center gap-2">
            <Icon path={ICONS.lockClosed} className="h-5 w-5 text-gray-400" />
            <input
              type="text"
              value="Owner"
              disabled
              className="w-full rounded-lg border bg-gray-100 p-2"
            />
            <input
              type="color"
              value={ownerRankData.color}
              onChange={event => setOwnerRankData(previous => ({
                ...previous,
                color: event.target.value,
              }))}
              className="h-10 w-12 cursor-pointer rounded-lg border p-1"
            />
          </div>
          <div className="mt-2 pl-7">
            <input
              type="url"
              value={ownerRankData.imageUrl}
              onChange={event => setOwnerRankData(previous => ({
                ...previous,
                imageUrl: event.target.value,
              }))}
              className={inputClass}
              placeholder="Optional rank image URL..."
            />
            <div className="mt-2"><InfoBox /></div>
            <div className="mt-2"><FixedRankPermissionsInfo role="owner" /></div>
          </div>
        </div>

        <div className="rounded-xl border bg-gray-50 p-3">
          <div className="flex items-center gap-2">
            <Icon path={ICONS.lockClosed} className="h-5 w-5 text-gray-400" />
            <input
              type="text"
              value="Moderator"
              disabled
              className="w-full rounded-lg border bg-gray-100 p-2"
            />
            <input
              type="color"
              value={moderatorRankData.color}
              onChange={event => setModeratorRankData(previous => ({
                ...previous,
                color: event.target.value,
              }))}
              className="h-10 w-12 cursor-pointer rounded-lg border p-1"
            />
          </div>
          <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
            <select
              value={moderatorRankData.discordRoleId || ''}
              onChange={event => setModeratorRankData(previous => ({
                ...previous,
                discordRoleId: event.target.value,
              }))}
              className={`${inputClass} bg-white`}
              disabled={!suggestedRanks.length}
            >
              <option value="">Link to Discord Role...</option>
              {suggestedRanks.map(role => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
            <input
              type="url"
              value={moderatorRankData.imageUrl || ''}
              onChange={event => setModeratorRankData(previous => ({
                ...previous,
                imageUrl: event.target.value,
              }))}
              className={inputClass}
              placeholder="Optional rank image URL..."
            />
          </div>
          <div className="mt-2 pl-7"><InfoBox /></div>
          <div className="mt-2 pl-7">
            <RankPermissionsEditor
              rank={moderatorRankData}
              role="moderator"
              onChange={(field, value) => setModeratorRankData(previous => ({
                ...previous,
                [field]: value,
              }))}
            />
          </div>
        </div>

        {ranks.map((rank, index) => {
          const isDefault = index === defaultRankIndex;
          const linkedRole = suggestedRanks.find(role =>
            role.id === rank.discordRoleId);
          return (
            <div
              key={index}
              draggable
              onDragStart={() => { dragItem.current = index; }}
              onDragEnter={() => { dragOverItem.current = index; }}
              onDragEnd={handleRankSort}
              onDragOver={event => event.preventDefault()}
              className="flex items-start gap-2 rounded-xl border bg-white p-3"
            >
              <div className="cursor-grab pt-2.5 text-gray-400">
                <Icon path={GRAB_HANDLE_ICON} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-grow space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={rank.name}
                    maxLength={50}
                    onChange={event => handleRankChange(
                      index,
                      'name',
                      event.target.value
                    )}
                    className={`${inputClass} flex-grow`}
                    placeholder="Custom Rank Name"
                  />
                  <button
                    type="button"
                    onClick={() => setDefaultRankIndex(index)}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${
                      isDefault
                        ? 'bg-yellow-400 text-white'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                  >
                    Default Rank
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={rank.discordRoleId || ''}
                    onChange={event => handleRankChange(
                      index,
                      'discordRoleId',
                      event.target.value
                    )}
                    className={`${inputClass} bg-white`}
                    disabled={!suggestedRanks.length}
                  >
                    <option value="">Link to Discord Role...</option>
                    {suggestedRanks.map(role => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                  <input
                    type="url"
                    value={rank.imageUrl || ''}
                    onChange={event => handleRankChange(
                      index,
                      'imageUrl',
                      event.target.value
                    )}
                    className={inputClass}
                    placeholder="Optional rank image URL..."
                  />
                </div>
                <div><InfoBox /></div>
                <RankPermissionsEditor
                  rank={rank}
                  onChange={(field, value) =>
                    handleRankChange(index, field, value)}
                />
                {linkedRole && (
                  <p className="text-xs text-gray-500">
                    Linked to Discord:
                    <span
                      className="ml-1 font-semibold"
                      style={{ color: linkedRole.color }}
                    >
                      {linkedRole.name}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 flex-col gap-2">
                <input
                  type="color"
                  value={rank.color}
                  onChange={event => handleRankChange(
                    index,
                    'color',
                    event.target.value
                  )}
                  className="h-10 w-12 cursor-pointer rounded-lg border p-1"
                />
                <button
                  type="button"
                  onClick={() => removeRank(index)}
                  disabled={ranks.length <= 1}
                  className="h-10 w-12 rounded-lg bg-red-500 text-xl font-bold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Remove ${rank.name || 'custom'} rank`}
                >
                  &times;
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => addRank()}
          className="text-sm font-semibold community-text hover:underline"
        >
          + Add custom rank
        </button>
      </div>
    </>
  );

  const renderReview = () => {
    const selectedGameNames = games
      .filter(game => allowedGames.includes(game.id))
      .map(game => game.name)
      .join(', ');
    const joinModeLabel = COMMUNITY_JOIN_MODES.find(mode =>
      mode.id === joinMode)?.label || joinMode;
    const connectedSocialCount = Object.keys(
      cleanCommunitySocialLinks(socialLinks)
    ).length;
    const moderatorEnabledCount = COMMUNITY_PERMISSION_DEFINITIONS.filter(
      definition => getRankPermissionValue(
        moderatorRankData,
        definition,
        'moderator'
      )
    ).length;
    return (
      <>
        <StepIntro
          title="Ready to create"
          description="Review the key choices below. You can edit every section before creating the community."
        />
        <div
          className="overflow-hidden rounded-2xl border bg-white"
          style={{ borderColor: themeColor }}
        >
          <div
            className="h-28 bg-gray-100 bg-cover bg-center"
            style={bannerImageUrl
              ? { backgroundImage: `url("${bannerImageUrl}")` }
              : { backgroundColor: themeColor }}
          />
          <div className="p-5">
            <div className="flex items-center gap-4">
              <img
                src={profileImageUrl ||
                  'https://placehold.co/96x96/e2e8f0/64748b?text=C'}
                alt=""
                className="-mt-14 h-24 w-24 rounded-full border-4 border-white bg-white object-cover shadow"
              />
              <div className="min-w-0">
                <h3 className="truncate text-xl font-bold text-gray-800">
                  {name || 'Your Community'}
                </h3>
                <p className="text-sm text-gray-500">
                  {description || 'No description yet.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-white px-5">
          <ReviewRow
            label="Identity & Appearance"
            value={`${name} · ${themeColor.toUpperCase()}`}
            onEdit={() => openStep('basics')}
          />
          <ReviewRow
            label="Games"
            value={`${selectedGameNames} · Main: ${
              games.find(game => game.id === mainGame)?.name || mainGame
            }`}
            onEdit={() => openStep('games')}
          />
          <ReviewRow
            label="Membership"
            value={`${joinModeLabel}${
              membersOnlyInfoPage ? ' · Members-only info page' : ''
            }${
              joinMode === 'application' && allowApplicationMessage
                ? ' · Messages enabled'
                : ''
            }`}
            onEdit={() => openStep('membership')}
          />
          <ReviewRow
            label="Connections"
            value={`${connectedSocialCount} social link(s) · ${
              discordServerId ? 'Discord linked' : 'No Discord server'
            }`}
            onEdit={() => openStep('connections')}
          />
          <ReviewRow
            label="Ranks & Permissions"
            value={`${ranks.length + 2} ranks · ${
              ranks[defaultRankIndex]?.name || 'Member'
            } is default · Moderator ${moderatorEnabledCount}/${
              COMMUNITY_PERMISSION_DEFINITIONS.length
            } permissions`}
            onEdit={() => openStep('ranks')}
          />
        </div>

        <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          After creation, use Community Settings to configure Discord notification
          channels and optional custom fields for creation cards.
        </div>
      </>
    );
  };

  const renderActiveStep = () => {
    switch (activeStep) {
      case 'basics': return renderBasics();
      case 'appearance': return renderAppearance();
      case 'games': return renderGames();
      case 'membership': return renderMembership();
      case 'connections': return renderConnections();
      case 'ranks': return renderRanks();
      case 'review': return renderReview();
      default: return null;
    }
  };

  return (
    <div
      className="mx-auto mt-10 max-w-6xl px-4"
      style={{ '--theme-color': themeColor }}
    >
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Create a New Community</h1>
        <p className="mt-2 text-gray-500">
          Set up the essentials now. Everything is grouped by topic and explained
          along the way.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="lg:flex lg:items-start lg:gap-6">
          <nav className={`${mobileOpen ? 'hidden' : 'block'} lg:block lg:w-72 lg:flex-shrink-0`}>
            <div className="rounded-2xl bg-white p-2 shadow-md">
              {WIZARD_STEPS.map((step, index) => {
                const active = step.id === activeStep;
                const completed =
                  completedSteps.includes(step.id) &&
                  !getCommunityWizardStepError(
                    step.id,
                    getWizardState(),
                    blacklist
                  );
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => openStep(step.id)}
                    style={active
                      ? { backgroundColor: themeColor, color: '#fff' }
                      : {}}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors last:mb-0 ${
                      active ? '' : 'text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      completed
                        ? 'bg-green-500 text-white'
                        : active
                          ? 'bg-white/20'
                          : 'bg-gray-100 text-gray-500'
                    }`}>
                      {completed ? '✓' : index + 1}
                    </span>
                    <span className="min-w-0 flex-grow">
                      <span className="block truncate text-sm font-semibold">
                        {step.label}
                      </span>
                      <span className={`block truncate text-xs ${
                        active ? 'text-white/75' : 'text-gray-400'
                      }`}>
                        {step.hint}
                      </span>
                    </span>
                    <Icon
                      path={ICONS.chevronRight}
                      className={`h-4 w-4 flex-shrink-0 lg:hidden ${
                        active ? 'text-white' : 'text-gray-300'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </nav>

          <section className={`${mobileOpen ? 'block' : 'hidden'} mt-4 min-w-0 flex-1 lg:mt-0 lg:block`}>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="mb-3 flex items-center gap-1 font-semibold community-text lg:hidden"
            >
              <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
              All sections
            </button>

            <div className="space-y-6 rounded-2xl bg-white p-6 shadow-md sm:p-8">
              <div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800">
                      {activeStepMeta.label}
                    </h2>
                    <p className="text-sm text-gray-400">{activeStepMeta.hint}</p>
                  </div>
                  <span className="text-sm text-gray-400">
                    {activeStepIndex + 1} / {WIZARD_STEPS.length}
                  </span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${((activeStepIndex + 1) / WIZARD_STEPS.length) * 100}%`,
                      backgroundColor: themeColor,
                    }}
                  />
                </div>
              </div>

              {renderActiveStep()}

              <div className="flex items-center justify-between gap-3 border-t pt-6">
                {activeStepIndex === 0 ? (
                  <button
                    type="button"
                    onClick={() => navigate('/communitys')}
                    className="rounded-xl bg-gray-200 px-5 py-2.5 font-bold text-gray-800 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goPrevious}
                    className="flex items-center gap-1 rounded-xl bg-gray-200 px-5 py-2.5 font-bold text-gray-800 hover:bg-gray-300"
                  >
                    <Icon path={ICONS.chevronLeft} className="h-5 w-5" />
                    Previous
                  </button>
                )}

                {isLastStep ? (
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-xl px-6 py-2.5 font-bold text-white hover:brightness-95 disabled:opacity-50"
                    style={{ backgroundColor: themeColor }}
                  >
                    {loading ? 'Creating...' : 'Create Community'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex items-center gap-1 rounded-xl px-6 py-2.5 font-bold text-white hover:brightness-95"
                    style={{ backgroundColor: themeColor }}
                  >
                    Next
                    <Icon path={ICONS.chevronRight} className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </form>
    </div>
  );
};

export default CreateCommunityForm;
