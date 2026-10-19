// @ts-nocheck
/**
 * The frames wire's encoder — the server's half of "the wire is the store".
 *
 * A frame stream on the wire is a sequence of VERSIONED BATCHES OF KEYED
 * RECORDS, `{ id, version, r: { key: record, ... } }`: exactly the write the
 * client's resident store takes (`FrameWrite`, `host.apply`), so the client
 * applies what arrives without translating it. Three messages are not
 * records and keep a `type`:
 *
 *   - `start` — a response's version opens on the address (`store.open`):
 *     the flight the address is in until a write lands it. It writes no
 *     record; a record-less batch would be indistinguishable from the
 *     reveal-time empty re-sync.
 *   - `data` — a node of the response-scoped data table the records' `$ref`
 *     args resolve through. Not frame state (it never enters the store) and
 *     ordered ahead of the records that read it.
 *   - `outcome` — a single-flight response's envelope node (not addressed
 *     to any frame; `frameFlightResponse`).
 *
 * Any message may also carry `tiers` (the in-band tier announcement): it is
 * about the response, not the frame, so it rides beside `r`, never in it.
 *
 * The producer itself still speaks typed events (`FrameChunk`, what
 * `renderServerComponent` pipes): they drive server-side decisions — the
 * first flush the bound counts from, the census, the head's tier
 * announcement — and this encoder turns each one into its wire message at
 * the response's serialization seam.
 * @experimental
 */
import type { FrameChunk } from "./frame-client.js";

/** The records one producer event writes (see `encodeFrameChunk`). */
export function chunkRecords(chunk: FrameChunk): Record<string, unknown>;

export function chunkRecords(chunk) {
  switch (chunk.type) {
    // Content records carry the server's digests through (see the ledger
    // on FrameImpl): the root's and a fragment's own, and the map of live
    // holes inside them.
    case "html":
      return { "": { kind: "html", value: chunk.html, digest: chunk.digest, holes: chunk.holes } };
    case "fragment":
      return {
        [`seg:${chunk.key}`]: {
          kind: "html",
          value: chunk.html,
          digest: chunk.digest,
          holes: chunk.holes
        }
      };
    case "reveal": {
      // A reveal sets segment gates (a fallback reveal, fallback gates).
      // The event's `waitForStyles` is not a record: the client's gate
      // reads the segment's own assets record.
      const records = {};
      const gate = chunk.fallback ? "fallback" : "reveal";
      for (const key of chunk.keys) records[`seg:${key}:${gate}`] = true;
      return records;
    }
    case "assets": {
      // The head-affecting members only — the addressing is the batch's
      // and the key's.
      const { type, id, version, key, tiers, ...record } = chunk;
      return { [`seg:${key}:assets`]: record };
    }
    case "slot":
      // A named slot invocation: the client render function for `key` is
      // called with these args. Data args are `{$ref}`s into the response's
      // data table; server-content args are `{$frame}` nested regions.
      return { [`slot:${chunk.key}`]: { kind: "slot", args: chunk.args } };
    case "hole":
      // A live-hole re-emission: the re-resolved HTML for a marked content
      // range (`<!--lh:N-->…<!--lh:/N-->`). Response-scoped like segments —
      // hole ids restart per render — so these clear on version bumps.
      return {
        [`hole:${chunk.key}`]: {
          kind: "html",
          value: chunk.html,
          digest: chunk.digest,
          holes: chunk.holes,
          // Row ops against the emission digested `base` (#4064).
          rows: chunk.rows,
          base: chunk.base
        }
      };
    case "attr":
      // A live attr-hole re-emission: rebuilt attribute text for the
      // element addressed `data-lha="key"`, with explicit removals.
      return {
        [`attr:${chunk.key}`]: {
          kind: "attrs",
          value: chunk.attrs,
          removed: chunk.removed,
          digest: chunk.digest
        }
      };
    case "ops":
      // One sweep's members as one batch: the frame flushes once over all
      // of them (C13).
      return Object.assign({}, ...chunk.ops.map(chunkRecords));
    case "complete":
      // `:bound` beside `:complete` — the producer's streaming bound when
      // it cut the response there (absent for a settled one): a consumer
      // can tell a cut-off from a settled value; the frame landed either
      // way.
      return chunk.bound ? { ":complete": true, ":bound": chunk.bound } : { ":complete": true };
    case "error":
      // Keyed errors scope to what the key names: a hole key (`lh:N`,
      // `lha:N`) is a failed live-hole sweep, terminal for the hole; other
      // keys are segment-scoped (an errored fragment). Unkeyed errors are
      // the frame's own — `frame.error` reads that record.
      if (!chunk.key) return { ":error": chunk.error };
      return {
        [`${/^lha?:/.test(chunk.key) ? "hole" : "seg"}:${chunk.key}:error`]: chunk.error
      };
    default:
      return {};
  }
}

/**
 * One producer event as its wire message: `start` / `data` / `outcome` as
 * they are, everything else as a `{ id, version, r }` batch (`tiers` beside
 * it when the event carries an announcement).
 * @experimental
 */
export function encodeFrameChunk(chunk: any): any;

export function encodeFrameChunk(chunk) {
  switch (chunk.type) {
    case "start":
    case "data":
    case "outcome":
      return chunk;
  }
  const message: any = { id: chunk.id, version: chunk.version, r: chunkRecords(chunk) };
  if (chunk.tiers) message.tiers = chunk.tiers;
  return message;
}

/**
 * One document-face live op as its `sc:live` batch: the records, unaddressed
 * (every adopted boundary writes them at its own address), with the
 * producing frame's id (`fid`) on the ones only its boundary applies —
 * store-keyed slot records, the frame's own `:error`.
 * @experimental
 */
export function encodeLiveOp(op: any): { r: Record<string, unknown>; fid?: string };

export function encodeLiveOp(op) {
  const batch: any = { r: chunkRecords(op) };
  if (op.fid) batch.fid = op.fid;
  return batch;
}
