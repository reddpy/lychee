import { app, BrowserWindow } from "electron";
import path from "path";
import { startBridgeServer, type BridgeServer } from "../sync/bridge";

/**
 * Hosts the cross-process Yjs bridge for the app. Peers (the MCP server, sync
 * helpers) connect to a local socket; updates flow peer ↔ app and are forwarded
 * to every renderer window. The socket lives in userData so only the local user
 * can reach it and it never lands in a synced folder.
 */

let server: BridgeServer | null = null;
let socketPath: string | null = null;

export function noteBridgeSocketPath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\lychee-sync-${process.env.USERNAME ?? "user"}`;
  }
  return path.join(app.getPath("userData"), "lychee-sync.sock");
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

export function startNoteBridge(): void {
  if (server) return;
  socketPath = noteBridgeSocketPath();
  server = startBridgeServer(
    socketPath,
    (docId, update) => broadcast("bridge:update", { docId, update }),
    (docId) => broadcast("bridge:peer-joined", { docId }),
    (docId, update) => broadcast("bridge:awareness", { docId, update }),
  );
  console.log(`[bridge] listening on ${socketPath}`);
}

export function stopNoteBridge(): void {
  server?.close();
  server = null;
  socketPath = null;
}

/** Send an app-originated update out to connected peers. */
export function publishToBridge(docId: string, update: string): void {
  server?.publish(docId, update);
}

/** Send an app-originated awareness update out to connected peers. */
export function publishAwarenessToBridge(docId: string, update: string): void {
  server?.publishAwareness(docId, update);
}

export function isNoteBridgeRunning(): boolean {
  return server !== null;
}

export function noteBridgePathForConfig(): string | null {
  return socketPath;
}
