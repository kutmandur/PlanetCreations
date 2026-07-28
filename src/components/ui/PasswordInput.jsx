import React, { useState } from 'react';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';

const PasswordInput = ({ value, onChange, id, className, placeholder, required = false }) => {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div className="relative">
            <input
                type={showPassword ? 'text' : 'password'}
                id={id}
                value={value}
                onChange={onChange}
                className={className}
                placeholder={placeholder}
                required={required}
            />
            <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? "Hide password" : "Show password"}
            >
                <Icon path={showPassword ? ICONS.eyeSlash : ICONS.eye} className="w-5 h-5" />
            </button>
        </div>
    );
};

export default PasswordInput;