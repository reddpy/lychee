import { contextBridge, ipcRenderer } from 'electron';
import type { IpcInvoke } from './shared/ipc-types';

const invoke: IpcInvoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('lychee', {
  invoke,
});

declare global {
  interface Window {
    lychee: {
      invoke: IpcInvoke;
    };
  }
}
