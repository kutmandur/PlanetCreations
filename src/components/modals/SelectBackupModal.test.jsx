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

test('lets a first-time hosted client choose its game folder and then reloads saves', async () => {
    const path = 'C:\\Frontier';
    window.electronAPI = {
        listAllLocalCreationsAndBackups: vi.fn()
            .mockResolvedValueOnce({ __configurationRequired: true })
            .mockResolvedValueOnce({
                'Planet Coaster 2': {
                    parks: [{ name: 'Configured.park2', path: `${path}\\Configured.park2`, modifiedAt: '2026-08-20T10:00:00.000Z' }],
                    blueprints: [], backups: [], autosaves: [],
                },
            }),
        selectFrontierFolder: vi.fn().mockResolvedValue(path),
    };

    render(<SelectBackupModal isOpen onClose={vi.fn()} onFileSelect={vi.fn()} game="planet-coaster-2" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Choose Game Folder' }));
    expect(await screen.findByRole('button', { name: /Configured\.park2/i })).toBeInTheDocument();
    expect(window.electronAPI.selectFrontierFolder).toHaveBeenCalledOnce();
    expect(window.electronAPI.listAllLocalCreationsAndBackups).toHaveBeenCalledTimes(2);
    delete window.electronAPI;
});

test('lists packaged backups without trying to parse them as raw Frontier saves', async () => {
    const backupPath = 'C:\\PlanetCreations\\Frozen Park_v1.PlanetCreations';
    window.electronAPI = {
        listAllLocalCreationsAndBackups: vi.fn().mockResolvedValue({
            'Planet Coaster 2': {
                parks: [], blueprints: [], autosaves: [],
                backups: [{ name: 'Frozen Park.park2', path: backupPath, modifiedAt: '2026-08-20T10:00:00.000Z', isBackup: true }],
            },
        }),
        inspectFrontierFile: vi.fn(),
        readFrontierPreview: vi.fn(),
    };

    render(<SelectBackupModal isOpen onClose={vi.fn()} onFileSelect={vi.fn()} game="planet-coaster-2" />);
    fireEvent.click(await screen.findByRole('button', { name: /Frozen Park\.park2/i }));

    await waitFor(() => expect(screen.getByText('PlanetCreations backup')).toBeInTheDocument());
    expect(window.electronAPI.inspectFrontierFile).not.toHaveBeenCalled();
    expect(window.electronAPI.readFrontierPreview).not.toHaveBeenCalled();
    delete window.electronAPI;
});
