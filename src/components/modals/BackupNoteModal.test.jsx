import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BackupNoteModal from './BackupNoteModal';

test('offers a separate automatically detected media package by default', () => {
    const onConfirm = vi.fn();
    render(<BackupNoteModal onConfirm={onConfirm} onCancel={() => {}} isOnline={false} showMediaPackageOption />);

    expect(screen.getByText('Create separate Custom Media package')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Backup' }));
    expect(onConfirm).toHaveBeenCalledWith('', false, true);
});
