import fs from "fs";
import path from "path";
import {
  contentHashOf,
  extensionToMime,
  findImageByContentHash,
  mimeToExtension,
  readImageForAsset,
  saveImageBuffer,
} from "./repos/images";
import { resolveWithinVault, writeVaultBinaryFile } from "./vault";

/**
 * Asset/binary sync at the vault boundary.
 *
 * The editor is vault-agnostic and encodes a locally-stored binary as the
 * internal token `lychee-asset://<localId>`. Main rewrites that boundary:
 *
 *   export: lychee-asset://<id>      ->  assets/<sha256>.<ext>   (copies bytes)
 *   import: assets/<sha256>.<ext>    ->  lychee-asset://<localId>
 *
 * The vault format is media-agnostic on purpose: assets are content-addressed,
 * immutable, deduplicate across notes/devices, and a cloud/git sync of the
 * `assets/` directory is conflict-free. Images are simply the first asset kind
 * (`images` table); video/file kinds plug into the `LocalAssetStore` below
 * without changing the on-disk format or the markdown token.
 */

export const ASSET_DIRECTORY = "assets";
export const ASSET_TOKEN_PREFIX = "lychee-asset://";

interface LocalAsset {
  buffer: Buffer;
  mimeType: string;
  contentHash: string;
}

/** Read a locally-stored asset by id, backfilling its content hash if needed. */
type LocalAssetStore = {
  read: (id: string) => LocalAsset | null;
  /** Reuse an existing asset with this content, or store a new one. */
  findOrCreate: (buffer: Buffer, mimeType: string) => string | null;
};

// Images are the first (and currently only) asset kind. Additional kinds
// (video, arbitrary files) register here as they gain storage + nodes.
const imagesStore: LocalAssetStore = {
  read: (id) => readImageForAsset(id),
  findOrCreate: (buffer, mimeType) => {
    const existing = findImageByContentHash(contentHashOf(buffer));
    if (existing) return existing.id;
    try {
      return saveImageBuffer(buffer, mimeType).id;
    } catch {
      return null;
    }
  },
};

const STORES: LocalAssetStore[] = [imagesStore];

function readLocalAsset(id: string): LocalAsset | null {
  for (const store of STORES) {
    const asset = store.read(id);
    if (asset) return asset;
  }
  return null;
}

function findOrCreateLocalAsset(buffer: Buffer, mimeType: string): string | null {
  for (const store of STORES) {
    const id = store.findOrCreate(buffer, mimeType);
    if (id) return id;
  }
  return null;
}

// `](target)` / `](target "title")`
const EXPORT_TARGET = /\]\(\s*(lychee-asset:\/\/[A-Za-z0-9._-]+)(\s+"[^"]*")?\s*\)/g;
const IMPORT_TARGET =
  /\]\(\s*(?:\.\/)?(assets\/[A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov|pdf|zip))(\s+"[^"]*")?\s*\)/gi;

/** Copy every referenced local asset into the vault and rewrite links to it. */
export function exportAssetsToVault(vault: string, markdown: string): string {
  return markdown.replace(EXPORT_TARGET, (full, token: string, title = "") => {
    const id = token.slice(ASSET_TOKEN_PREFIX.length);
    const asset = ensureAssetForId(vault, id);
    if (!asset) return full; // asset missing locally; leave the token untouched
    return `](${asset}${title})`;
  });
}

/** Materialize every referenced vault asset locally and rewrite links to it. */
export function importAssetsFromVault(vault: string, markdown: string): string {
  return markdown.replace(IMPORT_TARGET, (full, assetRelative: string, title = "") => {
    const id = ensureAssetFromFile(vault, assetRelative);
    if (!id) return full; // unreadable/unsupported asset; leave the path
    return `](${ASSET_TOKEN_PREFIX}${id}${title})`;
  });
}

function ensureAssetForId(vault: string, id: string): string | null {
  const asset = readLocalAsset(id);
  if (!asset) return null;
  const extension = mimeToExtension(asset.mimeType) ?? extensionFromMime(asset.mimeType);
  if (!extension) return null;

  const assetRelative = `${ASSET_DIRECTORY}/${asset.contentHash}.${extension}`;
  const assetAbsolute = resolveWithinVault(vault, assetRelative);
  if (!fs.existsSync(assetAbsolute)) {
    writeVaultBinaryFile(vault, assetRelative, asset.buffer);
  }
  return assetRelative;
}

function ensureAssetFromFile(vault: string, assetRelative: string): string | null {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(resolveWithinVault(vault, assetRelative));
  } catch {
    return null;
  }

  const mimeType = extensionToMime(path.extname(assetRelative).slice(1));
  if (!mimeType) return null;

  return findOrCreateLocalAsset(buffer, mimeType);
}

function extensionFromMime(mimeType: string): string | null {
  const subtype = mimeType.split("/")[1];
  if (!subtype) return null;
  return subtype.replace(/[^a-z0-9]/gi, "") || null;
}
