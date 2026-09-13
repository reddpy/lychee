import { describe, it, expect } from "vitest"

import { buildImportRequests } from "../vault-import"
import type { VaultImportItem } from "@/shared/vault-import"

describe("buildImportRequests", () => {
  it("maps plan items to requests with markdown content", () => {
    const item: VaultImportItem = {
      relativePath: "A/B.md",
      id: "id-b",
      parentId: "id-a",
      title: "B",
      emoji: null,
      bookmarkedAt: null,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-02-01T00:00:00.000Z",
      contentSchemaVersion: 1,
      order: 3,
      body: "# B\n\nbody",
    }
    const [request] = buildImportRequests([item])
    expect(request).toMatchObject({
      id: "id-b",
      parentId: "id-a",
      title: "B",
      sortOrder: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      contentSchemaVersion: 1,
    })
    expect(request.content).toBe(item.body)
  })
})
