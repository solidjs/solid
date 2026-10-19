/**
 * `@solidjs/web/frames/wire` — the frames client's LIVE WIRE tier (frames
 * savings pass §3 row C2, E.a2): what a `live()` loop's connection needs of
 * the frames transport, loaded on demand through the tier mechanism
 * (`prepareTier("wire")`, frame-client.ts).
 *
 * A live server component streams into its address's store for as long as
 * the loop holds the connection: the body is read through the loop's own
 * event-stream reader, the connection's end — death or completion, judged
 * by the frames the body left open — is told to the loop through its wire
 * slot (`LIVE_WIRE`, RFC 11 §9.5 Client face 2), a newer response for the
 * address cancels the open connection (supersession, Client face 4), two
 * loops on one call share one connection, and a reconnect names what the
 * page shows — the address's version ordinal as `Last-Event-ID` and the
 * mount's have-list of server digests as `X-Frame-Have` (§9.5 Resume
 * request) — so the server answers conditionally.
 *
 * What rides in this chunk, and so leaves the eager frames client: the
 * per-host connection map (`connect` joins or opens; `cancel` supersedes),
 * the SSE reader selection and the connection's lifetime (`ended` /
 * `cancel` / `done`, the open-frame count the end is judged by, the sweep
 * the loop may run), the have-list ledger per mount (`have` keeps it off
 * the frame's applied content records, `haveOf` reads it) and the resume
 * request (`resume` + `encodeHaveList`), the range morph (`morph` for a
 * frame's new root over its content, `graft`), and the live content appliers:
 * `hole` morphs a live hole's marked range (row ops included) and `attrs`
 * patches an addressed element, both found through the mount's target
 * cache. A hole or attr record that lands while this chunk loads stays
 * pending in the frame's store, and the install's flush applies it; the
 * server announces the tier wherever it opens a live hole binding. The
 * eager client keeps the dispatch alone: `handle`'s `LIVE_WIRE` arm awaits the load and hands
 * over, `bump` asks the resident module to cancel, the frame's
 * `#recordHave` hands each applied record to `have`, the frame's flush
 * hands each hole / attr record to `hole` / `attrs` with its mount
 * (`#live`), and `resume` answers through the resident module or not at
 * all.
 *
 * Preload-at-call (plan §1, the wire row): `live()`'s decorator fires the
 * handler's `onLive` hook at the call — before its first fetch — and the
 * frames handler's hook is `prepareTier("wire")`, so the import races only
 * the request; `handle`'s arm awaits the same promise before the body is
 * read, so a live connection without this chunk is impossible by
 * construction (no buffer, no hold). The server announces the tier too
 * (`X-Frame-Tiers: wire` on a live response, `sc:tiers` on a document
 * carrying a live source), a warm start for a page that connects before
 * any `live()` call runs.
 *
 * The degraded case, accepted: content applied to a mount BEFORE this
 * chunk was resident (a plain call's response, a document-adopted
 * interior) kept no ledger — `have` was not here to keep it — so a live
 * connect over that mount resumes from the version ordinal with no
 * have-list and the server answers with a full snapshot (today's
 * post-adoption connect already does). Degraded, not wrong; the live
 * response's own root resets the ledger with the tier resident.
 * @experimental
 */
// The eager frames client — the SHARED instance the app runs (external in the
// dist build: rollup.config.js's externalizeFramesClient resolves this to
// `@solidjs/web/frames`; `applyFrameResponse` must be the one the handler's
// own host routes through).
import { applyFrameResponse } from "./client.js";
// The transport's have-list header name and budget — two literals, bundled
// (the client entry stops exporting them: frames residue pass, residue 1).
import { FRAME_HAVE_BUDGET, FRAME_HAVE_HEADER, ends } from "./frame-transport.js";
// The server-function wire layer — the SHARED built instance (external:
// rollup.config.js's externalizeSharedTransport resolves this to
// `@solidjs/web/server-functions/client`).
import {
  ChunkReader,
  LIVE_WIRE,
  frameAddress,
  isEventStream
} from "../../server-functions/src/shared.js";

// Pure DOM helpers and marker constants, bundled into this chunk as their
// own copy (no module state).
import {
  isFrameElement,
  parseFragment,
  preservesOpen,
  rangeClose,
  FRAME_ID_ATTR
} from "./frame-client.js";
// The range morph (frame-morph.ts), bundled into this chunk.
import { reconcileChildren } from "./frame-morph.js";

import type { FrameHost, FrameHostOptions } from "./frame-client.js";

