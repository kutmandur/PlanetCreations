import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { installDesktopE2EShim } from './e2e/installDesktopShim';

installDesktopE2EShim();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  // By removing the <React.StrictMode> wrapper from here,
  // the development-only double-rendering is disabled,
  // which solves the conflict with the drag-and-drop library.
  <App />
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
