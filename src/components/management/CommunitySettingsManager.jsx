import React, { useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import GeneralSection from './communitySettings/GeneralSection';
import AppearanceSection from './communitySettings/AppearanceSection';
import GamesSection from './communitySettings/GamesSection';
import SocialSection from './communitySettings/SocialSection';
import RanksSection from './communitySettings/RanksSection';
import DiscordSection from './communitySettings/DiscordSection';
import DangerZoneSection from './communitySettings/DangerZoneSection';
import MembershipSection from './communitySettings/MembershipSection';

// iOS/iPadOS "Settings"-style panel: category list (sidebar on desktop, drill-down on
// mobile) + a detail pane. Merges the former "Settings" tab and "Edit Community" form.
const CommunitySettingsManager = ({
  community,
  members = [],
  userProfile,
  blacklist,
  setModalMessage,
  setPasswordConfirm,
  isOwner,
  onTransferComplete,
  onDeleted,
}) => {
  const canManageDanger = isOwner || userProfile?.role === 'admin';
  const canManageMembership = isOwner || userProfile?.role === 'admin';

  const CATEGORIES = [
    { id: 'general', label: 'General', hint: 'Name & description', icon: ICONS.pencil, tint: 'bg-gray-500' },
    { id: 'appearance', label: 'Appearance', hint: 'Color, images & creation card', icon: ICONS.star, tint: 'bg-pink-500' },
    { id: 'games', label: 'Games', hint: 'Allowed games & main game', icon: ICONS.checklist, tint: 'bg-emerald-500' },
    { id: 'social', label: 'Social Links', hint: 'Linked profiles', icon: ICONS.share, tint: 'bg-sky-500' },
    { id: 'ranks', label: 'Ranks & Permissions', hint: 'Roles, permissions & Discord', icon: ICONS.shieldCheck, tint: 'bg-amber-500' },
    ...(canManageMembership
      ? [{ id: 'membership', label: 'Membership', hint: 'Joining, applications & invites', icon: ICONS.userPlus, tint: 'bg-teal-500' }]
      : []),
    { id: 'discord', label: 'Discord', hint: 'Link your server', icon: ICONS.users, tint: 'bg-indigo-500' },
    ...(canManageDanger
      ? [{ id: 'danger', label: 'Danger Zone', hint: 'Transfer or delete', icon: ICONS.trash, tint: 'bg-red-500' }]
      : []),
  ];

  const [activeId, setActiveId] = useState('general');
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeCategory = CATEGORIES.find((c) => c.id === activeId) || CATEGORIES[0];

  const openCategory = (id) => {
    setActiveId(id);
    setMobileOpen(true);
  };

  const renderSection = () => {
    switch (activeCategory.id) {
      case 'general':
        return (
          <GeneralSection
            community={community}
            userProfile={userProfile}
            blacklist={blacklist}
            setModalMessage={setModalMessage}
            setPasswordConfirm={setPasswordConfirm}
          />
        );
      case 'appearance':
        return <AppearanceSection community={community} setModalMessage={setModalMessage} />;
      case 'games':
        return <GamesSection community={community} setModalMessage={setModalMessage} />;
      case 'social':
        return <SocialSection community={community} setModalMessage={setModalMessage} />;
      case 'ranks':
        return <RanksSection community={community} setModalMessage={setModalMessage} />;
      case 'membership':
        return <MembershipSection community={community} setModalMessage={setModalMessage} />;
      case 'discord':
        return <DiscordSection community={community} setModalMessage={setModalMessage} />;
      case 'danger':
        return (
          <DangerZoneSection
            community={community}
            members={members}
            isOwner={isOwner}
            setModalMessage={setModalMessage}
            setPasswordConfirm={setPasswordConfirm}
            onTransferComplete={onTransferComplete}
            onDeleted={onDeleted}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto lg:flex lg:gap-6 lg:items-start">
      {/* Category list — sidebar on desktop, first screen on mobile */}
      <nav className={`${mobileOpen ? 'hidden' : 'block'} lg:block lg:w-72 lg:flex-shrink-0`}>
        <div className="bg-white rounded-2xl shadow-md p-2">
          {CATEGORIES.map((cat) => {
            const isActive = cat.id === activeId;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => openCategory(cat.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors mb-1 last:mb-0
                  ${isActive ? 'lg:bg-[--theme-color] lg:text-white' : 'hover:bg-gray-100 text-gray-800'}`}
              >
                <span className={`w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-white ${cat.tint}`}>
                  <Icon path={cat.icon} className="w-5 h-5" />
                </span>
                <span className="flex-grow min-w-0">
                  <span className="block font-semibold leading-tight">{cat.label}</span>
                  <span className={`block text-xs truncate ${isActive ? 'lg:text-white/80 text-gray-400' : 'text-gray-400'}`}>
                    {cat.hint}
                  </span>
                </span>
                <Icon path={ICONS.chevronRight} className={`w-4 h-4 flex-shrink-0 lg:hidden ${isActive ? 'text-white' : 'text-gray-300'}`} />
              </button>
            );
          })}
        </div>
      </nav>

      {/* Detail pane — right column on desktop, drilled-in screen on mobile */}
      <section className={`${mobileOpen ? 'block' : 'hidden'} lg:block flex-1 min-w-0`}>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden flex items-center gap-1 text-[--theme-color] font-semibold mb-3"
        >
          <Icon path={ICONS.chevronLeft} className="w-5 h-5" />
          Settings
        </button>
        {renderSection()}
      </section>
    </div>
  );
};

export default CommunitySettingsManager;