/**
 * A frame's mount as the live appliers reach it (the frame's `#live`):
 * `e` its element, `t` its live-target cache, `c` its claim, `k` its slot
 * index builder, `s` what each hole's range shows, `x` the give-up for a row-op record (mark it spent,
 * cancel the connection so the resume re-sends the hole whole); `w`, in
 * dev builds only, the diagnostic for a hole whose closing comment is gone
 * (this chunk is built once for every condition, so the gate is the eager
 * client's).
 */
interface LiveMount {
  e: Element;
  t: Map<string, Node>;
  c: unknown;
  k(found: Map<string, any>): void;
  s(): Record<string, string>;
  x(key: string, record: unknown): void;
  w?: false | ((marker: string, open: Node) => void);
}

/**
 * The host the handler hands over: the frame host, carrying the lazily
 * loaded deserializer's load (`prepareData`) the transport awaits before a
 * chunk that reads data — forwarded unchanged to the connection's proxy.
 */
type Host = FrameHost & Pick<FrameHostOptions, "prepareData">;

/** A live loop's wire slot (see `LIVE_WIRE` in server-functions/shared.ts). */
interface WireSlot {
  connection: Connection;
  open(body: ReadableStream<Uint8Array> | null): {
    next(): Promise<IteratorResult<string>>;
    cancel?(reason?: unknown): unknown;
  };
}

/** The connection slot the loop renews per connect (`wire.connection`). */
interface Connection {
  ended?: Promise<ConnectionEnd>;
  cancel?(reason: Error): void;
  done?: boolean;
}

/** How a connection ended, as the loop reads it off `connection.ended`. */
interface ConnectionEnd {
  open: number;
  error: Error;
  sweep(): void;
  close(): void;
}

// One live connection per address per host (the handler's `connections`):
// content is keyed by call, so two live readers of one call share one
// connection — the second joins the first's lifetime — otherwise each would
// supersede the other's stream and the two loops would cycle for as long as
// both were mounted.
const connections = new WeakMap<object, Map<string, Connection>>();
const connectionsOf = (host: object) => {
  let map = connections.get(host);
  if (!map) connections.set(host, (map = new Map()));
  return map;
};

// The have-list ledger, per MOUNT (RFC 11 §9.5): what the mount shows, by
// the server's own digests — reset by a root apply (the root IS the
// content; its `holes` seed the entries inside), extended by each reveal,
// kept current by each hole/attr apply. Applied-state, so it tracks the DOM
// without reading it — a fragment received but not yet revealed is not in
// it, and a resume whose connection dies in between still asks for the
// reveal. Absent until a digest-carrying root applies with this tier
// resident. Written through the frame's `#recordHave`; read by `resume`.
const ledgers = new WeakMap<object, Record<string, string> | undefined>();

/**
 * Ledger upkeep for an applied content record (the frame's `#recordHave`
 * hands every one here): `""` is the root and RESETS the ledger to the
 * root's digest and hole map; any other key takes the record's digest and
 * the map of holes inside it. A record without a digest (an older
 * producer) leaves the entry as it was. Without a ledger (no digest-
 * carrying root applied) there is nothing to keep — the next resume is a
 * full snapshot either way.
 * @internal
 */
export function have(
  frame: object,
  key: string,
  record: { digest?: string; holes?: Record<string, string> }
): void {
  if (key === "") {
    ledgers.set(
      frame,
      record.digest === undefined ? undefined : { "": record.digest, ...record.holes }
    );
    return;
  }
  const ledger = ledgers.get(frame);
  if (!ledger || !record || record.digest === undefined) return;
  ledger[key] = record.digest;
  if (record.holes) Object.assign(ledger, record.holes);
}

/**
 * The have-list of what a mount shows — the server-minted digests of the
 * root skeleton under `""`, each live hole and attr hole by ledger key,
 * each revealed fragment by name. `undefined` when the content's provenance
 * carried no digests, or applied before this tier was resident (a
 * document-adopted interior, a plain call's response): a resume then takes
 * the full snapshot.
 * @internal
 */
export function haveOf(frame: object): Record<string, string> | undefined {
  return ledgers.get(frame);
}

/**
 * Encodes a have-list for the header: `key=digest` pairs, comma-joined
 * (keys never contain either separator; the root's key is empty).
 * `undefined` when the list is empty or over budget.
 * @internal
 */
export function encodeHaveList(have: Record<string, string>): string | undefined {
  let out = "";
  for (const key in have) {
    const digest = have[key];
    if (typeof digest !== "string") continue;
    out += (out ? "," : "") + key + "=" + digest;
    if (out.length > FRAME_HAVE_BUDGET) return undefined;
  }
  return out || undefined;
}

