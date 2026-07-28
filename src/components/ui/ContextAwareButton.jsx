import React from 'react';

/**
 * A reusable button that executes different functions based on whether
 * it's running in a web browser or the Electron desktop client.
 *
 * @param {object} props
 * @param {Function} props.onClickBrowser - The function to call in the browser.
 * @param {Function} props.onClickElectron - The function to call in Electron.
 * @param {React.ReactNode} props.children - The content of the button (text, icons).
 * @param {string} [props.className] - Optional CSS classes for styling.
 * @param {boolean} [props.disabled=false] - Whether the button is disabled.
 */
const ContextAwareButton = ({ 
    onClickBrowser = () => {}, 
    onClickElectron = () => {}, 
    children, 
    className = '', 
    disabled = false 
}) => {
    // This check determines the current environment.
    const isRunningInElectron = window.electronAPI?.isElectron;

    const handleClick = (e) => {
        if (isRunningInElectron) {
            onClickElectron(e);
        } else {
            onClickBrowser(e);
        }
    };

    return (
        <button
            onClick={handleClick}
            disabled={disabled}
            className={className}
        >
            {children}
        </button>
    );
};

export default ContextAwareButton;