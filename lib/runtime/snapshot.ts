import type { RuntimeSnapshot } from "./types";
/** Cursors are monotonic within a server lifetime; a restart starts a new epoch. */
export function mergeRuntimeSnapshot(previous: RuntimeSnapshot | undefined, incoming: RuntimeSnapshot): RuntimeSnapshot {
  return !previous || incoming.epoch !== previous.epoch || incoming.cursor >= previous.cursor ? incoming : previous;
}