/**
 * What a `live` (re)connect of a call resumes from (the handler's
 * `resume`): the address's version ordinal as the position and, when a
 * mount shows the address with a ledger, its have-list under
 * `FRAME_HAVE_HEADER` — omitted over budget, so the render is a full
 * snapshot then. `undefined` when nothing here has shown the call. The
 * ledger is the MOUNT's (it tracks what the DOM shows); the first mount
 * under the address speaks for all — they show the same store.
 * @internal
 */
export function resume(
  host: FrameHost,
  info: { id: string; args: unknown[] },
  versions: Map<string, number>
): { position: string; headers?: Record<string, string> } | undefined {
  const address = frameAddress(info.id, info.args);
  const version = versions.get(address);
  const frame = host.get(address);
  const list = frame && ledgers.get(frame);
  if (version === undefined && !list) return undefined;
  const encoded = list && encodeHaveList(list);
  return {
    position: String(version || 0),
    headers: encoded ? { [FRAME_HAVE_HEADER]: encoded } : undefined
  };
}

/**
 * Supersession (§9.5, Client face 4): a newer version for the address from
 * another response — a getter refetch, a preload, a mutation's region —
 * makes the open connection's later chunks inert under the stale-guard, so
 * it is cancelled and the loop reconnects from the death. The handler's
 * `bump` calls this for every bump, the loop's own reconnect included
 * (whose predecessor has already ended and left the slot).
 * @internal
 */
export function cancel(host: object, address: string): void {
  const map = connections.get(host);
  const connection = map && map.get(address);
  if (connection) {
    map.delete(address);
    connection.cancel!(new Error("Superseded by a newer response for the address."));
  }
}

/**
 * The live arm of the handler's `handle` (§9.5, Client face 2): the binding
 * resolves the call now, and the response's lifetime — its end and how it
 * ended — reaches the loop through its wire slot, so frames CONSUME the
 * loop rather than mirror it: death → the loop's backoff and re-invoke,
 * which resolves this same binding again (stable per address, so an
 * equals-gated reader keeps its instance); completion → the loop
 * completes.
 *
 * A live connection already streaming this address is JOINED: this
 * response is ended here (the server tears its render down on the
 * cancel) and the joining loop sees the shared connection's death when it
 * comes, reconnecting like the loop that owns it (one of the two wins the
 * next slot; the other joins again). Otherwise the response OPENS the
 * address's connection: `bump` versions it and `begin` moves the store to
 * the version at the header; the body is read through the loop's reader
 * when it is framed as an event stream (`ChunkReader` otherwise), handed to
 * the transport under the wire slot; and the end is judged HERE by what the
 * body left open — `complete` is the bounded signal, an unkeyed `error` the
 * failing kind of it; a body that ends with any still open is a DEATH, never
 * a completion (§9.5, Wire) — and told to the loop with the sweep it may run
 * over the open frames if the iteration ends for good by error (`close`
 * leaves them as they stand: a superseding reconnect re-renders them). The
 * transport's own end-of-body sweep (an error record per open frame, the
 * no-loop verdict) is swallowed: the loop decides. A rejected read is a
 * death the loop already sees, not an error record.
 * @internal
 */
export function connect(
  response: Response,
  wire: WireSlot,
  address: string,
  binding: unknown,
  host: Host,
  bump: (address: string) => number,
  begin: (address: string, version: number) => void
): unknown {
  const connection = wire.connection;
  const map = connectionsOf(host);
  const current = map.get(address);
  if (current && !current.done) {
    connection.ended = current.ended;
    const body = response.body;
    if (body) body.cancel().catch(() => {});
    return binding;
  }
  const version = bump(address);
  begin(address, version);
  const inner = isEventStream(response) ? wire.open(response.body) : new ChunkReader(response.body);
  // The body has drained: the transport's sweep follows at once and is not
  // this connection's verdict (below).
  let drained = false;
  let cancelled: Error | undefined;
  const reader = {
    next: () =>
      inner.next().then(result => {
        if (result.done) drained = true;
        return result;
      })
  };
  // The frames this connection has begun (`start`) and not yet ended, as
  // applied (remapped, versioned) — the count the end is judged by. A nested
  // region's chunks ride inside its parent's start/complete and are not
  // counted apart.
  const open = new Map<string, number>();
  const target = {
    prepareData: host.prepareData,
    apply(chunk: any) {
      if (drained) return;
      if (chunk.type === "start") open.set(chunk.id, chunk.version);
      else if (ends(chunk)) open.delete(chunk.id);
      host.apply(chunk);
    }
  };
  let resolveEnd!: (end: ConnectionEnd) => void;
  connection.ended = new Promise(resolve => (resolveEnd = resolve));
  connection.cancel = reason => {
    if (cancelled !== undefined) return;
    cancelled = reason;
    // The reader owns the body's lock; cancelling through it ends the drain
    // as a clean body end (the death is in `open`, not the error).
    try {
      const r = inner.cancel && inner.cancel(reason);
      if (r && typeof (r as any).then === "function")
        (r as Promise<unknown>).then(undefined, () => {});
    } catch {}
  };
  const end = (error?: Error) => {
    const dead = error || cancelled || new Error("Frame stream ended before the frame completed.");
    connection.done = true;
    resolveEnd({
      open: open.size,
      error: dead,
      sweep: () => {
        for (const [id, version] of open)
          host.apply({
            id,
            version,
            r: { ":error": { message: String(dead && dead.message) } }
          });
      },
      close: () => {}
    });
  };
  applyFrameResponse(
    response,
    target as any,
    { as: address, version, [LIVE_WIRE]: reader } as any
  ).then(() => end(), end);
  map.set(address, connection);
  connection.ended.then(() => {
    if (map.get(address) === connection) map.delete(address);
  });
  return binding;
}

