import React from 'react';
import {render, screen, cleanup} from '@testing-library/react';
import {MemoryRouter, Routes, Route} from 'react-router-dom';
import {afterEach, expect, it} from 'vitest';
import AccountRoute from './AccountRoute';
afterEach(cleanup);
function view(user) {
    render(<MemoryRouter initialEntries={['/settings']}><Routes>
        <Route path="/settings" element={<AccountRoute user={user}><h1>Delete account</h1></AccountRoute>} />
        <Route path="/login" element={<h1>Sign in</h1>} />
    </Routes></MemoryRouter>);
}
it('allows an unverified account without a profile to manage deletion', () => {
    view({uid: 'new-user', emailVerified: false});
    expect(screen.getByText('Delete account')).toBeTruthy();
});
it('still requires authentication', () => {
    view(null);
    expect(screen.getByText('Sign in')).toBeTruthy();
});
