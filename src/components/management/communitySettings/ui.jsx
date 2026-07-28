import React from 'react';
import Spinner from '../../ui/Spinner';

// Shared styling for text/url inputs across all settings sections.
export const inputClass =
  "w-full p-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-400 transition dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:focus:ring-gray-500";

// White rounded card that holds a single settings section (right pane / mobile detail).
export const SectionCard = ({ title, description, children }) => (
  <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 sm:p-8">
    <div className="mb-6">
      <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{title}</h3>
      {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
    </div>
    <div className="space-y-6">{children}</div>
  </div>
);

// Labelled field wrapper: bold label + optional helper text + control.
export const Field = ({ label, labelAccessory, hint, children }) => (
  <div>
    {(label || labelAccessory) && (
      <div className="mb-1.5 flex items-center gap-2">
        {label && (
          <label className="block font-semibold text-gray-700 dark:text-gray-200">
            {label}
          </label>
        )}
        {labelAccessory}
      </div>
    )}
    {hint && <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{hint}</p>}
    {children}
  </div>
);

// Right-aligned save button; disabled until there are unsaved changes.
export const SaveBar = ({ dirty, saving, onSave, label = 'Save' }) => (
  <div className="flex justify-end pt-6 border-t border-gray-100 dark:border-gray-700">
    <button
      type="button"
      onClick={onSave}
      disabled={!dirty || saving}
      className="community-bg hover:brightness-95 text-white font-bold py-2.5 px-6 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 min-w-[130px]"
    >
      {saving ? <Spinner size="small" /> : label}
    </button>
  </div>
);

// Readable text color (black/white) for a given hex background.
export const getTextColorForBackground = (hexColor) => {
  if (!hexColor || hexColor === '#000000') return '#ffffff';
  const r = parseInt(hexColor.substr(1, 2), 16);
  const g = parseInt(hexColor.substr(3, 2), 16);
  const b = parseInt(hexColor.substr(5, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#ffffff';
};

// Slug helper mirrored from the former EditCommunityForm.
export const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

export { Spinner };