/**
 * Apply a live `For` hole's row ops (#4064) to its range `open`…`close`:
 * truncate to `ops.n` rows, morph each changed row's range in place, and
 * append new rows before `close`. A row is everything from its
 * `<!--lr-->` marker to the next one (or `close`); a nested live hole's
 * range is skipped whole. Every changed row parses in ONE fragment, split
 * back at the markers. `morph` is the frame's range reconcile. Returns
 * false, having changed nothing, when the range doesn't hold rows the ops
 * can address — the caller then morphs the whole range.
 * @internal
 */
function rows(
  open: Node,
  close: Node,
  ops: { n: number; r: [number, string][] },
  parse: (html: string) => DocumentFragment,
  morph: (start: Node, end: Node, fragment: DocumentFragment) => void
): boolean {
  const isRow = (n: Node) => n.nodeType === 8 && (n as Comment).data === "lr";
  const starts: Node[] = [];
  for (let n = open.nextSibling; n && n !== close; n = n.nextSibling) {
    if (isRow(n)) starts.push(n);
    else if (n.nodeType === 8 && /^lh:\d+$/.test((n as Comment).data)) {
      const end = "lh:/" + (n as Comment).data.slice(3);
      while (n.nextSibling && !(n.nodeType === 8 && (n as Comment).data === end)) n = n.nextSibling;
    }
  }
  const had = starts.length;
  const n = ops.n;
  // Appends must cover every new index; a range without rows is not a list.
  let appended = 0;
  for (const [i] of ops.r) if (i >= had) appended++;
  if (!had || appended !== Math.max(0, n - had)) return false;
  const fragment = parse(ops.r.map(op => "<!--lr-->" + op[1]).join(""));
  const parsed: DocumentFragment[] = [];
  for (let c = fragment.firstChild; c; ) {
    const next = c.nextSibling;
    if (isRow(c)) parsed.push(document.createDocumentFragment());
    else parsed[parsed.length - 1].appendChild(c);
    c = next;
  }
  if (parsed.length !== ops.r.length) return false;
  const parent = open.parentNode!;
  // Truncate: everything from the first dropped row's marker to `close`.
  if (n < had) while (starts[n].nextSibling !== close) parent.removeChild(close.previousSibling!);
  if (n < had) parent.removeChild(starts[n]);
  ops.r.forEach(([i], k) => {
    if (i < had) {
      const end = i + 1 < Math.min(n, had) ? starts[i + 1] : close;
      morph(starts[i], end, parsed[k]);
    } else {
      const marker = document.createComment("lr");
      parent.insertBefore(marker, close);
      parent.insertBefore(parsed[k], close);
    }
  });
  return true;
}

/**
 * Morph a live hole's marked range (`<!--lh:N-->…<!--lh:/N-->`, marker =
 * `lh:N`) to its re-emitted html — the client half of the Stage 3 hole
 * ledger. The same range-anchored reconcile as the root morph, so
 * interior element identity (focus, media, third-party widget state)
 * survives value ticks. A hole's content may hold slot ranges: the morph
 * then resolves them against the frame's displaced-range index (`index`,
 * one per flush pass: `r` the slot ranges by occurrence, `g` the subtrees
 * the morphs inserted whole), as the root's does, so an occurrence the new
 * content still has keeps its range — interior and mounted state —
 * wherever it moved; the sync after the pass mounts the new ones and
 * unmounts the ones gone. Returns whether the markers were found and the
 * morph ran.
 * @internal
 */
