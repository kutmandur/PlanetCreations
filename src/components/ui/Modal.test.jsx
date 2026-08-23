import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Modal from './Modal';

test('keeps regular, error and cancellation notices dismissible', () => {
    const onClose = vi.fn();

    const { rerender } = render(
        <Modal message="Error: Verification failed." onClose={onClose} activeTab="planet-coaster-2" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    rerender(<Modal message="Upload cancelled." onClose={onClose} activeTab="planet-coaster-2" />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledTimes(2);
});

test('renders a non-dismissible progress notice for server-side work', () => {
    render(
        <Modal
            message={{
                title: 'Finishing creation',
                message: 'Your data is being verified and the creation is being finalized.',
                detail: 'This window will close automatically when everything is complete.',
                dismissible: false,
                progress: true,
                progressLabel: 'Verifying creation data',
            }}
            onClose={vi.fn()}
            activeTab="planet-coaster-2"
        />,
    );

    expect(screen.getByRole('dialog', { name: 'Finishing creation' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Verifying creation data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(screen.getByText(/close automatically/i)).toBeInTheDocument();
});
