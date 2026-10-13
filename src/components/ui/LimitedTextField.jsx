import React, { useEffect, useId, useRef, useState } from 'react';

/** A native text control with a persistent, accessible limit and count. */
export default function LimitedTextField({
    as: Control = 'input', value, defaultValue = '', maxLength, minLength,
    onChange, onBlur, className = '', wrapperClassName = 'min-w-0 flex-1',
    countClassName = 'text-gray-600 dark:text-gray-300',
    'aria-describedby': describedBy, ...props
}) {
    const countId = useId();
    const controlRef = useRef(null);
    const [localValue, setLocalValue] = useState(defaultValue);
    const text = value === undefined ? localValue : value;
    const length = String(text ?? '').length;
    const overLimit = length > maxLength;
    useEffect(() => {
        controlRef.current?.setCustomValidity(
            overLimit ? `Please shorten this text to ${maxLength} characters or fewer.` : '',
        );
    }, [overLimit, maxLength]);
    return (
        <span className={`block ${wrapperClassName}`}>
            <Control {...props} ref={controlRef} value={value} defaultValue={value === undefined ? defaultValue : undefined}
                maxLength={maxLength} minLength={minLength}
                aria-describedby={[describedBy, countId].filter(Boolean).join(' ')}
                aria-invalid={overLimit || props['aria-invalid'] || undefined}
                className={`w-full ${className}`}
                onChange={event => {
                    setLocalValue(event.currentTarget.value);
                    onChange?.(event);
                }}
                onBlur={event => {
                    onBlur?.(event);
                    setLocalValue(event.currentTarget.value);
                }}
            />
            <span id={countId} aria-hidden="true" className={`mt-1 block text-xs font-medium ${overLimit ? 'text-red-600 dark:text-red-400' : countClassName}`}>
                {length} / {maxLength} characters{minLength ? ` (minimum ${minLength})` : ''}
                {overLimit ? ' — shorten before saving' : ''}
            </span>
        </span>
    );
}
