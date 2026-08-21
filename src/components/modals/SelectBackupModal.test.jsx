import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SelectBackupModal from './SelectBackupModal';

test('shows the selected in-game preview and returns freshly extracted metadata', async () => {
    const onFileSelect = vi.fn();
    const path = 'C:\\Frontier\\Frozen Park.park2';
    window.electronAPI = {
        listAllLocalCreationsAndBackups: vi.fn().mockResolvedValue({
            'Planet Coaster 2': {
                parks: [{ name: 'Frozen Park.park2', path, modifiedAt: '2026-08-20T10:00:00.000Z' }],
                blueprints: [],
                backups: [],
                autosaves: [],
            },
        }),
        inspectFrontierFile: vi.fn().mockResolvedValue({
            metadata: { kind: 'park', name: 'Frozen Park', requiredDlcs: ['Resort Pack'], park: { rideCount: 12 } },
            mediaReferences: [],
        }),
        readFrontierPreview: vi.fn().mockResolvedValue('data:image/jpeg;base64,preview'),
    };

    render(<SelectBackupModal isOpen onClose={vi.fn()} onFileSelect={onFileSelect} game="planet-coaster-2" />);

    fireEvent.click(await screen.findByRole('button', { name: /Frozen Park\.park2/i }));
    expect(await screen.findByAltText('In-game save preview')).toHaveAttribute('src', 'data:image/jpeg;base64,preview');
    expect(await screen.findByText('Resort Pack')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Selection' }));

    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith(expect.objectContaining({
        path,
        gameId: 'planet-coaster-2',
        previewDataUrl: 'data:image/jpeg;base64,preview',
        frontierMetadata: expect.objectContaining({ name: 'Frozen Park' }),
    })));
    delete window.electronAPI;
});
