import React, { useState, useEffect } from 'react';
import { getViewMode, setViewMode, isMobileDevice } from '../../utils/viewMode';

// Profile-menu item that lets phone users switch between the mobile and the full desktop
// layout. Only rendered on actual mobile devices; the choice persists across reloads.
const ViewModeToggle = ({ onSelect }) => {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState('mobile');

  useEffect(() => {
    setShow(isMobileDevice());
    setMode(getViewMode());
  }, []);

  if (!show) return null;

  const toggle = () => {
    const next = mode === 'desktop' ? 'mobile' : 'desktop';
    setViewMode(next);
    setMode(next);
    if (onSelect) onSelect();
  };

  return (
    <button
      onClick={toggle}
      className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
    >
      {mode === 'desktop' ? 'Mobile view' : 'Desktop view'}
    </button>
  );
};

export default ViewModeToggle;
