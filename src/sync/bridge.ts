import net from "net";
import fs from "fs";

/**
 * Cross-process Yjs transport for notes.
 *
 * A tiny length-delimited (newline JSON) relay over a local socket — a Unix
 * domain socket on macOS/Linux, a named pipe on Windows. The Electron app hosts
 * the server; any Node process (the MCP server, a sync helper) connects as a
 * peer, joins a note's doc, and exchanges opaque Yjs updates. Updates are
 * base64-encoded binary.
 *
 * This is deliberately transport-only: docs, persistence, and conflict handling
 * live above it. `SyncAdapter` adapters wrap it for the app and MCP.
 */

type Message =
  | { t: "join"; docId: string }
  | { t: "leave"; docId: string }
  | { t: "update"; docId: string; update: string }
  | { t: "awareness"; docId: string; update: string }
  | { t: "peer-joined"; docId: string };

function encode(message: Message): string {
  return `${JSON.stringify(message)}\n`;
}

export interface BridgeServer {
  /** Send a doc update to every connected peer joined to the doc. */
  publish(docId: string, updateBase64: string): void;
  /** Send an awareness update to every connected peer joined to the doc. */
  publishAwareness(docId: string, updateBase64: string): void;
  close(): void;
}

/**
 * Start the relay. `onUpdate`/`onAwareness` fire when a connected *peer*
 * publishes (the app forwards them into its renderer); `publish*` send
 * app-originated messages out to peers.
 */
export function startBridgeServer(
  socketPath: string,
  onUpdate: (docId: string, updateBase64: string) => void,
  onPeerJoined?: (docId: string) => void,
  onAwareness?: (docId: string, updateBase64: string) => void,
): BridgeServer {
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch {
    // best-effort
  }

  const docs = new Map<string, Set<net.Socket>>();

  const relay = (
    docId: string,
    type: "update" | "awareness",
    payloadBase64: string,
    except: net.Socket | null,
  ): void => {
    const line =
      type === "update"
        ? encode({ t: "update", docId, update: payloadBase64 })
        : encode({ t: "awareness", docId, update: payloadBase64 });
    for (const peer of docs.get(docId) ?? []) {
      if (peer === except || peer.destroyed) continue;
      try {
        peer.write(line);
      } catch {
        // best-effort
      }
    }
  };

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    const joined = new Set<string>();
    let buffer = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;

        let message: Message;
        try {
          message = JSON.parse(line) as Message;
        } catch {
          continue;
        }

        if (message.t === "join" && message.docId) {
          joined.add(message.docId);
          const set = docs.get(message.docId) ?? new Set<net.Socket>();
          set.add(socket);
          docs.set(message.docId, set);
          // Ask existing peers to (re)publish their state so the joiner catches up.
          const notice = encode({ t: "peer-joined", docId: message.docId });
          for (const peer of set) {
            if (peer === socket || peer.destroyed) continue;
            try {
              peer.write(notice);
            } catch {
              // best-effort
            }
          }
          // Also notify the host (the app), which is not a socket peer.
          onPeerJoined?.(message.docId);
        } else if (message.t === "leave" && message.docId) {
          joined.delete(message.docId);
          docs.get(message.docId)?.delete(socket);
        } else if (message.t === "update" && message.docId && message.update) {
          onUpdate(message.docId, message.update);
          relay(message.docId, "update", message.update, socket);
        } else if (message.t === "awareness" && message.docId && message.update) {
          onAwareness?.(message.docId, message.update);
          relay(message.docId, "awareness", message.update, socket);
        }
      }
    });

    const cleanup = (): void => {
      for (const docId of joined) {
        const set = docs.get(docId);
        set?.delete(socket);
        if (set && set.size === 0) docs.delete(docId);
      }
      joined.clear();
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  server.listen(socketPath);

  return {
    publish(docId, updateBase64) {
      relay(docId, "update", updateBase64, null);
    },
    publishAwareness(docId, updateBase64) {
      relay(docId, "awareness", updateBase64, null);
    },
    close() {
      server.close();
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // best-effort
      }
    },
  };
}

export interface BridgeClient {
  /**
   * Join a note's doc. `onUpdate` receives peers' updates; `onPeerJoined` fires
   * when another peer joins (so the caller can publish its current state).
   */
  join(
    docId: string,
    onUpdate: (updateBase64: string) => void,
    onPeerJoined?: () => void,
  ): void;
  /** Subscribe to peers' awareness updates for a doc. */
  subscribeAwareness(docId: string, onAwareness: (updateBase64: string) => void): () => void;
  publish(docId: string, updateBase64: string): void;
  publishAwareness(docId: string, updateBase64: string): void;
  close(): void;
}

export function connectBridge(socketPath: string): Promise<BridgeClient> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.setEncoding("utf8");
    // A connected peer must not, by itself, keep the host process alive (the
    // MCP server exits when its stdio client goes away).
    socket.unref();

    const handlers = new Map<
      string,
      { onUpdate: (u: string) => void; onPeerJoined?: () => void }
    >();
    const awarenessHandlers = new Map<string, Set<(u: string) => void>>();
    let buffer = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        let message: Message;
        try {
          message = JSON.parse(line) as Message;
        } catch {
          continue;
        }
        if (!("docId" in message) || !message.docId) continue;
        if (message.t === "awareness") {
          for (const cb of awarenessHandlers.get(message.docId) ?? []) cb(message.update);
          continue;
        }
        const handler = handlers.get(message.docId);
        if (!handler) continue;
        if (message.t === "update") handler.onUpdate(message.update);
        else if (message.t === "peer-joined") handler.onPeerJoined?.();
      }
    });

    socket.once("error", reject);
    socket.once("connect", () => {
      resolve({
        join(docId, onUpdate, onPeerJoined) {
          handlers.set(docId, { onUpdate, onPeerJoined });
          socket.write(encode({ t: "join", docId }));
        },
        subscribeAwareness(docId, onAwareness) {
          const set = awarenessHandlers.get(docId) ?? new Set();
          set.add(onAwareness);
          awarenessHandlers.set(docId, set);
          return () => {
            set.delete(onAwareness);
          };
        },
        publish(docId, updateBase64) {
          socket.write(encode({ t: "update", docId, update: updateBase64 }));
        },
        publishAwareness(docId, updateBase64) {
          socket.write(encode({ t: "awareness", docId, update: updateBase64 }));
        },
        close() {
          socket.end();
        },
      });
    });
  });
}
