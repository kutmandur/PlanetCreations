const KEY_NAMES = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
};

export function acceleratorFromKeyboardEvent(event) {
    const key = KEY_NAMES[event.key] || event.key;
    if (!key || ['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return null;
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    return parts.join('+');
}

export function displayAccelerator(value = '') {
    return value.replace('CommandOrControl', 'Ctrl/Cmd').replaceAll('+', ' + ');
}
