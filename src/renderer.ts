import '@fontsource-variable/inter';
import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import { ErrorBoundary } from './components/error-boundary';

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

createRoot(el).render(
  React.createElement(
    React.StrictMode,
    null,
    React.createElement(ErrorBoundary, {
      scope: 'app',
      children: React.createElement(App, null, null),
    }),
  ),
);
