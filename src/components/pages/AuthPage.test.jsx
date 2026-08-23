import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthPage from './AuthPage';

vi.mock('../../firebase/config', () => ({ auth: {}, db: {} }));
vi.mock('../../firebase/appCheck', () => ({
    runFirebaseAuthWithAppCheckRecovery: vi.fn(),
    waitForElectronAppCheck: vi.fn(),
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
