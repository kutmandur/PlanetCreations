export function deletionStatusMessage(status) {
    if (status.state === 'complete') return 'Account deletion completed. This receipt remains available for 30 days after completion.';
    if (status.state === 'expired') return 'This deletion receipt has expired. It no longer provides a completion record.';
    if (status.state === 'missing') return 'No deletion receipt was found. This may mean the request was not accepted or the receipt has expired; it does not confirm deletion. If your account is still accessible, retry deletion in Settings using this browser. Otherwise contact support via the Legal Notice.';
    if (status.state === 'unavailable') return 'The deletion status is temporarily unavailable. This does not cancel an accepted request. Keep this browser’s saved receipt and check again.';
    if (!status.state) return 'Checking the saved deletion request…';
    if (status.state === 'retrying') return 'Account deletion is still in progress. A cleanup step will be retried automatically.';
    return 'Your account deletion request was accepted. Cleanup starts after a minimum 22-minute safety period for in-flight operations; subsequent processing and retries may take longer.';
}
