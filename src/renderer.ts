import '@fontsource-variable/inter';
import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import { ErrorBoundary } from './components/error-boundary';
import { loadAppConfig } from './renderer/app-config';
import { hydrateAppearance } from './renderer/appearance-store';
import { hydrateGeneralPreferences } from './renderer/general-preferences-store';
import { setPendingWorkspaceSession } from './renderer/workspace-session-runtime';

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

async function bootstrap() {
  const config = await loadAppConfig();
  hydrateAppearance(config.appearance);
  hydrateGeneralPreferences(config.general);
  setPendingWorkspaceSession(config.session);
  createRoot(el).render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(ErrorBoundary, {
        scope: 'app',
        children: React.createElement(App, {
          initialSidebarPreferences: config.sidebar,
        }),
      }),
    ),
  );
}

void bootstrap();
