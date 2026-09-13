import '@fontsource-variable/inter';
import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import { ErrorBoundary } from './components/error-boundary';
import { loadAppConfig } from './renderer/app-config';
import { hydrateAppearance } from './renderer/appearance-store';
import { hydrateGeneralPreferences } from './renderer/general-preferences-store';
import { hydrateEditorPreferences } from './renderer/editor-preferences-store';
import { setPendingWorkspaceSession } from './renderer/workspace-session-runtime';

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

async function bootstrap() {
  const config = await loadAppConfig();
  hydrateAppearance(config.appearance);
  hydrateGeneralPreferences(config.general);
  hydrateEditorPreferences(config.editor);
  setPendingWorkspaceSession(config.session);
  createRoot(el).render(
    // NOTE: deliberately NOT wrapped in React.StrictMode. StrictMode only affects
    // development, where it double-invokes every component render and effect —
    // crippling for the plugin-heavy Lexical editor (double-mounted listeners,
    // double headless conversions) and a major source of dev-only scroll/typing
    // lag. Production behavior is identical without it.
    React.createElement(ErrorBoundary, {
      scope: 'app',
      children: React.createElement(App, {
        initialSidebarPreferences: config.sidebar,
      }),
    }),
  );
}

void bootstrap();
