/**
 * The records tables: `OBSERVE.records` folded into `artifact.records`, on
 * either platform — the in-process capture and the browser bridge open the
 * same subscriptions.
 */
import { OBSERVE } from "@solidjs/signals";
import type { ArtifactRecords } from "./types.js";

/** The record types this format knows; `artifact.records` has one table per entry. */
export const RECORD_TYPES = ["boundary", "invocation", "frame", "call"] as const;

// The channel, read structurally: its record types are declared by
// `solid-js` and `@solidjs/web`, which this package does not depend on —
// from here the catalogue is empty, and `subscribe`'s type parameter with it.
interface RecordsChannel {
  subscribe(type: string, listener: (event: unknown) => void): () => void;
}

export interface RecordsCapture {
  stop(): ArtifactRecords;
}

/**
 * Opens the tables. Records are delivered on settle already serializable
 * (the live handles travel in a second argument this ignores), so the
 * capture is a copy and an append — the record object is shared with every
 * other listener — and each table keeps delivery order.
 */
export function captureRecords(): RecordsCapture {
  const channel = OBSERVE!.records as unknown as RecordsChannel;
  const tables: ArtifactRecords = { boundary: [], invocation: [], frame: [], call: [] };
  const unsubscribe = RECORD_TYPES.map(type =>
    channel.subscribe(type, event => {
      (tables[type] as object[]).push({ ...(event as object) });
    })
  );
  return {
    stop() {
      for (const off of unsubscribe) off();
      return tables;
    }
  };
}
