import React, { useState } from 'react';
import { db } from '../../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { SOCIAL_PLATFORMS } from '../../../utils/helpers';
import Icon from '../../ui/Icon';
import { SectionCard, Field, SaveBar, inputClass } from './ui';
import { scheduleDataRefresh } from '../../../utils/appRefresh';
import { isYoutubeChannelUrl } from '../../../utils/communityWizard';

// Clickable social icons shown on the community banner.
const SocialSection = ({ community, setModalMessage }) => {
  const [socialLinks, setSocialLinks] = useState(community.socialLinks || {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = (platformId, value) => {
    setSocialLinks((prev) => ({ ...prev, [platformId]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    const cleanedLinks = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const value = (socialLinks[platform.id] || '').trim();
      if (!value) continue;
      if (!/^https:\/\//i.test(value)) {
        setModalMessage(`The ${platform.label} link must start with https://`);
        return;
      }
      if (platform.id === 'youtube' && !isYoutubeChannelUrl(value)) {
        setModalMessage('The YouTube link must point to a channel, not a video.');
        return;
      }
      cleanedLinks[platform.id] = value;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, 'communitys', community.id), { socialLinks: cleanedLinks });
      setModalMessage('Changes saved successfully!');
      scheduleDataRefresh();
      setDirty(false);
    } catch (error) {
      setModalMessage(`Error saving changes: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Social Links" description="Linked profiles for your community.">
      <Field
        hint="These appear as clickable icons on your community banner. A linked YouTube channel also enables the YouTube tab on your community's Videos page."
      >
        <div className="space-y-3">
          {SOCIAL_PLATFORMS.map((platform) => (
            <div key={platform.id} className="flex items-center gap-3">
              <div
                className="w-9 h-9 flex-shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-gray-600"
                title={platform.label}
              >
                <Icon path={platform.icon} solid={platform.solid} className="w-5 h-5" />
              </div>
              <input
                type="url"
                value={socialLinks[platform.id] || ''}
                onChange={(e) => handleChange(platform.id, e.target.value)}
                placeholder={platform.placeholder}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </Field>

      <SaveBar dirty={dirty} saving={saving} onSave={handleSave} />
    </SectionCard>
  );
};

export default SocialSection;
