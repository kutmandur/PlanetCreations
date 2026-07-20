import React, { useState } from 'react';
import { db } from '../../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import InfoBox from '../../ui/InfoBox';
import CommunityCardEditor from '../CommunityCardEditor';
import { SectionCard, Field, SaveBar, inputClass } from './ui';

// Everything visual: theme color, banner & profile images, and the creation card editor.
const AppearanceSection = ({ community, setModalMessage }) => {
  const [themeColor, setThemeColor] = useState(community.themeColor || '#F97316');
  const [bannerImageUrl, setBannerImageUrl] = useState(community.bannerImageUrl || '');
  const [profileImageUrl, setProfileImageUrl] = useState(community.profileImageUrl || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const change = (setter) => (value) => {
    setter(value);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'communitys', community.id), {
        themeColor,
        bannerImageUrl,
        profileImageUrl,
      });
      setModalMessage('Changes saved successfully!');
      setDirty(false);
    } catch (error) {
      setModalMessage(`Error saving changes: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Appearance" description="How your community looks — colors and images.">
        <Field
          label="Community Theme Color"
          hint="This color will be used for accents and highlights throughout your community's pages and event cards."
        >
          <div className="flex items-center space-x-4">
            <input
              type="color"
              value={themeColor}
              onChange={(e) => change(setThemeColor)(e.target.value)}
              className="h-12 w-24 p-1 border rounded-lg cursor-pointer"
            />
            <div className="p-3 rounded-lg font-mono text-lg text-white" style={{ backgroundColor: themeColor }}>
              {themeColor.toUpperCase()}
            </div>
          </div>
        </Field>

        <Field label="Banner Image URL">
          <input
            type="url"
            value={bannerImageUrl}
            onChange={(e) => change(setBannerImageUrl)(e.target.value)}
            className={inputClass}
            placeholder="https://..."
          />
          <div className="mt-2"><InfoBox /></div>
        </Field>

        <Field label="Profile Image URL (Square)">
          <input
            type="url"
            value={profileImageUrl}
            onChange={(e) => change(setProfileImageUrl)(e.target.value)}
            className={inputClass}
            placeholder="https://..."
          />
          <div className="mt-2"><InfoBox /></div>
        </Field>

        <SaveBar dirty={dirty} saving={saving} onSave={handleSave} />
      </SectionCard>

      {/* Custom creation card fields + live preview. The preview mirrors the theme color and
          profile image edited above (even before they're saved). */}
      <CommunityCardEditor
        community={community}
        setModalMessage={setModalMessage}
        previewThemeColor={themeColor}
        previewProfileImageUrl={profileImageUrl}
      />
    </div>
  );
};

export default AppearanceSection;
