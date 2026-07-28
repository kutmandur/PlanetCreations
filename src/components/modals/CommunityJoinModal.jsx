import React, { useState } from 'react';
import Spinner from '../ui/Spinner';

const CommunityJoinModal = ({
  communityName,
  mode,
  allowMessage = false,
  onClose,
  onSubmit,
}) => {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isPassword = mode === 'password';

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(value);
      onClose();
    } catch {
      // The parent surfaces the callable/rules error in the app's message modal.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-800 shadow-xl p-6"
      >
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
          {isPassword ? 'Enter community password' : `Apply to ${communityName}`}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {isPassword
            ? 'The password is checked securely by the server.'
            : 'Community staff will review your request.'}
        </p>

        {isPassword ? (
          <input
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-5 w-full p-3 border rounded-xl dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            placeholder="Community password"
          />
        ) : allowMessage ? (
          <div className="mt-5">
            <label className="block font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Message to community staff (optional)
            </label>
            <textarea
              autoFocus
              maxLength={1000}
              rows={5}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="w-full p-3 border rounded-xl dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="Why would you like to join?"
            />
            <p className="mt-1 text-right text-xs text-gray-400">{value.length}/1000</p>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl bg-gray-200 text-gray-700 font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || (isPassword && !value)}
            className="min-w-[120px] px-5 py-2.5 rounded-xl community-bg text-white font-bold disabled:opacity-50"
          >
            {submitting ? <Spinner size="small" /> : (isPassword ? 'Join' : 'Send request')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CommunityJoinModal;
