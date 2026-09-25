/**
 * The records tables: `OBSERVE.records` folded into `artifact.records`, on
 * either platform — the in-process capture and the browser bridge open the
 * same subscriptions.
 */
import { OBSERVE } from "@solidjs/signals";
import type { RecordEvent } from "solid-js";
import type { ArtifactRecordType, ArtifactRecords } from "./types.js";

/** The record types this format knows; `artifact.records` has one table per entry. */
export const RECORD_TYPES = [
  "boundary",
  "recovery",
  "invocation",
  "frame",
  "call"
] as const satisfies readonly ArtifactRecordType[];

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
  const channel = OBSERVE!.records;
  const tables: ArtifactRecords = {
    boundary: [],
    recovery: [],
    invocation: [],
    frame: [],
    call: []
  };
  const unsubscribe = RECORD_TYPES.map(type =>
    channel.subscribe(type, (event: RecordEvent<typeof type>) => {
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
