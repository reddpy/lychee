import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { IpcInvoke, IpcOn } from './shared/ipc-types';

const invoke: IpcInvoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

const on: IpcOn = (channel, callback) => {
  const handler = (_event: IpcRendererEvent, payload: unknown) => {
    callback(payload as never);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

contextBridge.exposeInMainWorld('lychee', {
  invoke,
  on,
});

declare global {
  interface Window {
    lychee: {
      invoke: IpcInvoke;
      on: IpcOn;
    };
  }
}
