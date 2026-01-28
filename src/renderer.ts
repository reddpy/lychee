import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

createRoot(el).render(
  React.createElement(
    React.StrictMode,
    null,
    React.createElement(App, null, null),
  ),
);