export function hole(
  f: LiveMount,
  marker: string,
  record: any,
  index: { r?: Map<string, any>; g?: Node[] }
): boolean {
  const open = target(f, "hole:" + marker, n => n.nodeType === 8 && (n as Comment).data === marker);
  if (!open) return false;
  const close = rangeClose(open, "lh:/" + marker.slice(3));
  if (!close) {
    f.w && f.w(marker, open);
    return false;
  }
  if (record.rows) {
    // Row ops (#4064): only the rows that changed, applied where the range
    // shows the emission they were taken against. Anywhere else (a fresh
    // mount replaying the store, a record that landed on one that never
    // applied) the live connection resumes, its have-list naming what the
    // range shows, and the hole comes back whole.
    if (
      f.s()[marker] !== record.base ||
      !rows(open, close, record.rows, parseFragment, (start, end, fragment) =>
        reconcileChildren(start.parentNode!, fragment, start, end, f.c)
      )
    ) {
      // Once: the record is spent, the resume re-sends the hole whole.
      f.x("hole:" + marker, record);
      return false;
    }
  } else {
    // One index for the pass: a range one hole drops may be the one
    // another hole now places. A frame with no slot range needs none.
    if (!index.r) (f.k((index.r = new Map())), (index.g = []));
    reconcileChildren(
      open.parentNode!,
      parseFragment(record.value),
      open,
      close,
      f.c,
      index.r.size ? index.r : null,
      index.g
    );
  }
  return true;
}

/**
 * Apply a live attr-hole re-emission: find the element addressed
 * `data-lha="addr"` in the frame's range, parse the rebuilt attribute
 * text through a scratch element (native entity decoding), and patch the
 * element to match it the way the root morph matches server output
 * (`morphAttributes`): set what's present, remove what is not — the text
 * is the tag's WHOLE attribute area, so a name absent from it has
 * vanished on the server, whether or not the emission names it in
 * `removed` (a resume's re-emission cannot: the server holds the client's
 * previous text only as a digest). The address itself and a
 * `<details>`/`<dialog>` `open` are the morph's exceptions here too.
 * Returns false when the element isn't in the DOM yet (pending; later
 * flushes retry).
 * @internal
 */
export function attrs(f: LiveMount, addr: string, record: any): boolean {
  const el = target(
    f,
    "attr:" + addr,
    n => n.nodeType === 1 && (n as Element).getAttribute("data-lha") === addr
  ) as Element | null;
  if (!el) return false;
  const parsed = parseFragment(`<i${record.value}></i>`).firstChild as Element | null;
  const keepOpen = preservesOpen(el);
  const current = el.attributes;
  for (let i = current.length - 1; i >= 0; i--) {
    const name = current[i].name;
    if (name === "data-lha" || (keepOpen && name === "open")) continue;
    if (!parsed || !parsed.hasAttribute(name)) el.removeAttribute(name);
  }
  if (parsed) {
    for (let i = 0; i < parsed.attributes.length; i++) {
      const { name, value } = parsed.attributes[i];
      if (keepOpen && name === "open") continue;
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
  }
  if (record.removed)
    for (const name of record.removed) {
      if (keepOpen && name === "open") continue;
      el.removeAttribute(name);
    }
  return true;
}

/** A live target: the cached node while it is still this frame's and
 *  still matches, else a fresh search (cached when found). */
function target(f: LiveMount, key: string, test: (n: Node) => boolean): Node | null {
  let n: Node | null | undefined = f.t.get(key);
  if (n && test(n) && f.e.contains(n)) return n;
  n = findTarget(f.e.firstChild, test);
  n && f.t.set(key, n);
  return n;
}

/**
 * Depth-first search among `n` and its next siblings for a live-hole
 * target — an open comment (`<!--lh:N-->`) or an addressed element
 * (`data-lha`), matched by `test`. Descends through elements — including
 * region elements, whose holes belong to the stream that produced them (one
 * id counter per response) — but never into nested boundary frames (bare
 * ids): those are separate streams with their own hole/address namespaces.
 */
function findTarget(n: Node | null, test: (n: Node) => boolean): Node | null {
  for (; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const fid = isFrameElement(n) ? (n as Element).getAttribute(FRAME_ID_ATTR) : null;
      if (fid === null || fid.includes(".")) {
        if (test(n)) return n;
        const found = findTarget(n.firstChild, test);
        if (found) return found;
      }
    } else if (test(n)) return n;
  }
  return null;
}

export { graft, morph } from "./frame-morph.js";
