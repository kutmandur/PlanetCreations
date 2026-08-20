import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installDesktopE2EShim } from './e2e/installDesktopShim';
import { installWindowResizeMotionGuard } from './utils/windowResizeMotion';

installDesktopE2EShim();
installWindowResizeMotionGuard();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  // By removing the <React.StrictMode> wrapper from here,
  // the development-only double-rendering is disabled,
  // which solves the conflict with the drag-and-drop library.
  <App />
);
