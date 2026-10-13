import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import BackupNoteModal from './BackupNoteModal';
test('combined media backup is optional and defaults off', () => {
    const onConfirm = vi.fn();
    render(<BackupNoteModal onConfirm={onConfirm} onCancel={()=>{}} isOnline={false} showMediaPackageOption />);
    expect(screen.getByText('Include associated media in this backup')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Confirm Backup'}));
    expect(onConfirm).toHaveBeenCalledWith('',false,false);
});
test('missing media are a small warning and do not block backup', () => {
    const onConfirm = vi.fn();
    render(<BackupNoteModal onConfirm={onConfirm} onCancel={()=>{}} isOnline={false} missingMedia={['intro.mp4']} />);
    expect(screen.getByText(/Warning: 1 media/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', {name:'Confirm Backup'});
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('',false,false,true);
});
