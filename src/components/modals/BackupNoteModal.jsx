import LimitedTextField from '../ui/LimitedTextField';
import { TEXT_LIMITS } from '../../utils/textLimits';
import React, { useState } from 'react';
import ToggleSwitch from '../ui/ToggleSwitch';

const MAX_LISTED_MISSING = 8;

const BackupNoteModal = ({ onConfirm, onCancel, isOnline, showMediaPackageOption = false, missingMedia = [] }) => {
    const [note, setNote] = useState('');
    const [isSigned, setIsSigned] = useState(false);
    const [includeMediaPackage, setIncludeMediaPackage] = useState(false);
    const hasMissingMedia = missingMedia.length > 0;
    const blockedByMissingMedia = false;

    const handleConfirm = () => {
        if (note.length > TEXT_LIMITS.backupNote) return;
        if (blockedByMissingMedia) return;
        const args = [note, isSigned, showMediaPackageOption && includeMediaPackage];
        if (hasMissingMedia) args.push(true);
        onConfirm(...args);
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]" onClick={onCancel}>
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4">Add a Note to Your Backup</h2>
                <LimitedTextField countClassName="text-gray-300" maxLength={TEXT_LIMITS.backupNote} as="textarea"
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
                {hasMissingMedia && <p className="mt-2 text-xs text-amber-400" title={missingMedia.join(', ')}>Warning: {missingMedia.length} media file(s) unavailable. The backup will include the available files.</p>}
                {showMediaPackageOption && (
                    <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-700 p-3">
                        <div className="pr-4">
                            <h3 className="font-semibold text-white">Include associated media in this backup</h3>
                            <p className="text-sm text-gray-400">Save the game file and available associated media together. Missing media are listed as a warning and do not prevent the backup.</p>
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
