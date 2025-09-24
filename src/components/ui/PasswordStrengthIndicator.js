import React, { useMemo } from 'react';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';

const PasswordStrengthIndicator = ({ password }) => {
    const checks = useMemo(() => {
        return {
            length: password.length >= 10,
            uppercase: /[A-Z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[^A-Za-z0-9]/.test(password), // Matches any character that is not a letter or number
        };
    }, [password]);

    const CheckItem = ({ isMet, text }) => (
        <li className={`flex items-center text-sm ${isMet ? 'text-green-600' : 'text-gray-500'}`}>
            <Icon path={isMet ? ICONS.checkCircle : ICONS.xCircle} className="w-4 h-4 mr-2" solid={isMet} />
            {text}
        </li>
    );

    // You will need to add these two icon paths to your helpers.js file
    ICONS.checkCircle = "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
    ICONS.xCircle = "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z";

    return (
        <ul className="mt-2 space-y-1">
            <CheckItem isMet={checks.length} text="At least 10 characters" />
            <CheckItem isMet={checks.uppercase} text="At least one uppercase letter" />
            <CheckItem isMet={checks.number} text="At least one number" />
            <CheckItem isMet={checks.special} text="At least one special character" />
        </ul>
    );
};

export default PasswordStrengthIndicator;