import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthPage from './AuthPage';
import { waitForElectronAppCheck } from '../../firebase/appCheck';

vi.mock('firebase/auth', () => ({
    createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(),
    setPersistence: vi.fn().mockResolvedValue(), browserSessionPersistence: {}, browserLocalPersistence: {},
    sendEmailVerification: vi.fn(), sendPasswordResetEmail: vi.fn(),
}));

vi.mock('../../firebase/config', () => ({ auth: {}, db: {}, authPersistenceReady: Promise.resolve() }));
vi.mock('../../firebase/appCheck', () => ({
    runFirebaseAuthWithAppCheckRecovery: vi.fn(),
    waitForElectronAppCheck: vi.fn(),
    isFirebaseAppCheckAuthError: error => error?.code === 'auth/firebase-app-check-token-is-invalid',
}));

test('registration requires confirmation of the minimum age and legal terms', () => {
    render(
        <MemoryRouter>
            <AuthPage
                activeTab="planet-coaster-2"
                blacklist={[]}
                setModalMessage={vi.fn()}
            />
        </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    const confirmation = screen.getByRole('checkbox', { name: /at least 16 years old/i });
    expect(confirmation).toBeRequired();
    expect(confirmation).not.toBeChecked();
    expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', '/terms-of-service');
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
});

test('App Check failure preserves the login form and allows dismissal without reloading', async () => {
    const originalApi = window.electronAPI;
    window.electronAPI = {isElectron: true, reloadWindow: vi.fn()};
    waitForElectronAppCheck.mockRejectedValueOnce({code: 'auth/firebase-app-check-token-is-invalid'});
    const setModalMessage = vi.fn();
    try {
        render(<MemoryRouter><AuthPage activeTab="planet-coaster-2" blacklist={[]} setModalMessage={setModalMessage} /></MemoryRouter>);
        fireEvent.change(screen.getByLabelText('Email or Username'), {target: {value: 'fixture@example.invalid'}});
        fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'fixture-password'}});
        fireEvent.submit(screen.getByLabelText('Email or Username').closest('form'));
        await waitFor(() => expect(setModalMessage).toHaveBeenCalledWith(expect.objectContaining({dismissible: true})));
        expect(screen.getByLabelText('Email or Username')).toHaveValue('fixture@example.invalid');
        expect(screen.getByLabelText('Password')).toHaveValue('fixture-password');
        expect(window.electronAPI.reloadWindow).not.toHaveBeenCalled();
        expect(setModalMessage.mock.calls[0][0].onAction).toBeUndefined();
    } finally {window.electronAPI = originalApi;}
});
