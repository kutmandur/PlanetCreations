import React from 'react';
import {Navigate} from 'react-router-dom';

// Managing/deleting an account must not depend on verification or profile setup.
export default function AccountRoute({user, children}) {
    return user ? children : <Navigate to="/login" replace />;
}
