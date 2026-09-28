import React, { useState } from 'react';
import ToggleSwitch from '../ui/ToggleSwitch';

const MAX_LISTED_MISSING = 8;

const BackupNoteModal = ({ onConfirm, onCancel, isOnline, showMediaPackageOption = false, missingMedia = [] }) => {
    const [note, setNote] = useState('');
    const [isSigned, setIsSigned] = useState(false);
    const [includeMediaPackage, setIncludeMediaPackage] = useState(true);
    const [ignoreMissingMedia, setIgnoreMissingMedia] = useState(false);
    const hasMissingMedia = missingMedia.length > 0;
    const blockedByMissingMedia = hasMissingMedia && !ignoreMissingMedia;

    const handleConfirm = () => {
        if (blockedByMissingMedia) return;
        const args = [note, isSigned, showMediaPackageOption && includeMediaPackage];
        if (hasMissingMedia) args.push(ignoreMissingMedia);
        onConfirm(...args);
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]" onClick={onCancel}>
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4">Add a Note to Your Backup</h2>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-md p-2 h-24"
                    placeholder="Optional: Describe this backup..."
                />
                <div className={`mt-4 p-3 rounded-lg ${isOnline ? 'bg-gray-700' : 'bg-gray-900 opacity-50'}`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className={`font-semibold ${isOnline ? 'text-white' : 'text-gray-500'}`}>Sign Backup for Sharing</h3>
                            <p className={`text-sm ${isOnline ? 'text-gray-400' : 'text-gray-600'}`}>
                                {isOnline ? "Requires an internet connection." : "Go online to enable signing."}
                            </p>
                        </div>
                        <ToggleSwitch
                            isToggled={isSigned}
                            onToggle={() => setIsSigned(!isSigned)}
                            disabled={!isOnline}
                        />
                    </div>
                </div>
                {hasMissingMedia && (
                    <div className="mt-4 rounded-lg bg-gray-700 p-3">
                        <div className="flex items-center justify-between">
                            <div className="pr-4">
                                <h3 className="font-semibold text-white">Ignore missing media</h3>
                                <p className="text-sm text-gray-400">
                                    {missingMedia.length} referenced file{missingMedia.length === 1 ? ' is' : 's are'} missing or could not be verified. Turn this on to back up the available files without {missingMedia.length === 1 ? 'it' : 'them'}.
                                </p>
                            </div>
                            <ToggleSwitch isToggled={ignoreMissingMedia} onToggle={() => setIgnoreMissingMedia(value => !value)} />
                        </div>
                        <ul className="mt-2 max-h-28 overflow-y-auto text-xs text-gray-300 list-disc pl-5" aria-label="Missing media files">
                            {missingMedia.slice(0, MAX_LISTED_MISSING).map(name => <li key={name} className="truncate" title={name}>{name}</li>)}
                            {missingMedia.length > MAX_LISTED_MISSING && <li>…and {missingMedia.length - MAX_LISTED_MISSING} more</li>}
                        </ul>
                    </div>
                )}
                {showMediaPackageOption && (
                    <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-700 p-3">
                        <div className="pr-4">
                            <h3 className="font-semibold text-white">Create separate Custom Media package</h3>
                            <p className="text-sm text-gray-400">Automatically detects the files referenced by this creation. If none are available, the creation backup is still created normally.</p>
                        </div>
                        <ToggleSwitch isToggled={includeMediaPackage} onToggle={() => setIncludeMediaPackage(value => !value)} />
                    </div>
                )}
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 font-bold py-2 px-6 rounded-lg">Cancel</button>
                    <button onClick={handleConfirm} disabled={blockedByMissingMedia} title={blockedByMissingMedia ? 'Turn on "Ignore missing media" to continue.' : undefined} className="bg-blue-600 hover:bg-blue-700 font-bold py-2 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">Confirm Backup</button>
                </div>
            </div>
        </div>
    );
};

export default BackupNoteModal;
