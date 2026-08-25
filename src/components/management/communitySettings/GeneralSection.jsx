import React, { useState } from 'react';
import { db, auth } from '../../../firebase/config';
import { doc, updateDoc, collection, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { containsBlacklistedWord } from '../../../utils/helpers';
import { SectionCard, Field, SaveBar, inputClass, slugify } from './ui';
import { scheduleDataRefresh } from '../../../utils/appRefresh';
import { getCommunitySlugError } from '../../../utils/communityRoutes';

// General identity: name (admin-only, password-gated) and description.
const GeneralSection = ({ community, userProfile, blacklist, setModalMessage, setPasswordConfirm }) => {
  const isAdmin = userProfile?.role === 'admin';
  const [name, setName] = useState(community.name || '');
  const [description, setDescription] = useState(community.description || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const change = (setter) => (value) => {
    setter(value);
    setDirty(true);
  };

  // No name change (or non-admin): a plain updateDoc without re-auth.
  const saveDirect = async () => {
    setSaving(true);
    try {
      const ref = doc(db, 'communitys', community.id);
      const data = { description };
      if (!community.slug) data.slug = slugify(community.name);
      await updateDoc(ref, data);
      setModalMessage('Changes saved successfully!');
      scheduleDataRefresh();
      setDirty(false);
    } catch (error) {
      setModalMessage(`Error saving changes: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Name change cascades to the slug and every member's membership doc → password required.
  const saveWithNameChange = () => {
    setPasswordConfirm({
      message: 'To change the community name, please confirm with your password.',
      onConfirm: async (password) => {
        setSaving(true);
        try {
          const user = auth.currentUser;
          await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));

          const batch = writeBatch(db);
          const newName = name.trim();
          const newSlug = slugify(newName);
          const duplicateSlugSnapshot = await getDocs(query(
            collection(db, 'communitys'),
            where('slug', '==', newSlug)
          ));
          if (duplicateSlugSnapshot.docs.some(result => result.id !== community.id)) {
            throw new Error('A community with this URL already exists.');
          }
          batch.update(doc(db, 'communitys', community.id), {
            name: newName,
            slug: newSlug,
            description,
          });

          const membersSnap = await getDocs(collection(db, 'communitys', community.id, 'members'));
          membersSnap.forEach((memberDoc) => {
            batch.update(
              doc(db, 'profiles', memberDoc.id, 'communityMemberships', community.id),
              { communityName: newName }
            );
          });

          await batch.commit();
          setModalMessage('Community updated successfully!');
          scheduleDataRefresh();
          setDirty(false);
        } catch (error) {
          setModalMessage(`Error saving changes: ${error.message}`);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const handleSave = () => {
    if (containsBlacklistedWord(name, blacklist) || containsBlacklistedWord(description, blacklist)) {
      setModalMessage('Community name or description contains a forbidden word.');
      return;
    }
    if (!description.trim()) {
      setModalMessage('The description cannot be empty.');
      return;
    }
    const nameChanged = isAdmin && name.trim() !== community.name;
    if ((nameChanged || !community.slug) &&
        getCommunitySlugError(slugify(name.trim()))) {
      setModalMessage(getCommunitySlugError(slugify(name.trim())));
      return;
    }
    if (nameChanged) saveWithNameChange();
    else saveDirect();
  };

  return (
    <SectionCard title="General" description="Your community's name and description.">
      <Field label={isAdmin ? 'Community Name (Editable by Admins)' : 'Community Name (Cannot be changed)'}>
        <input
          type="text"
          value={name}
          onChange={(e) => change(setName)(e.target.value)}
          disabled={!isAdmin}
          className={`${inputClass} ${!isAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => change(setDescription)(e.target.value)}
          rows="4"
          className={inputClass}
          required
        />
      </Field>

      <SaveBar dirty={dirty} saving={saving} onSave={handleSave} />
    </SectionCard>
  );
};

export default GeneralSection;
