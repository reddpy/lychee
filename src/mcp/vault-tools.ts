/**
 * MCP-facing facade over the shared file-first note store.
 *
 * All logic lives in `src/main/vault-store.ts` so the app and the MCP server
 * mutate the vault through exactly the same implementation. This module is kept
 * as the stable import surface for the MCP server and its tests.
 */
export * from "../main/vault-store";
