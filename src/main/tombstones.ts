import { randomUUID } from "crypto";
import type { TombstoneAction } from "../shared/tombstone";
import { getSetting, setSetting } from "./repos/settings";
import { appendTombstone as appendTombstoneIo, readTombstones } from "./tombstone-io";

export { TOMBSTONE_DIRECTORY, readTombstones, compactTombstones } from "./tombstone-io";

const DEVICE_ID_KEY = "deviceId";

/** Stable per-install id, so each device appends only to its own log. */
export function getDeviceId(): string {
  let id = getSetting(DEVICE_ID_KEY);
  if (!id) {
    id = randomUUID();
    setSetting(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Append a tombstone to this device's log. Thin wrapper over the filesystem IO
 * that supplies the device id from settings.
 */
export function appendTombstone(
  vault: string,
  id: string,
  action: TombstoneAction,
  device: string = getDeviceId(),
  at: string = new Date().toISOString(),
): void {
  appendTombstoneIo(vault, id, action, device, at);
}

/** Append a tombstone for each id (e.g. a note plus its descendants). */
export function appendTombstones(vault: string, ids: string[], action: TombstoneAction): void {
  const device = getDeviceId();
  const at = new Date().toISOString();
  for (const id of ids) appendTombstone(vault, id, action, device, at);
}
