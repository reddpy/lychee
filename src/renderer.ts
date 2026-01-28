/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';

console.log(
  '👋 This message is being logged by "renderer.js", included via webpack',
);

async function smokeTestBackend() {
  const { document } = await window.lychee.invoke('documents.create', {
    title: 'Hello Lychee',
    content: 'First note',
  });

  const { documents } = await window.lychee.invoke('documents.list', { limit: 5 });
  console.log('[backend smoke test] created:', document);
  console.log('[backend smoke test] list:', documents);
}

smokeTestBackend().catch((err) => console.error('[backend smoke test] failed', err));
