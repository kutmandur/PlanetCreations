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

test('requires "Ignore missing media" before backing up with missing files', () => {
    const onConfirm = vi.fn();
    render(<BackupNoteModal onConfirm={onConfirm} onCancel={() => {}} isOnline={false} missingMedia={['intro.mp4', 'theme.mp3']} />);

    expect(screen.getByText('intro.mp4')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm Backup' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    const toggle = screen.getByText('Ignore missing media').closest('.rounded-lg').querySelector('.cursor-pointer');
    fireEvent.click(toggle);
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('', false, false, true);
});

test('does not show the missing media option when nothing is missing', () => {
    render(<BackupNoteModal onConfirm={() => {}} onCancel={() => {}} isOnline={false} />);
    expect(screen.queryByText('Ignore missing media')).not.toBeInTheDocument();
});