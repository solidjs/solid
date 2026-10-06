// @ts-nocheck
/**
 * Client frame runtime — the consumer side of a frame stream. A frame
 * renders server-owned content into a DOM boundary from a resident keyed
 * record store: chunks are writes, not events, so application is
 * prerequisite-driven and order-independent. Client-owned slot ranges
 * inside the boundary are preserved across server updates — the
 * version is a stale-guard only ("policy A"): newer content morphs in
 * place, and teardown is `dispose()`, never a version bump.
 *
 * EXPERIMENTAL — the frames/server-components surface ships as an
 * experimental preview, excluded from the 2.0 stability guarantee: API
 * shapes and the wire format may change between prereleases (RFC 11).
 * Every export in this module is `@experimental`.
 */

// The module's one import, and only for the dev-tier integrity check
// (`devCheckRange`): the diagnostics channel and its console face. `solid-js`
// is external to every frames client bundle, so this reaches the same
// `OBSERVE` the rest of the page runs on — no cross-bundle seam to keep in
// agreement, unlike the registered-symbol brands this module otherwise
// duplicates by design. The prod build folds the call out with the gate.
import { DEV, OBSERVE } from "solid-js";

/**
 * One transport chunk of a frame stream, addressed by frame `id`.
 * @experimental
 */
export type FrameChunk =
  | { type: "start"; id: string; version: number }
  | {
      type: "html";
      id: string;
      version: number;
      html: string;
      /** Server-minted digest of the root's skeleton (RFC 11 §9.5, Hole hashes). */
      digest?: string;
      /** Digests of the live holes inside the html, by ledger key (`lh:N`, `lha:N`). */
      holes?: Record<string, string>;
    }
  | {
      type: "fragment";
      id: string;
      version: number;
      key: string;
      html: string;
      digest?: string;
      holes?: Record<string, string>;
    }
  | {
      type: "hole";
      id: string;
      version: number;
      key: string;
      html: string;
      digest?: string;
      holes?: Record<string, string>;
    }
  | {
      type: "attr";
      id: string;
      version: number;
      key: string;
      attrs: string;
      removed?: string[];
      digest?: string;
    }
  | {
      type: "reveal";
      id: string;
      version: number;
      keys: string[];
      waitForStyles?: boolean;
      fallback?: boolean;
    }
  | {
      type: "data";
      id: string;
      version: number;
      key?: string;
      node?: unknown;
      initial?: boolean;
      /** Eval-style hydration script — only when produced with the hydration serializer. */
      payload?: string;
    }
  | {
      type: "assets";
      id: string;
      version: number;
      key: string;
      modules?: string[];
      styles?: string[];
      inlineStyles?: { id: string; content?: string; attrs?: Record<string, string> }[];
      preloads?: { href?: string; attrs: Record<string, string> }[];
    }
  | { type: "slot"; id: string; version: number; key: string; args: Record<string, unknown> }
  | { type: "complete"; id: string; version: number }
  | { type: "error"; id: string; version: number; key?: string; error: unknown };

/**
 * One store write applied to a frame: `r` maps record keys to values
 * (`chunkToRecords` produces these from wire chunks) and `version` is the
 * stream stamp — an older version than the frame's current one is ignored.
 * @experimental
 */
export interface FrameWrite {
  version: number;
  r: Record<string, unknown>;
}

/**
 * Context passed to a slot callback.
 * @experimental
 */
export interface SlotContext {
  /**
   * True only for the hydration-attach invocation of an adopted
   * document-SSR range — the one call a consumer may answer with a claim
   * (`existing` IS the server-rendered output for these args). Unset on
   * stream-driven re-calls: those must render for real, or content the
   * re-call displaced (e.g. `{$frame}` region ranges) is dropped.
   */
  adopted?: boolean;
  /**
   * Whether this occurrence is a render-prop CALL (the producer placed it
   * with arguments — possibly empty — via a slot record) as opposed to a
   * direct-insert position. Consumers cannot tell from the resolved props
   * alone: an argless render prop and a direct insert both arrive as `{}`,
   * but one is a function to invoke and the other a value to place.
   */
  invoked?: boolean;
  /**
   * Register cleanup for when this occurrence's range is removed from the
   * server content, or the owning frame is disposed.
   */
  onCleanup(fn: () => void): void;
  /**
   * Live-props opt-in: a binding that registers here receives the
   * re-resolved props when a re-sent record's args CHANGE in value, instead
   * of the occurrence being re-called — the invocation's instance (and its
   * client state) survives the change. Register synchronously during the
   * invocation; one updater per occurrence (last registration wins). A
   * genuine re-call or unmount clears it before/with the binding it served.
   */
  onUpdate(fn: (props: Record<string, unknown>) => void): void;
  /**
   * The range's current interior — server-rendered client content on an
   * adopted document-SSR boot, or the previous output on a re-call. A
   * framework binding hydrates onto it and returns `undefined` to claim it
   * in place (zero DOM mutation).
   */
  existing: ChildNode[];
  /**
   * The range's own marker comments, when the occurrence has a placed range.
   * A framework binding whose slot content is reactive at the top level (a
   * boundary accessor, changing route children) owns the interior instead of
   * returning nodes: bind before `end` with the framework's insert primitive
   * and return `undefined` — the frame leaves the range alone (server morphs
   * already protect slot ranges).
   */
  range?: { start: Comment; end: Comment };
}

/**
 * Client content for a server-declared slot. Direct-insert occurrences
 * call it with empty props; render-prop occurrences pass the occurrence's
 * resolved args (primitives literal, `{$ref}` data resolved through the
 * host, `{$frame}` regions as marker-range fragments). Return nodes to fill
 * the range, or `undefined` to claim `ctx.existing` untouched.
 * @experimental
 */
export type Slot = (props: Record<string, unknown>, ctx: SlotContext) => Node | Node[] | undefined;

/** @experimental */
export interface Frame {
  /** Merge a write into the store and flush (morph/reveal/slot sync). */
  apply(write: FrameWrite): void;
  /** The active version, or undefined before the first apply. */
  readonly version: number | undefined;
  /** Read-only view of the resident record store. */
  readonly store: Readonly<Record<string, unknown>>;
  /** The stream's error record, if an `error` chunk arrived. */
  readonly error: unknown;
  /** Whether the named fragment has been revealed into the boundary. */
  isRevealed(segment: string): boolean;
  /**
   * Re-key this live frame to a different boundary id (the mount-preserving
   * half of a call-site handoff): nothing tears down — the element, store,
   * and slot state stay — while leaving the old id stashes a retention
   * snapshot under it and joining the new id seeds/drains its retained
   * store and buffered chunks. Version affinity resets: histories are per
   * boundary id.
   */
  rebind(id: string): void;
  /**
   * Forget the version baseline without touching content — the next write
   * is accepted whatever its number. Called by the host after seeding a
   * registration from a retained snapshot, whose numbering belongs to a
   * different stream space.
   */
  rebase(): void;
  /**
   * The frame's have-list (RFC 11 §9.5): the server-minted digests of
   * what this frame currently SHOWS — the root skeleton under `""`, each
   * live hole and attr hole by ledger key, each revealed fragment by name.
   * Kept at apply time, never derived from the DOM. `undefined` when the
   * content's provenance carried no digests (a document-adopted interior
   * with no seed, a re-materialized capture): a resume then takes the full
   * snapshot.
   */
  have?(): Record<string, string> | undefined;
  /**
   * Push a staged response's slot args into the live occurrences they
   * address, ahead of the records' real apply (see `FrameHost.preview`).
   * @internal
   */
  preview?(
    records: Record<string, unknown>,
    resolve?: (ref: { $ref: string }, frameId?: string) => unknown
  ): void;
  /** Tear down: slot cleanups cascade, later chunks are ignored. Idempotent. */
  dispose(): void;
}

/**
 * Routes a flat stream of addressed chunks to frames by id, buffering chunks
 * for frames that have not registered yet (only the newest version's chunks
 * are kept). `data` chunks are response-scoped and go to `applyData`.
 *
 * An id may have several frames (the same server component mounted more
 * than once): chunks fan out to all of them, and a frame registering after
 * delivery is seeded from a sibling's store.
 * @experimental
 */
export interface FrameHost {
  register(id: string, frame: Frame): void;
  /** Remove one frame (or all frames of the id when `frame` is omitted). */
  unregister(id: string, frame?: Frame): void;
  apply(chunk: FrameChunk): void;
  /**
   * The reactive half of a staged response (see
   * `createServerComponentHandler`): a `slot` chunk's args reach the
   * occurrences mounted under its id — re-resolved props into their live
   * bindings — while the store, the markup, and every structural change
   * wait for the chunk's `apply`. `resolve` reads the staged response's
   * data. Other chunk types are ignored.
   * @internal
   */
  preview?(chunk: FrameChunk, resolve?: (ref: { $ref: string }, frameId?: string) => unknown): void;
  /** The first registered frame under the id, if any. */
  get(id: string): Frame | undefined;
  /**
   * The address as an async source: its first landing is the first flush of
   * the first response for it — the root content, the stream's error, or
   * its completion. A promise resolved at the write that lands it while
   * that response is in flight; `undefined` once the address has a landing
   * to show (a later response in flight then morphs over it — the
   * committed value holds), or when nothing has begun for the address. A
   * mount's covering `<Loading>` pends on this — and on nothing inside the
   * frame — exactly as it pends on any async source's first landing.
   */
  landing(id: string): Promise<void> | undefined;
  serialize(value: unknown): { $ref: string };
  /** `frameId` is the resolving frame's id — route to its stream's table. */
  resolve(ref: { $ref: string }, frameId?: string): unknown;
  /** See FrameHostOptions.revive. */
  revive?(value: unknown): unknown;
  /** See FrameHostOptions.isContainer. */
  isContainer?(value: unknown): boolean;
}

/**
 * Options for `createFrameHost`.
 * @experimental
 */
export interface FrameHostOptions {
  /**
   * Backs `{$ref}` slot args (typically a codec data table's `resolve`).
   * `frameId` identifies the resolving frame — data tables are
   * response-scoped, so multi-stream hosts route by it (nested region ids
   * prefix-match their root).
   */
  resolve?(ref: { $ref: string }, frameId?: string): unknown;
  /** Test/host-side counterpart of `resolve`. */
  serialize?(value: unknown): { $ref: string };
  /**
   * Receives each `data` chunk whole. Wire a codec table:
   * `applyData: c => table.apply(c)` (see `createJSONDataTable`).
   */
  applyData?(chunk: Extract<FrameChunk, { type: "data" }>): void;
  /**
   * A lazily-loaded deserializer's load, awaited by the transport before it
   * delivers a `data` chunk — `applyData`/`resolve` can assume the codec is
   * resident once data has arrived. Keeps codec weight out of the eager
   * client graph for responses that never carry serialized data.
   */
  prepareData?(): Promise<unknown>;
  /**
   * Revive protocol markers inside LITERAL slot args (values that are
   * neither `{$ref}` nor `{$frame}`) at arg-resolution time. Document-face
   * container traces ride this way — inline in the record, revived by the
   * integration (`reviveContainerTraces`) into live local containers.
   */
  revive?(value: unknown): unknown;
  /**
   * Whether a resolved arg value is a LIVE CONTAINER (a materialized trace —
   * see `isMaterializedContainer`). The record-dedupe compare must know: a
   * pending container's property reads throw not-ready, so async probes and
   * serialization compares would detonate it. Containers compare by
   * identity only.
   */
  isContainer?(value: unknown): boolean;
}

/**
 * Options for `createFrame` / `createFrameElement`.
 * @experimental
 */
export interface FrameOptions {
  /** Register with this host under `id`, receiving routed/buffered chunks. */
  host?: FrameHost;
  id?: string;
  /** Client content keyed by prop name (occurrences resolve by prop). */
  slots?: Record<string, Slot>;
  /**
   * Adopt existing server-rendered DOM: the first apply morphs against it,
   * and slots sync immediately (hydration attach) — a document-SSR boot
   * needs no chunk.
   */
  adopt?: boolean;
  /** Called after each apply flush (tests/telemetry). */
  onApply?(info: { version: number; reason: "materialize" | "morph" | "reveal" | "error" }): void;
  /**
   * Wraps element-claim sweeps (`a[href]`/`form[action]` in materialized
   * server content — and only those) so claim consumers register their
   * per-element cleanup against the boundary's reactive owner, e.g.
   * `fn => runWithOwner(owner, fn)`. Nested region frames inherit it.
   * Without it, sweeps run under whatever owner is current (none, for
   * streamed chunks).
   */
  ownerScope?<T>(fn: () => T): T;
  /**
   * Boundary-driven segment reveal. When present, `#revealSegment` hands the
   * placeholder seam to this hook instead of swapping imperatively: the binding
   * reconstructs a client `<Loading>` there — `fallback` is the placeholder's
   * own template content (shown while holding), `content()` materializes the
   * segment and renders its client fills INSIDE the boundary so their readiness
   * gates the reveal — and inserts it before `before`. An unboundaried async
   * fill suspends up to that boundary and is covered instead of orphaned; one
   * boundary per revealed segment, i.e. per author-placed `<Loading>`. Omit it
   * for the framework-agnostic imperative swap (no reactive reveal).
   */
  reveal?(seam: { before: Node; fallback: Node[]; content: () => Node | DocumentFragment }): void;
  /**
   * Document-face record delivery (adopt path only — solidjs/solid#2968).
   * Nothing on the wire formally orders an occurrence's args-record data
   * script before the event that triggers adoption, and a data script is a
   * plain assignment the frame cannot observe. A called occurrence
   * (`prop#n`) found without its record WAITS for it; while this returns
   * true the frame re-drains the document's records a macrotask later
   * (all currently parsed scripts run first — `drainRecords`) and re-syncs,
   * until the record lands. Return false once the document can deliver no
   * further records.
   */
  recordsPending?(): boolean;
  /** Re-absorb the document's arrived-by-now records (idempotent per key). */
  drainRecords?(): void;
  /**
   * Adopt path only. Called when a sync leaves an adopted occurrence
   * waiting — for its args record, for a `{$ref}`'s data — while none was
   * before; returns the release, called when a sync leaves none waiting or
   * the frame disposes. The integration registers the hold with whatever
   * counts its page as not yet settled (hydration-done counts it as a
   * pending boundary — frames-rulings 3.1): a claim the frame has not made
   * yet is page work still pending.
   */
  hold?(): () => void;
}
/**
 * Client frame runtime — the consumer side of the frame stream (port of the
 * frame-streams spike, adapted for Solid).
 *
 * A frame renders server-owned content into a DOM boundary from a resident
 * keyed record store. Chunks are *writes* into the store, not events to
 * replay, so application is prerequisite-driven and order-independent by
 * construction:
 *
 *   - root HTML apply into a boundary (element or comment-marker range)
 *   - version as a stale-guard only ("policy A": a newer version morphs in
 *     place; client slots/regions and their state survive — teardown is
 *     dispose(), never a version bump)
 *   - async fragment placeholder ranges + reveal readiness buffering
 *   - a zero-allocation server-owned morph that preserves protected
 *     slot ranges and fragment placeholders
 *   - the slot model: direct-insert and render-function slots as one callback
 *     primitive, iteration by occurrence id, re-call on args change, slot
 *     resolution threaded down through nested frames
 *
 * Adaptations from the spike:
 *   - Fragment placeholders use the document marker vocabulary emitted by
 *     renderToStream/renderToFrameStream: a `<template id="pl-KEY">` start
 *     marker (whose .content holds the fallback) closed by a `<!--pl-KEY-->`
 *     comment. Reveal mirrors $df: clear the range interior, insert content,
 *     remove both markers. Fallback reveal mirrors $dfl: materialize the
 *     template's content into the range without resolving.
 *   - `data` chunks are payload-only (Seroval output with ids embedded), so
 *     they apply through the host's data hook against a response-scoped
 *     record table instead of landing in a frame's store.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

// === Element claims for server content ===
//
// Compiled client output claims navigation-relevant elements per element at
// creation (client.js `claimElement`); frame content becomes live DOM from
// serialized HTML with no compiled creation code, so this module sweeps each
// subtree it materializes — and re-claims elements whose `href`/`action` the
// morph rewrites in place — against the SAME consumer registry, read through
// the registered symbol client.js mirrors it on (importless in both
// directions, like the FRAME brand below). Sweeps claim indiscriminately per
// the attribute contract; filtering belongs to the consumer. Dormant costs
// one property read per apply — the selectors never run without a consumer.
const CLAIM_SEAM = Symbol.for("solid.element-claims");
const CLAIMED_ELEMENTS = "a[href], form[action]";

/** The live consumer list (undefined when dormant — the one check sweeps pay). */
function claimHandlers() {
  const handlers = globalThis[CLAIM_SEAM];
  return handlers !== undefined && handlers.length !== 0 ? handlers : undefined;
}

/** Fire every handler on one element unconditionally. */
function claimNode(handlers, el) {
  for (let i = 0; i < handlers.length; i++) handlers[i](el);
}

const claimedAttr = name => name === "href" || name === "action";

/** Sweep `root` (element or fragment) and its claimable interior. */
function claimTree(handlers, root) {
  const isElement = root.nodeType === ELEMENT_NODE;
  if (!isElement && root.nodeType !== 11 /* DOCUMENT_FRAGMENT_NODE */) return;
  if (isElement && root.matches(CLAIMED_ELEMENTS)) claimNode(handlers, root);
  const found = root.querySelectorAll(CLAIMED_ELEMENTS);
  for (let i = 0; i < found.length; i++) claimNode(handlers, found[i]);
}

/** Fragment placeholder start: `<template id="pl-KEY">` (content = fallback). */
const placeholderId = name => `pl-${name}`;

const SLOT_START = /^slot:(.+):start$/;
const SLOT_END = /^slot:(.+):end$/;
const slotEnd = id => `slot:${id}:end`;

// === Binding slots (principles §9.2.3: a slot read at positions of server markup) ===
//
// A server element that reads a binding slot's properties carries one marker
// per bound position — `_s:<attribute>="<occurrence>:<key>"`, with the
// class name / style property appended for a name inside `class`/`style`
// (`_s:class="row#1:done=completed,row#1:busy=pending"`), `_s:on:<event>`
// for a handler, `_s:ref` for a ref. The OCCURRENCE is the slot call (one
// data context — `props.row({ id, completed })`), not the element: any
// number of elements consume it, and the sync mounts it once, handing the
// consumer every (element, position, key) it found. The fill runs once per
// occurrence with the occurrence's args (the same `slot:<occurrence>` record
// a markup slot's call emits) and writes each position from its returned
// object; a re-emitted record updates the args in place, as for markup
// occurrences. The elements stay server-owned: the morph keeps them (keyed
// or positional), and reads the markers off INCOMING markup to know which
// positions are the client's (see `morphAttributes`) — no ownership table.
//
// A TEXT position is a comment pair around the value,
// `<!--_s:t=<occurrence>:<key>-->…<!--/_s:t-->`, registered on its parent
// element beside that element's attribute positions (`{ pos: "text", key,
// start }`); the fill writes the one text node between the markers, and the
// morph keeps a pair it meets again (see `reconcileChildren`).
const SLOT_MARKER = "_s:";
const SLOT_TEXT = SLOT_MARKER + "t=";
const SLOT_TEXT_END = "/" + SLOT_MARKER + "t";

const isTextStart = n => n.nodeType === COMMENT_NODE && n.data.startsWith(SLOT_TEXT);

/**
 * One marker entry, `<occurrence>:<key>[=<name>]`, as `[occurrence,
 * { pos, key, name }]`, or null. Keys and names are percent-encoded on the
 * wire (they are client-controlled strings landing in a `,`/`:`/`=`-delimited
 * grammar) and decoded here.
 */
function slotEntry(entry, pos) {
  const colon = entry.indexOf(":");
  if (colon < 1) return null;
  const eq = entry.indexOf("=", colon);
  return [
    entry.slice(0, colon),
    {
      pos,
      key: decodeURIComponent(eq === -1 ? entry.slice(colon + 1) : entry.slice(colon + 1, eq)),
      name: eq === -1 ? undefined : decodeURIComponent(entry.slice(eq + 1))
    }
  ];
}

/**
 * Register a text start marker's position on its parent element's consumer
 * entry for the occurrence — the one its attribute markers opened, if any,
 * so an element is one consumer however its positions are spelled.
 */
function textPosition(start, elements) {
  const parsed = slotEntry(start.data.slice(SLOT_TEXT.length), "text");
  const consumers = parsed && consumersOf(elements, parsed[0]);
  if (!consumers) return;
  const element = start.parentNode;
  let consumer;
  for (let i = consumers.length; i-- && !consumer; )
    if (consumers[i].element === element) consumer = consumers[i];
  consumer || consumers.push((consumer = { element, positions: [] }));
  parsed[1].start = start;
  consumer.positions.push(parsed[1]);
}

/** An occurrence's consumer list, created on first use; null when a slot
 *  range claimed the id (the dev range check reports it). */
function consumersOf(elements, occurrence) {
  let consumers = elements.get(occurrence);
  if (consumers === undefined) elements.set(occurrence, (consumers = []));
  return Array.isArray(consumers) ? consumers : null;
}

/**
 * Parse one element's `_s:*` markers into positions grouped by occurrence:
 * `{ [occurrence]: [{ pos, key, name }] }`, or null. `pos` is the marker's
 * position as written (`class`, `hidden`, `on:click`, `ref`), `name` the
 * class name / style property for a member position.
 */
function slotPositions(el) {
  const attrs = el.attributes;
  let out = null;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (!attr.name.startsWith(SLOT_MARKER)) continue;
    const pos = attr.name.slice(SLOT_MARKER.length);
    for (const entry of attr.value.split(",")) {
      const parsed = slotEntry(entry, pos);
      if (!parsed) continue;
      out || (out = Object.create(null));
      (out[parsed[0]] || (out[parsed[0]] = [])).push(parsed[1]);
    }
  }
  return out;
}

/** Whether a data occurrence's consumer set changed (elements or positions). */
function consumersEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.element !== y.element || x.positions.length !== y.positions.length) return false;
    for (let j = 0; j < x.positions.length; j++) {
      const p = x.positions[j];
      const q = y.positions[j];
      if (p.pos !== q.pos || p.key !== q.key || p.name !== q.name || p.start !== q.start)
        return false;
    }
  }
  return true;
} /**
 * Maps a wire chunk onto resident-store record writes. `data` chunks map to
 * no records — they are response-scoped and the host applies them through
 * its data hook.
 * @experimental
 */
export function chunkToRecords(chunk: FrameChunk): Record<string, unknown>;

/**
 * Map a wire chunk onto resident-store record writes. `html` is the root,
 * `fragment` a keyed segment, `reveal` sets segment gates (fallback reveals
 * set fallback gates), and so on. Control chunks (`complete`/`error`) are
 * stored as flag keys rather than fired as events, consistent with the store
 * model. `data` chunks return no records — they are response-scoped, not
 * frame-scoped, and the host applies them through its data hook.
 */
export function chunkToRecords(chunk) {
  switch (chunk.type) {
    case "start":
    case "data":
      return {};
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
      const records = {};
      const gate = chunk.fallback ? "fallback" : "reveal";
      for (const key of chunk.keys) records[`seg:${key}:${gate}`] = true;
      return records;
    }
    case "assets":
      return { [`seg:${chunk.key}:assets`]: chunk };
    case "slot":
      // A named slot invocation: the client render function for `key` is
      // called with these (resolved) args. Data args are serializer refs;
      // server-content args are frame refs resolved to nested regions.
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
          holes: chunk.holes
        }
      };
    case "attr":
      // A live attr-hole re-emission: rebuilt attribute text for the
      // element addressed `data-lha="key"`, with explicit removals.
      // Response-scoped like hole records (addresses restart per render).
      return {
        [`attr:${chunk.key}`]: {
          kind: "attrs",
          value: chunk.attrs,
          removed: chunk.removed,
          digest: chunk.digest
        }
      };
    case "complete":
      return { ":complete": true };
    case "error":
      // Keyed errors scope to what the key names: a hole key (`lh:N`) is a
      // failed live-hole sweep — terminal for the hole, whose range latched
      // at its last markup (response-scoped like the hole records, so these
      // clear on version bumps). Other keys are segment-scoped (an errored
      // fragment). Unkeyed errors are stream-level — `frame.error` reads
      // that record.
      if (!chunk.key) return { ":error": chunk.error };
      return {
        [`${/^lha?:/.test(chunk.key) ? "hole" : "seg"}:${chunk.key}:error`]: chunk.error
      };
    default:
      return {};
  }
} /** @experimental */
export function createFrameHost(options?: FrameHostOptions): FrameHost;

/**
 * Routes a flat stream of addressed chunks to the right frame in a (possibly
 * nested) frame tree. A chunk addressed to a frame that has not registered
 * yet is buffered and delivered when that frame registers — server stream
 * order and client mount order are independent, exactly like the
 * resident-store readiness model one level up.
 *
 * @param {{
 *   serialize?: (value: unknown) => { $ref: string },
 *   resolve?: (ref: { $ref: string }) => unknown,
 *   applyData?: (chunk: object) => void,
 *   prepareData?: () => Promise<unknown>,
 *   revive?: (value: unknown) => unknown,
 *   isContainer?: (value: unknown) => boolean
 * }} [options]
 *   `serialize`/`resolve` back slot data refs (response-scoped table);
 *   `applyData` receives each `data` chunk whole — keyed codec records
 *   ({ key, node, initial }, apply via createJSONDataTable) or eval-style
 *   `payload` scripts, depending on the producer's serializer. A host whose
 *   deserializer loads lazily exposes the load as `prepareData`: the
 *   transport awaits it before delivering a `data` chunk, so `applyData`
 *   and `resolve` can assume the codec is resident once data has arrived.
 */
export function createFrameHost(options = {}) {
  // One logical stream may feed several mounted boundaries (the same server
  // component mounted twice): ids map to SETS of frames and every chunk fans
  // out to all of them.
  const frames = new Map();
  // Resident stores, keyed by id — in the transport's usage an ADDRESS, the
  // client-derived (function, args) name (A3: addresses key content, not
  // mounts). The store is the single accumulation point for every non-data
  // chunk: writes land whether or not anything is mounted (a preload warms
  // the store; arrival never touches DOM), and a registering frame seeds
  // from it wholesale. This one shape subsumes three older mechanisms — the
  // unregistered-chunk buffer, per-boundary retention snapshots, and
  // sibling-store seeding — because a resident store IS all three: it
  // buffers (records persist until a mount reads them), it retains (unmount
  // leaves the store warm for the next mount to re-materialize from, so a
  // fresh cache hit with no new stream still shows content), and it is the
  // one copy any number of sibling mounts share. Stores live for the
  // session; eviction policy (data-layer coupling + LRU floor, principles
  // §5.1) hangs off the purge form of `unregister`.
  //
  // A store is one response's (frames-rulings 1.4, full form; 2.1): its
  // `records` are the latest version's and every record of the previous
  // version leaves at the bump — content, segments, slot records, the error
  // — so nothing a superseded response delivered can land in the frame
  // that shows the current one (what preserves client state across versions
  // is the MOUNT's applied state, FrameImpl's `#slotArgs` value compare, not
  // a merge of two responses in one store). The address is an async SOURCE
  // over it (`landing` below): a response announces itself with `start`
  // and is in flight (`open`) until its first flush lands — the root, the
  // stream's error, or its completion; `shown` is the record set of the
  // latest version that landed — the source's committed value, what a mount
  // opened mid-flight seeds from (holds-latest) — and the same object as
  // `records` once the version in flight has landed.
  const stores = new Map();
  const storeFor = id => {
    let store = stores.get(id);
    if (!store) stores.set(id, (store = { version: undefined, records: {} }));
    return store;
  };
  // Landings awaited per address (see `landing`): the promise handed out
  // while the address's first response is in flight, with its resolver.
  const landings = new Map();
  const lands = records => "" in records || ":error" in records || ":complete" in records;
  // Mirrors FrameImpl.apply's version policy (policy A): stale writes drop,
  // a newer version replaces the records wholesale, the same version
  // accumulates.
  const write = (store, version, records) => {
    if (store.version !== undefined && version < store.version) return false;
    if (store.version === undefined || version > store.version) {
      store.version = version;
      store.records = {};
    }
    // Root assets reuse one key for the shell and late chunks. Accumulate
    // their arrays so frames registered later receive the full snapshot.
    const assets = records["seg::assets"];
    const previous = assets && store.records["seg::assets"];
    if (!previous || previous === assets) {
      Object.assign(store.records, records);
    } else {
      for (const name in assets) {
        const values = assets[name];
        if (Array.isArray(values)) {
          previous[name] ? previous[name].push(...values) : (previous[name] = values);
        }
      }
    }
    return true;
  };
  return {
    register(id, frame) {
      let set = frames.get(id);
      if (!set) frames.set(id, (set = new Set()));
      set.add(frame);
      const store = stores.get(id);
      if (store && store.version !== undefined) {
        // ONE apply for the whole seed: per-record applies flush (and sync
        // slots) between records, so the first record would mount every
        // discovered occurrence — the rest record-less — and each later
        // record would look like an args CHANGE, re-calling with incomplete
        // args and wiping adopted interiors (the #547 boot face). A mount
        // opened while a response is in flight seeds the source's committed
        // value (`shown`, an older version: the in-flight version's writes
        // then bump it, as they bump every mount of the address) — a cold
        // address seeds nothing and the mount pends on its landing.
        if (!store.open) frame.apply({ version: store.version, r: store.records });
        else if (store.shown) frame.apply({ version: store.shownVersion, r: store.shown });
      }
    },
    /**
     * Remove a frame (or, with no frame argument, every frame) under an id.
     * The store stays resident — an unmounted boundary's content is exactly
     * what a later mount of the same address re-materializes from. The
     * no-frame form is a purge and drops the store too (the eviction seam).
     */
    unregister(id, frame) {
      const set = frames.get(id);
      if (set && frame) set.delete(frame);
      if (!set || !frame || !set.size) {
        frames.delete(id);
        // A document-adopted boundary's content never rode chunks (it was
        // page markup), so its store has no root record to re-materialize a
        // later mount from. Capture the interior at last-unmount — a single
        // copy, taken only when the store lacks a root. Runs pre-teardown:
        // dispose unregisters before it touches the DOM.
        if (frame && frame.contentHTML) {
          const store = storeFor(id);
          if (!store.records[""]) {
            const html = frame.contentHTML();
            if (html != null) {
              store.records[""] = { kind: "html", value: html };
              if (store.version === undefined) store.version = 0;
              // The capture is the document's landing (version 0): what a
              // later mount shows, a refetch's flight notwithstanding.
              store.shown = store.records;
              store.shownVersion = store.version;
            }
          }
        }
      }
      if (!frame) {
        stores.delete(id);
        landings.delete(id);
      }
    },
    apply(chunk) {
      // Data payloads are response-scoped; apply immediately, no store needed.
      if (chunk.type === "data") {
        options.applyData && options.applyData(chunk);
        return;
      }
      // Write through to the resident store first: the store version-guards
      // once for all mounts, and an unmounted address simply warms.
      const records = chunkToRecords(chunk);
      const store = storeFor(chunk.id);
      if (!write(store, chunk.version, records)) return;
      let r = records;
      // The address as a source: `start` opens a flight; the write that
      // lands it makes the version the one SHOWN and answers whoever awaited
      // the landing — before the frames apply, so a mount gating on it reads
      // the content in the beat its frame shows it. The landing fans out as
      // the version's WHOLE record set: a mount opened mid-flight seeded the
      // committed value and has none of this version's earlier writes (a
      // frame already at the version re-receives the same records — a
      // no-op). A document-adopted store never opens: its content is page
      // markup, written by no `start`.
      if (chunk.type === "start") store.open = true;
      else if (lands(records)) {
        store.open = false;
        store.shown = r = store.records;
        store.shownVersion = chunk.version;
        const wait = landings.get(chunk.id);
        if (wait) {
          landings.delete(chunk.id);
          wait.r();
        }
      }
      const set = frames.get(chunk.id);
      if (set) {
        for (const frame of set) frame.apply({ version: chunk.version, r });
      }
    },
    landing(id) {
      const store = stores.get(id);
      // Nothing to wait for: no response in flight, or the address has a
      // landing to show already — the committed value a mount reads
      // (holds-latest) while a later response is in flight.
      if (!store || !store.open || store.shown) return undefined;
      let wait = landings.get(id);
      if (!wait) {
        landings.set(id, (wait = {}));
        wait.p = new Promise(r => (wait.r = r));
      }
      return wait.p;
    },
    preview(chunk, resolve) {
      if (chunk.type !== "slot") return;
      const set = frames.get(chunk.id);
      if (!set) return;
      const records = chunkToRecords(chunk);
      for (const frame of set) frame.preview && frame.preview(records, resolve);
    },
    get(id) {
      const set = frames.get(id);
      return set && set.values().next().value;
    },
    serialize(value) {
      if (!options.serialize) throw new Error("host has no serializer");
      return options.serialize(value);
    },
    resolve(ref, frameId) {
      return options.resolve ? options.resolve(ref, frameId) : undefined;
    },
    revive: options.revive,
    isContainer: options.isContainer,
    prepareData: options.prepareData
  };
}

/**
 * The bubbling DOM event a frame dispatches from its parent element after
 * server content lands in the document (root materialize/morph, segment
 * reveal, fallback materialization) — `detail: { id, version, reason }`.
 * Document-level listeners (router affordance reflection, scroll
 * restoration) react to server-driven DOM changes without a
 * MutationObserver; nested region frames dispatch too and the event
 * bubbles, so one listener sees every boundary. Client-side renders never
 * fire it — client code has reactivity to subscribe with.
 */
export const FRAME_APPLIED_EVENT = "frame:applied";

class FrameImpl {
  // A frame renders either into an element (element boundary: #start/#end
  // null) or between two comment markers within some parent (range boundary).
  // The parent of a range boundary is derived live from the start marker, so
  // the range can be moved (e.g. re-placed by a client re-call) without
  // rebinding.
  #element;
  #start;
  #end;
  #options;
  #version;
  #store = Object.create(null);
  #appliedRootValue;
  #hasContent = false;
  #errorNotified = false;
  #revealed = new Set();
  #fallbackShown = new Set();
  // Live-hole apply dedupe: store key -> the record this MOUNT applied
  // (range morphs, attr patches, and error diagnostics share it). Per
  // mount, not per store — a fresh mount seeding from a warm resident
  // store must replay hole records over the re-materialized shell.
  #appliedHoles = new Map();
  // The have-list (RFC 11 §9.5): what this mount currently shows, by the
  // server's own digests. Reset by a root apply (the root IS the content;
  // its `holes` seed the entries inside), extended by each reveal, kept
  // current by each hole/attr apply. Applied-state, so it tracks the DOM
  // without reading it — a fragment received but not yet revealed is not
  // in it, and a resume whose connection dies in between still asks for
  // the reveal. `undefined` until a digest-carrying root applies.
  #have;
  #slots;
  #mountedSlots = new Set();
  #slotCleanups = new Map();
  #slotArgs = new Map();
  #slotUpdaters = new Map();
  #slotRegions = new Map();
  #slotResolvedRefs = new Map();
  #slotNodes = new Map();
  // Data occurrences (§9.2.3): the consumer set last handed to the mount,
  // and the mount's rebind callback (`ctx.onRebind`) for when it changes.
  #slotConsumers = new Map();
  #slotRebinders = new Map();
  #processedAssets = new WeakSet();
  // The pending re-check for adopt-time occurrences deferred on a
  // still-arriving args record (#2968 — see #syncSlots).
  #recordRefresh = null;
  // The release of the frame's hold with the integration while a sync
  // leaves an occurrence waiting to mount (see #syncSlots' end).
  #hold;
  #disposed = false;
  // Stable identity so a pending stylesheet holds at most one waiter per
  // frame across repeated readiness checks.
  #styleFlush = () => {
    if (!this.#disposed) this.#flush();
  };

  // Element-claim sweep for one materialized/morph-touched subtree, run
  // under `ownerScope` when the creator provided one — claim consumers
  // register per-element cleanup against the reactive owner current at claim
  // time, and the boundary's owner is what bounds this frame's content.
  // `direct` claims one element unconditionally — the morph's attribute
  // recheck, which must fire on `href`/`action` REMOVAL too (the element no
  // longer matches the sweep selector), mirroring compiled setAttribute.
  // Stable identity so it threads into the morph without allocation.
  #claimTree = (node, direct) => {
    const handlers = claimHandlers();
    if (!handlers) return;
    this.#scoped(() => (direct ? claimNode(handlers, node) : claimTree(handlers, node)));
  };

  /** Run `fn` under the creator's `ownerScope` (when provided). */
  #scoped(fn) {
    const scope = this.#options.ownerScope;
    return scope ? scope(fn) : fn();
  }

  constructor(element, start, end, options = {}) {
    this.#element = element;
    this.#start = start;
    this.#end = end;
    this.#options = options;
    this.#slots = options.slots;
    // Adopt: the boundary already holds server-rendered content, so the first
    // root apply morphs against it rather than materializing from scratch.
    // That content never ran compiled creation code, so sweep its claimable
    // elements now — before registration can flush a buffered morph over it
    // (in-place `href`/`action` rewrites re-claim on their own).
    if (options.adopt) {
      this.#hasContent = true;
      this.#claimContent();
    }
    // Register last, after all fields are initialized: registration may flush
    // buffered chunks straight into `apply`.
    if (options.host && options.id !== undefined) {
      options.host.register(options.id, this);
    }
    // Hydration attach: an adopted document-SSR boot may never receive a
    // chunk, so sync slots against the existing DOM immediately — callbacks
    // claim (`ctx.existing`, return undefined) or replace the server-rendered
    // client content in each range. A registration flush already ran this
    // sync (every apply ends in #flush -> #syncSlots, and it sets #version),
    // so only sync here when no buffered chunk arrived — the repeat walk over
    // a large adopted tree is pure redundancy.
    if (options.adopt && this.#version === undefined) this.#syncSlots();
  }

  /** The node content lives in (element itself, or the range markers' parent). */
  #parent() {
    return this.#element ?? this.#start.parentNode;
  }

  /** Server content landed: caller hook + the bubbling document notification. */
  #applied(version, reason) {
    this.#options.onApply?.({ version, reason });
    const parent = this.#parent();
    // Construct from the element's own realm — a cross-realm CustomEvent
    // (e.g. Node's global against a JSDOM document) is rejected by dispatch.
    const Ev = parent && (parent.ownerDocument || parent).defaultView?.CustomEvent;
    if (Ev) {
      parent.dispatchEvent(
        new Ev(FRAME_APPLIED_EVENT, {
          bubbles: true,
          detail: { id: this.#options.id, version, reason }
        })
      );
    }
  }

  /** First content node (or `#end`/null when empty). */
  #firstContent() {
    return this.#start ? this.#start.nextSibling : this.#parent().firstChild;
  }

  get version() {
    return this.#version;
  }

  get store() {
    return this.#store;
  }

  isRevealed(segment) {
    return this.#revealed.has(segment);
  }

  /** The stream's error record, if an `error` chunk arrived (else undefined). */
  get error() {
    return this.#store[":error"];
  }

  apply(write) {
    if (this.#disposed) return;
    const v = write.version;
    if (this.#version === undefined) {
      this.#version = v;
    } else if (v < this.#version) {
      // Stale write for an older invocation: no live store to land in.
      return;
    } else if (v > this.#version) {
      // Policy A: version only guards against stale (older) writes. A newer
      // version is an in-place update of the DOM, not a teardown: the
      // element stays, mounted slots and regions keep their client state
      // (e.g. across a client-side navigation), and the reconciler morphs
      // the new content over the old. Stale discard is the `v < version`
      // branch; a genuine teardown is `dispose()`.
      //
      // The STORE, though, is one response's (frames-rulings 1.4, full
      // form; 2.1): what this frame applied under the previous version —
      // the root it morphed, the segments it revealed, the slot records it
      // mounted — is that landing's, and the new version replaces it
      // wholesale. Fragment names and hole ids restart per stream, so a new
      // version's placeholder is never skipped for an old reveal of the
      // same name; a root byte-identical to the old one still applies as
      // the new version's (its placeholders are the new segments'); and a
      // slot record the old version held unapplied leaves with it. What
      // preserves occurrence state is the mount's own applied state
      // (`#slotArgs` — the sync's value compare adopts an equal re-sent
      // record without a re-call), never a merge of two responses.
      this.#version = v;
      this.#resetStreamState();
    }

    for (const key in write.r) this.#store[key] = write.r[key];
    this.#flush();
  }

  /**
   * The reactive half of a staged response (see FrameHost.preview): each
   * slot record whose occurrence is mounted here with a live binding pushes
   * its re-resolved args into it, and is recorded as the occurrence's
   * applied record so the real apply's slot sync finds it adopted. Called
   * from a mount's compute half — the pass of the transaction that
   * delivered the content — so the args are held with that transaction and
   * commit in the frame whose landing dissolves its optimistic guesses,
   * never a flush behind it. Nothing else moves: the store, the markup,
   * mounts, re-calls and unmounts all wait for the apply. Args that add or
   * rename a region are structural too — those occurrences wait. Records
   * reach the regions below that inherit them (their own store does not
   * shadow the key).
   *
   * An adopted record is also written to the store that owns it — this
   * frame's, for regions below too — so a flush before the apply (the
   * apply's own first chunks, which precede the slot records) finds the
   * occurrence's record adopted instead of pushing the old args back; the
   * apply's record dedupe then keeps it. A record nothing adopted stays out
   * of the store: an early flush would apply it against the old markup.
   */
  preview(records, resolve?, inherited?) {
    const adopted = new Set<string>();
    if (this.#disposed) return adopted;
    for (const key in records) {
      const record = records[key];
      if (!record || record.kind !== "slot" || !key.startsWith("slot:")) continue;
      if (inherited && key in this.#store) continue;
      const occurrence = key.slice(5);
      const update = this.#mountedSlots.has(occurrence) && this.#slotUpdaters.get(occurrence);
      if (!update || this.#refsUnresolved(record.args, resolve)) continue;
      if (this.#regionsChange(occurrence, record.args)) continue;
      const same = this.#refArgsUnchanged(occurrence, record, resolve);
      const props = same || this.#resolveArgs(occurrence, record.args, resolve);
      this.#slotArgs.set(occurrence, record);
      adopted.add(key);
      if (!same) update(props);
    }
    for (const regions of this.#slotRegions.values())
      for (const entry of regions.values())
        if (entry.frame)
          for (const key of entry.frame.preview(records, resolve, true)) adopted.add(key);
    if (!inherited) for (const key of adopted) this.#store[key] = records[key];
    return adopted;
  }

  /** Whether `args` add a region to the occurrence or rename one of its
   *  regions (its chunks ride the new name, so the rename lands with them). */
  #regionsChange(occurrence, args) {
    const regions = this.#slotRegions.get(occurrence);
    for (const key in args) {
      const entry = regions && regions.get(key);
      if (isFrameRef(args[key]) && !(entry && entry.childId === args[key].$frame)) return true;
    }
    return false;
  }

  /**
   * The applied state is one version's (frames-rulings 2.1): the version
   * bump and the rebind replace it wholesale — the store (every record of
   * the previous response), the root the morph applied (so a byte-identical
   * root under the new version applies as the new version's — 2.2), the
   * reveal and fallback sets, the hole dedupe, the assets, the
   * once-per-stream error notification. Nothing applied under the previous
   * version is consulted under the next; the DOM keeps showing what it
   * showed until the new version's writes morph it.
   */
  #resetStreamState() {
    this.#store = Object.create(null);
    this.#appliedRootValue = undefined;
    this.#revealed.clear();
    this.#fallbackShown.clear();
    this.#appliedHoles.clear();
    this.#processedAssets = new WeakSet();
    this.#errorNotified = false;
  }

  #flush() {
    if (this.#disposed) return;
    const version = this.#version;

    const root = this.#store[""];
    if (root && root.kind === "html" && root.value !== this.#appliedRootValue) {
      const reason = this.#hasContent ? "morph" : "materialize";
      this.#applyRoot(root.value);
      this.#appliedRootValue = root.value;
      // The root resets the ledger: everything shown is now this root.
      this.#have = root.digest === undefined ? undefined : { "": root.digest, ...root.holes };
      this.#applied(version, reason);
    }

    // An error record is an APPLY too: a consumer gating on first apply (a
    // mount holding its covering boundary open until the frame has content)
    // must release on a failed stream — surfacing the error state beats
    // holding a fallback forever. Notified once per stream: later flushes
    // (data, complete) don't re-fire, and a new version re-arms (its reset
    // clears the record).
    if (this.#store[":error"] && !this.#errorNotified) {
      this.#errorNotified = true;
      this.#applied(version, "error");
    }

    // Re-evaluate every segment on each flush. Because readiness is checked
    // against the store + DOM (not arrival order), reveal/content/placeholder
    // may arrive in any order. Passes repeat until one makes no progress:
    // revealing a segment (or materializing a fallback) can insert another
    // segment's placeholder into the DOM — the store-model analogue of the
    // document runtime's $dfd retry drain. Terminates because every step
    // moves a name into #revealed/#fallbackShown, bounded by the store.
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const key in this.#store) {
        const name = segmentName(key);
        if (name === null || this.#revealed.has(name)) continue;
        if (this.#segmentReady(name)) {
          this.#revealSegment(name);
          this.#applied(version, "reveal");
          progressed = true;
        }
      }
      // Fallback gates materialize placeholder-template content into the
      // range ($dfl semantics) while the segment itself stays pending.
      for (const key in this.#store) {
        const m = /^seg:([^:]+):fallback$/.exec(key);
        if (!m) continue;
        const name = m[1];
        if (this.#revealed.has(name) || this.#fallbackShown.has(name)) continue;
        if (this.#showFallback(name)) {
          this.#fallbackShown.add(name);
          this.#applied(version, "reveal");
          progressed = true;
        }
      }
    }

    // Live-hole records, one pass: range morphs (`hole:`), element attr
    // patches (`attr:`), and hole-keyed error diagnostics. After the
    // segment loop, so a hole inside a segment revealed THIS flush is
    // findable now; a record whose target isn't in the DOM yet simply
    // stays pending — any later flush retries, store-model style. Dedupe
    // is by record identity (every chunk mints a fresh record; a fresh
    // mount's empty map replays the warm store). A hole error is terminal
    // server-side — the range latched at its last markup, and unlike a
    // rejected arg ref there is no client read to throw into, so it
    // surfaces as a one-time diagnostic.
    for (const key in this.#store) {
      const record = this.#store[key];
      if (!record || this.#appliedHoles.get(key) === record) continue;
      if (key.startsWith("hole:")) {
        if (key.endsWith(":error")) {
          this.#appliedHoles.set(key, record);
          if ("_SOLID_DEV_")
            console.error(`Live hole ${key.slice(5, -6)} failed on the server; latched:`, record);
        } else if (this.#applyHole(key.slice(5), record.value)) {
          this.#appliedHoles.set(key, record);
          this.#recordHave(key.slice(5), record);
          this.#applied(version, "morph");
        }
      } else if (key.startsWith("attr:")) {
        if (this.#applyAttrs(key.slice(5), record.value, record.removed)) {
          this.#appliedHoles.set(key, record);
          this.#recordHave("lha:" + key.slice(5), record);
          this.#applied(version, "morph");
        }
      }
    }

    // Root asset records reuse a store key, so consume them by identity.
    // Styles remain owned by the reveal gate.
    for (const key in this.#store) {
      const record = this.#store[key];
      if (!key.endsWith(":assets") || !record || this.#processedAssets.has(record)) {
        continue;
      }
      this.#processedAssets.add(record);
      if (record.modules) {
        for (const href of record.modules) ensureModulePreload(href);
      }
      if (record.preloads) {
        for (const entry of record.preloads) ensurePreload(entry);
      }
    }

    this.#syncSlots();
  }

  /** Resolve a slot callback by prop: this frame's slots, then ancestors'. */
  #resolveSlot(prop) {
    return this.#slots?.[prop] ?? this.#options.resolveSlot?.(prop);
  }

  /**
   * Resolve a slot occurrence's args record: this frame's store, then
   * ancestors'. Occurrence markers evaluated inside nested server-content
   * regions carry their records on the frame whose props proxy emitted them
   * — the parent — while the marker lands in the child's content, so lookup
   * threads up the frame tree exactly like callback resolution.
   */
  #resolveSlotRecord(occurrence) {
    const record = this.#store[`slot:${occurrence}`];
    if (record !== undefined) return record;
    return this.#options.resolveSlotRecord?.(occurrence);
  }

  /**
   * Delete an occurrence's args record from the store that OWNS it. A nested
   * occurrence's record lives on the frame whose props proxy emitted it — an
   * ancestor keyed by the root stream — not on the region frame that mounts
   * it, so removal threads up exactly like `#resolveSlotRecord`. This is
   * store hygiene: tearing down a region (a comment navigated away from)
   * must not strand its nested occurrences' records in the root store
   * forever. One guard: occurrence NAMES are unique within a stream but
   * recycled across streams (per-prop counters restart), so a new sync can
   * mount its own `comment#0` before the sweep tears down an old region that
   * also held a `comment#0`. If the owning frame currently has the
   * occurrence mounted, the record under that name belongs to the LIVE
   * occurrence — skip the delete (the old occurrence's record was already
   * overwritten by the newer stream's).
   */
  #removeSlotRecord(occurrence) {
    const key = `slot:${occurrence}`;
    if (key in this.#store) {
      if (!this.#mountedSlots.has(occurrence)) delete this.#store[key];
    } else this.#options.removeSlotRecord?.(occurrence);
  }

  // `root`, when given, scopes discovery to a detached fragment instead of the
  // frame's live content: a boundary-driven reveal renders a segment's fills
  // INSIDE the reconstructed `<Loading>` (so their readiness gates the reveal),
  // then the filled fragment is committed. Those occurrences mount here and are
  // skipped by the next full sync; the unmount sweep is full-frame-only (a
  // scoped fill only ADDS occurrences, never removes the frame's others).
  #syncSlots(root) {
    if (!this.#slots && !this.#options.resolveSlot) return;

    // Range-driven discovery: find every server-owned slot occurrence in this
    // frame's content. An occurrence id is the marker key (e.g. "children" or
    // "comment#0"); the callback is looked up by its prop — the part before
    // "#" — so one callback services N occurrences from an iterated render
    // prop.
    // Data occurrences (`_s:*` markers, principles §9.2.3) land in the same
    // map, keyed the same way, with their CONSUMERS as the occurrence's
    // node: an array of `{ element, positions }` in document order. The
    // loop below treats them as occurrences whose mount binds those
    // positions rather than filling a range (no interior, no regions, never
    // replaced), and whose consumer set may change without a re-call.
    const found = new Map();
    if (root) collectSlots(root.firstChild, null, found, found);
    else this.#collectSlots(found, found);
    // Whether this sync leaves an occurrence WAITING to mount — for its
    // record, for a `{$ref}`'s data: a claim the frame owes the page and has
    // not made yet (see the hold at the end).
    let waiting = false;

    for (const [occurrence, start] of found) {
      const callback = this.#resolveSlot(propOf(occurrence));
      const consumers = Array.isArray(start) ? start : null;
      if (!callback) {
        // No client impl for this prop up the tree. A range stays empty,
        // which content can mean; bound positions never bind, which
        // nothing can mean — the elements sit inert with no error. Dev
        // names them (once per occurrence).
        if ("_SOLID_DEV_" && consumers) devSlotOrphan(this, occurrence, consumers, "fill");
        continue;
      }
      const record = this.#resolveSlotRecord(occurrence);
      // A record whose data refs have not ARRIVED yet is not applicable: the
      // producer emits the slot chunk before the `data` chunks carrying its
      // ref'd values (an async arg's promise is created by its data chunk),
      // and `#resolveArgs` cannot tell "not here yet" from a real value — it
      // resolves the miss to `undefined` and hands that to the consumer as
      // the arg. On a live occurrence that lands immediately: the update
      // pushes `undefined` into the mounted fill (blanking it), commits the
      // record, and no later flush re-resolves it — `data` chunks don't
      // re-sync and the committed record no longer differs. So wait: the
      // stream's own html/complete chunk flushes again a moment later, by
      // which time the table has the value and the SAME record applies with
      // real args (an async one then suspends and holds, as the value tier
      // intends). A fresh mount is skipped for the same reason — mounting
      // with a fabricated `undefined` is what makes it visible.
      if (record && record.kind === "slot" && this.#refsUnresolved(record.args)) {
        waiting ||= !this.#mountedSlots.has(occurrence);
        continue;
      }
      // A mount whose output the morph destroyed (its range was recreated
      // inside a different server parent — ranges only relocate among
      // siblings) is a zombie: remount fresh so content stays correct, even
      // though state can't survive a destroyed node.
      const prev = this.#slotNodes.get(occurrence);
      const prevFirst = Array.isArray(prev) ? prev[0] : prev;
      // A data occurrence is never a zombie: its nodes are the server's
      // consumers, not the fill's output — a replaced element is a consumer
      // change (rebind, below), and an occurrence no element reads any more
      // is simply not found (unmounted at the end).
      const zombie =
        !consumers && this.#mountedSlots.has(occurrence) && prevFirst && !prevFirst.parentNode;
      if (zombie) {
        this.#mountedSlots.delete(occurrence);
        this.#runSlotCleanups(occurrence);
      }
      // The occurrence's name decides its class: the producer mints every
      // CALLED occurrence as `prop#n` and emits its record at the call,
      // ahead of the markup that reads it; a bare occurrence (the prop
      // itself) is a direct-insert position and has no record by design.
      // So a called occurrence found recordless is one whose record has not
      // been DELIVERED yet — the version in flight has not sent it (the
      // store is one response's: the previous version's record left at
      // the bump), or the document's data script for it has not run
      // (#2968) — never a direct-insert position to classify. It waits: a
      // fresh mount is not invoked (invoking it argless evaluates a render
      // prop as a zero-arg accessor — a props read that halts the reactive
      // system, contract C18), a mounted one keeps its applied args; the
      // write that delivers the record re-syncs. Waiting is invisible on
      // screen — an adopted occurrence's server-rendered interior is already
      // in the DOM, and a mounted one shows what it showed.
      //
      // The document face has no write to wait for (a data script is a
      // plain assignment into `_$HY.r`), so while the document may still
      // deliver records (`recordsPending` — the parser running, a fragment
      // held, a record delivered and undrained) the frame re-drains them a
      // macrotask later (all currently parsed scripts run first) and
      // re-syncs — repeatedly, not after a fixed single beat: a streamed
      // document held open on async content keeps records arriving across
      // many macrotasks (PR #559). A called occurrence still recordless once
      // nothing can deliver its record is the protocol's invariant broken
      // (a record dropped, or marker and record minted under different
      // ids), never something the fill can fix; dev names it.
      if (record === undefined && isCalled(occurrence)) {
        waiting ||= !this.#mountedSlots.has(occurrence);
        if (this.#options.adopt && this.#options.recordsPending?.()) {
          this.#recordRefresh ??= setTimeout(() => {
            this.#recordRefresh = null;
            if (this.#disposed) return;
            this.#options.drainRecords?.();
            this.#syncSlots();
          });
        } else if ("_SOLID_DEV_" && consumers && !this.#mountedSlots.has(occurrence))
          devSlotOrphan(this, occurrence, consumers, "record");
        continue;
      }
      if (!this.#mountedSlots.has(occurrence)) {
        // Direct-insert occurrences have no `slot:<id>` record and mount with
        // empty props; render-function occurrences mount with resolved props.
        // Mounting replaces the range interior: on a fresh stream it is
        // empty, but an adopted document-SSR range already holds the
        // server-rendered client content — a callback that returns nodes
        // replaces it (client render), one that returns undefined claims it
        // in place (hydration attach; the DOM is untouched).
        // In an adopt frame, a MOUNT is the hydration attach — whether the
        // constructor sync or a registration-flush drain (t=0 records
        // buffered before adoption) triggered it. ctx.adopted lets
        // consumers claim server-rendered DOM exactly then; stream re-calls
        // (the mounted branch below) must render for real or replaced
        // content is silently dropped (#547). Occurrences a post-boot
        // stream introduces mount with EMPTY interiors (the producer ships
        // bare marker pairs), so consumers' existing-content gate already
        // excludes them from claiming.
        // Discover the interior's region elements BEFORE invoking, on the
        // adopt path — claim wiring, not identity recovery (A5): the t=0
        // record names every region arg by `{$frame}` address; discovery's
        // job is locating the already-rendered ELEMENTS those addresses
        // resolve to, so #resolveArgs hands the wrapper the adopted node
        // instead of minting an empty one. A fresh mount has no interior
        // regions yet; discovery is a no-op then, and #resolveArgs creates
        // its entries during the invoke instead.
        if (this.#options.adopt) this.#discoverRegions(occurrence, start);
        const nodes = this.#invokeSlot(occurrence, callback, record, start, this.#options.adopt);
        // A data occurrence's nodes are its consuming elements (so the
        // zombie check above sees a morph that replaced them all); its mount
        // never returns nodes to place.
        if (consumers) {
          this.#slotNodes.set(
            occurrence,
            consumers.map(c => c.element)
          );
          this.#slotConsumers.set(occurrence, consumers);
        } else {
          if (nodes) this.#replaceRange(occurrence, start, nodes);
          this.#slotNodes.set(occurrence, nodes);
        }
        this.#mountedSlots.add(occurrence);
        // Re-scan after invoke: a fresh mount's regions come from
        // #resolveArgs during the invoke, and the callback's output may have
        // introduced more. A claim on the adopt path (nodes === null) left
        // the interior untouched, so the pre-invoke discovery already saw
        // everything — skip the repeat walk (it is per-occurrence over a
        // large adopted tree).
        if (!this.#options.adopt || nodes) this.#discoverRegions(occurrence, start);
        this.#bindRegions(occurrence);
        continue;
      }
      // A mounted data occurrence whose CONSUMERS changed — a morph replaced
      // one of its elements, a response added or dropped a bound position
      // — rebinds in place: the fill's computation stays, the binding gets
      // the new set. Independent of an args change, which follows below.
      if (consumers && !consumersEqual(this.#slotConsumers.get(occurrence), consumers)) {
        this.#slotConsumers.set(occurrence, consumers);
        this.#slotNodes.set(
          occurrence,
          consumers.map(c => c.element)
        );
        const rebind = this.#slotRebinders.get(occurrence);
        if (rebind) rebind(consumers);
      }
      if (record !== this.#slotArgs.get(occurrence)) {
        // A re-sent record differing only in {$ref} identity may carry the
        // SAME values (tables rotate per response, so the store-write
        // dedupe stays conservative). Value-compare the new refs against
        // the cached resolutions: all equal -> adopt the record without
        // re-calling, occurrence state intact. Region wire names still
        // follow the record (rebind, not re-call) so this stream's region
        // chunks reach the live frames.
        if (this.#refArgsUnchanged(occurrence, record)) {
          this.#slotArgs.set(occurrence, record);
          this.#reconcileRegions(occurrence, record);
          continue;
        }
        // Args changed, live binding (the mount registered ctx.onUpdate):
        // push the re-resolved props into the LIVE occurrence instead of
        // re-calling — the consumer's reactive props update in place, so
        // client state on the occurrence (expansion, focus, animation)
        // follows the entity across morphs. #resolveArgs reuses/renames the
        // cached regions, so `{$frame}` args keep their live elements.
        const update = this.#slotUpdaters.get(occurrence);
        if (update) {
          // One record shape (A5): every transport's record carries ALL of
          // the occurrence's region args as `{$frame}` refs, so the resolved
          // props are complete — a key the record omits really was removed.
          const props = this.#resolveArgs(occurrence, record.args);
          this.#slotArgs.set(occurrence, record);
          update(props);
          this.#bindRegions(occurrence);
          continue;
        }
        // Args changed (incl. late args): re-call this occurrence only,
        // reusing its cached server-content regions. Same contract: an
        // undefined return keeps the current interior.
        const nodes = this.#invokeSlot(occurrence, callback, record, start);
        if (consumers)
          this.#slotNodes.set(
            occurrence,
            consumers.map(c => c.element)
          );
        else {
          if (nodes) this.#replaceRange(occurrence, start, nodes);
          this.#slotNodes.set(occurrence, nodes);
        }
        this.#bindRegions(occurrence);
      }
    }

    // Unmount occurrences whose range has disappeared from the server content
    // — full-frame syncs only; a scoped fragment fill never removes siblings.
    if (!root) {
      for (const occurrence of [...this.#mountedSlots]) {
        if (!found.has(occurrence)) this.#unmountSlot(occurrence);
      }
      // The frame's hold (frames-rulings 3.2): ONE registration with the
      // integration while a sync leaves an occurrence waiting to mount —
      // whatever it waits for (the record, the `{$ref}` data, a hold added
      // later) — released by the first sync that leaves none, or by
      // disposal. The waits are bounded as a `<Loading>` resume's is: the
      // record by the document's records running out (`recordsPending`),
      // the ref by the stream's `complete`/`:error`.
      if (waiting && !this.#hold) this.#hold = this.#options.hold?.();
      else if (!waiting && this.#hold) this.#releaseHold();
    }
  }

  #releaseHold() {
    const release = this.#hold;
    this.#hold = undefined;
    release && release();
  }

  /**
   * Invoke a slot occurrence's callback with resolved props. `ctx.existing`
   * carries the range's current interior (server-rendered client content on
   * an adopted document-SSR boot; the previous output on a re-call) so a
   * framework binding can hydrate onto it. Returns the nodes to place, or
   * null when the callback returned undefined — "I claimed the existing DOM,
   * leave the range alone".
   */
  #invokeSlot(occurrence, callback, record, start, adopted) {
    // A (re-)call replaces the occurrence's binding wholesale: drop the old
    // binding's updater so a stream args-change can't push props into a
    // disposed instance. The new invocation re-registers if it wants updates.
    this.#slotUpdaters.delete(occurrence);
    this.#slotRebinders.delete(occurrence);
    const cleanups = this.#slotCleanups.get(occurrence) ?? [];
    // One walk yields both the interior and the end marker. The end marker is
    // part of the consumer contract (ctx.range): a framework binding that owns
    // the range reactively (top-level dynamic slot content) needs an anchor to
    // insert before — the markers are the only stable nodes in the range.
    let existing = [];
    let end = null;
    // A data occurrence's node is its consumer list: no interior to collect,
    // no end marker. The consumer gets the positions instead.
    const positions = Array.isArray(start) ? start : undefined;
    if (start && !positions) end = eachInRange(start, occurrence, n => existing.push(n));
    const ctx = {
      // Identity for hydration-claim scoping: consumers derive the same
      // key prefix the document producer used for this occurrence. The
      // producer scopes EVERY occurrence (nested ones included) under the
      // root boundary's id, so region frames thread the root's claimScope
      // down rather than their own region id.
      frame: this.#options.claimScope ?? this.#options.id,
      key: occurrence,
      // True ONLY for the hydration-attach sync of an adopted document
      // range: the one invocation consumers may answer with a claim
      // (`existing` IS the server-rendered output). Stream re-calls leave
      // it unset — they must render for real (#547).
      adopted: !!adopted,
      // Whether this occurrence is a render-prop CALL (the producer placed
      // it with arguments — possibly empty — via a slot record) as opposed
      // to a direct-insert position. Consumers cannot tell from the resolved
      // props alone: an argless render prop and a direct insert both arrive
      // as `{}`, but one is a function to invoke and the other a value to
      // place.
      invoked: !!(record && record.kind === "slot"),
      onCleanup: fn => cleanups.push(fn),
      // Live-props opt-in: a binding that registers here receives re-resolved
      // props when a re-sent record's args CHANGE, instead of being re-called
      // — the occurrence's instance (and its client state) survives the
      // change. Registration is per-invocation; a real re-call clears it.
      onUpdate: fn => this.#slotUpdaters.set(occurrence, fn),
      existing,
      // The range's own markers, when it has them: consumers that bind the
      // interior reactively insert before `end` and return undefined — the
      // frame then never touches the interior (morphs protect slot ranges).
      range: end ? { start, end } : undefined,
      // Binding slot (§9.2.3): the positions of server markup that read this
      // occurrence — `[{ element, positions: [{ pos, key, name }] }]` in
      // document order. The consumer runs the fill, writes each position
      // from its returned object, and returns undefined (there is nothing
      // to place). `onRebind` receives the new set when consumers change
      // (a morph replaced an element; a response bound a new position)
      // without the args changing — the fill's computation survives.
      positions,
      onRebind: positions ? fn => this.#slotRebinders.set(occurrence, fn) : undefined
    };
    // One record shape (A5): the t=0 record carries used regions as
    // `{$frame}` refs like any stream record would, and #resolveArgs
    // resolves them to the elements #discoverRegions seeded from the
    // adopted interior — the wrapper's own reactivity OWNS the
    // already-rendered element from the first render (a client-only
    // toggle can hide/show it at t=0, no re-arming stream needed).
    const props =
      record && record.kind === "slot" ? this.#resolveArgs(occurrence, record.args) : {};
    // Run under the boundary's owner (when the creator provided one): slot
    // content reads the mount point's context (routers, stores) and bounds
    // its lifetime there. The t=0 adopt sync happens to run inside the
    // adopting render, but stream-driven mounts and re-calls arrive from
    // microtasks with no owner of their own — without the scope, a render
    // prop touching context works on boot and throws on the first refresh.
    const content = this.#scoped(() => callback(props, ctx));
    this.#slotArgs.set(occurrence, record);
    if (cleanups.length) this.#slotCleanups.set(occurrence, cleanups);
    if (content == null) return null;
    return Array.isArray(content) ? content : [content];
  }

  /** Replace the nodes between a slot range's start marker and its end marker. */
  #replaceRange(key, start, nodes) {
    const parent = start.parentNode;
    const end = eachInRange(start, key, n => parent.removeChild(n));
    for (const node of nodes) parent.insertBefore(node, end);
  }

  #unmountSlot(key) {
    this.#mountedSlots.delete(key);
    this.#slotNodes.delete(key);
    this.#slotConsumers.delete(key);
    // Long-session hygiene: an occurrence gone from the stream releases its
    // record and caches — keyed churn must not accumulate forever.
    this.#slotArgs.delete(key);
    this.#slotUpdaters.delete(key);
    this.#slotRebinders.delete(key);
    this.#slotResolvedRefs.delete(key);
    this.#removeSlotRecord(key);
    this.#runSlotCleanups(key);
    const regions = this.#slotRegions.get(key);
    if (regions) {
      disposeRegions(regions);
      this.#slotRegions.delete(key);
    }
  }

  #runSlotCleanups(key) {
    const cleanups = this.#slotCleanups.get(key);
    if (!cleanups) return;
    this.#slotCleanups.delete(key);
    for (const fn of cleanups) fn();
  }

  /**
   * Resolve a slot's raw args into client-facing props:
   *  - data ref `{$ref}`      -> the response-scoped serialized value.
   *  - frame ref `{$frame}`   -> a nested reconciled region delivered as a
   *    marker range (no wrapper element), **cached per slot** so a re-call
   *    reuses the same range and its bound frame. The client places the
   *    returned fragment; the region's frame renders/reconciles between the
   *    markers.
   *  - anything else          -> passed through as a literal.
   *
   * Regions cache by ARG NAME, not wire id: `(occurrence, arg)` IS the
   * region's identity, while its `$frame` childId is a per-stream wire name
   * — different producers prefix it differently (the document and direct
   * responses render under the function id, a single-flight region under
   * the call's address). A re-sent ref whose only change is the wire name
   * keeps the region — same element, same live interior — and the bound
   * frame REBINDS to the new name so the incoming stream's chunks reach it.
   */
  /**
   * Whether any of a record's DATA refs is still unknown to the response's
   * table — the record arrived ahead of the `data` chunks carrying its
   * values. Only `{$ref}` args can be pending this way: `{$frame}` regions
   * are addressing (resolved structurally) and primitives ship inline, so a
   * ref that resolves to `undefined` means "not delivered yet", never a real
   * value. See the call site in #syncSlots for why applying early is wrong.
   */
  #refsUnresolved(args, resolve?) {
    if (!this.#options.host) return false;
    for (const key in args) {
      if (isDataRef(args[key]) && this.#resolveRef(args[key], resolve) === undefined) return true;
    }
    return false;
  }

  /** A data ref through the host's tables, or a staged response's. */
  #resolveRef(ref, resolve) {
    const { host, id } = this.#options;
    if (resolve) return resolve(ref, id);
    return host ? host.resolve(ref, id) : undefined;
  }

  #regionsFor(slotKey) {
    let regions = this.#slotRegions.get(slotKey);
    if (!regions) this.#slotRegions.set(slotKey, (regions = new Map()));
    return regions;
  }

  #resolveArgs(slotKey, args, resolve?) {
    const host = this.#options.host;
    const regions = this.#regionsFor(slotKey);
    const props = {};
    for (const key in args) {
      const value = args[key];
      if (isDataRef(value)) {
        // The frame's id rides along so multi-stream hosts can route the
        // ref to the right response-scoped data table. The resolution is
        // cached per occurrence so a later stream's re-sent ref can be
        // VALUE-compared (tables rotate per response, so ref identity
        // alone can't prove equivalence).
        const resolved = this.#resolveRef(value, resolve);
        let cache = this.#slotResolvedRefs.get(slotKey);
        if (!cache) this.#slotResolvedRefs.set(slotKey, (cache = {}));
        cache[key] = resolved;
        props[key] = resolved;
      } else if (isFrameRef(value)) {
        // A nested server-content region: a single frame ELEMENT the wrapper
        // places. On re-call the wrapper re-places the SAME element (the
        // platform moves the subtree as one node — no marker range to walk,
        // no fragment refill), and the bound frame's parent follows live.
        let entry = regions.get(key);
        if (!entry) {
          const element = makeFrameElement(value.$frame);
          entry = { childId: value.$frame, element, frame: undefined };
          regions.set(key, entry);
        } else if (entry.childId !== value.$frame) {
          renameRegion(entry, value.$frame);
        }
        props[key] = entry.element;
      } else {
        // Literal args may carry protocol markers the integration knows how
        // to revive (document-face container traces arrive as inline
        // literals rather than `{$ref}`s — see reviveContainerTraces). The
        // host hook keeps this module protocol-agnostic.
        props[key] = host && host.revive ? host.revive(value) : value;
      }
    }
    return props;
  }

  /**
   * Element discovery for the adopt path — claim wiring only (A5): the t=0
   * record names every region arg by `{$frame}` address, and this walk
   * locates the already-rendered ELEMENTS those addresses resolve to,
   * seeding entries (marked `adopt`) so `#resolveArgs` reuses the adopted
   * node instead of minting an empty one. Seed from the OUTERMOST region
   * elements in the interior (a region's own deeper regions belong to its
   * occurrences and are discovered recursively when those claim);
   * `#bindRegions` then constructs adopting frames over them, which run
   * their own slot sync — this is what wires nested occurrences at boot.
   */
  #discoverRegions(slotKey, start) {
    // A data occurrence has no interior (its args are data; a region arg
    // has nowhere to render at an attribute position).
    if (!start || Array.isArray(start)) return;
    const regions = this.#regionsFor(slotKey);
    eachInRange(start, slotKey, n => collectRegionElements(n, regions));
  }

  /**
   * Whether a re-sent slot record's args are VALUE-equal to the mounted
   * occurrence's: primitives structurally, {$frame} refs by position — the
   * same arg of the same occurrence IS the same region whatever wire name
   * this stream gave it (see #resolveArgs; `#reconcileRegions` follows the
   * rename) — and {$ref}s by resolving the incoming ref (current table)
   * against the cached resolution from mount. One record shape (A5): every
   * transport's record carries the occurrence's full key set, so an added
   * or removed key is a REAL args change. Unresolvable or
   * non-JSON-comparable values fall back to "changed" (re-call) — the
   * conservative default.
   */
  #refArgsUnchanged(occurrence, record, resolve?) {
    const old = this.#slotArgs.get(occurrence);
    if (!record || record.kind !== "slot") return false;
    if (old && old.kind !== "slot") return false;
    const a = (old && old.args) || {};
    const b = record.args || {};
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (kb.length !== ka.length) return false;
    const cache = this.#slotResolvedRefs.get(occurrence);
    for (const key of ka) {
      const va = a[key];
      const vb = b[key];
      if (va === vb) continue;
      if (isFrameRef(va) && isFrameRef(vb)) continue;
      if (isDataRef(va) && isDataRef(vb) && cache && key in cache) {
        const host = this.#options.host;
        const next = this.#resolveRef(vb, resolve);
        // A live CONTAINER (DR-2's container tier) must be identity-compared
        // BEFORE any probe: a pending container's property reads throw
        // not-ready, so the async probe below (or the stringify) would
        // detonate it. Same table -> same materialized instance (adopt
        // silently); a re-serialized trace materializes a NEW container and
        // that IS a change (a fresh generation the live update pushes).
        if (host && host.isContainer && (host.isContainer(next) || host.isContainer(cache[key]))) {
          if (next === cache[key]) continue;
          return false;
        }
        // An async value (DR-2's value tier: the arg is passed WHOLE and the
        // consumer's READ settles) is never serialization-comparable — every
        // promise stringifies to `{}`, so two DIFFERENT pending values read
        // as equal and the occurrence keeps the PREVIOUS response's value
        // forever. Identity is the only sound test, and `va === vb` above
        // already made it: from here, an async value on either side is a
        // CHANGE, and the live update re-suspends on the new one (holding
        // the settled value meanwhile, which is the point of the tier).
        if (isAsyncLike(next) || isAsyncLike(cache[key])) return false;
        try {
          if (JSON.stringify(next) === JSON.stringify(cache[key])) continue;
        } catch (e) {
          return false;
        }
      }
      return false;
    }
    return true;
  }

  /**
   * Follow an adopted record's region wire names without re-calling: for
   * each `{$frame}` arg whose childId differs from the cached entry's,
   * rebind the live region frame to the new name — the stream that sent
   * this record addresses the region's content by it. Runs only on the
   * adopt-without-recall path; a re-call reconciles through #resolveArgs.
   */
  #reconcileRegions(occurrence, record) {
    const args = record && record.args;
    if (!args) return;
    const regions = this.#slotRegions.get(occurrence);
    if (!regions) return;
    for (const key in args) {
      const value = args[key];
      if (!isFrameRef(value)) continue;
      const entry = regions.get(key);
      if (entry && entry.childId !== value.$frame) renameRegion(entry, value.$frame);
    }
  }

  #bindRegions(slotKey) {
    const regions = this.#slotRegions.get(slotKey);
    if (!regions) return;
    for (const entry of regions.values()) {
      if (!entry.frame) {
        // Bind eagerly — the region ELEMENT always exists (unlike the old
        // marker range, which needed placement in a fragment/DOM to count).
        // This is what makes an OCCLUDED region work: its element is created
        // when args resolve but the wrapper doesn't place it until (e.g.)
        // expand, so it must bind and fill (from buffered/streamed chunks)
        // off-DOM, then reveal in place when the wrapper finally inserts the
        // single node. Host buffering flushes any queued childId chunks. The
        // region inherits this frame's slot resolution, so client slots
        // revealed in its streamed content are filled by the same callbacks
        // the client threaded down — no global registry.
        entry.frame = new FrameImpl(entry.element, null, null, {
          id: entry.childId,
          host: this.#options.host,
          // Regions discovered from adopted document elements already hold
          // their server-rendered content (adopt); streamed regions start
          // empty. Claim scoping threads the root boundary's id down.
          adopt: entry.adopt,
          claimScope: this.#options.claimScope ?? this.#options.id,
          // Element-claim sweeps in the region bind cleanup to the same
          // boundary owner as the root's.
          ownerScope: this.#options.ownerScope,
          resolveSlot: prop => this.#resolveSlot(prop),
          resolveSlotRecord: occurrence => this.#resolveSlotRecord(occurrence),
          removeSlotRecord: occurrence => this.#removeSlotRecord(occurrence)
        });
      }
    }
  }

  /** Collect this frame's own top-level slot ranges (bounded to its content),
   *  and — for the slot sync — its binding-slot elements into the same map. */
  #collectSlots(found, elements) {
    collectSlots(this.#firstContent(), this.#end, found, elements);
  }

  /** Find a fragment placeholder `<template id="pl-NAME">` bounded to this
   *  frame's content, or null. */
  #findPlaceholder(name) {
    return findPlaceholder(this.#firstContent(), this.#end, placeholderId(name));
  }

  /**
   * For the host's last-unmount capture (see host.unregister): an element
   * boundary's current interior, needed exactly when its content never rode
   * chunks — a document-adopted frame, whose markup arrived as page HTML —
   * so the resident store lacks the root record a later mount would
   * re-materialize from. Null when there is nothing to capture.
   */
  contentHTML() {
    if (this.#disposed || !this.#element || !this.#hasContent) return null;
    return this.#element.innerHTML;
  }

  /**
   * Re-bind this live mount's pull to a different address's store — the
   * delivery mechanics of the identity split (DR-1): a site whose call
   * switched arguments keeps its instance and the instance follows the new
   * binding here. Nothing tears down: the element stays in the document,
   * slot occurrences stay mounted with their live client state, and the new
   * address's content lands as writes into the SAME store, so the morph +
   * record dedupe machinery decides per occurrence what survives — exactly
   * as a refetch into an unmoved boundary would.
   *
   * Leaving the old address leaves its resident store warm (a later mount
   * of the old call re-materializes what it showed), and joining the new
   * one runs the normal registration protocol: seed from its resident store
   * — content already there morphs in instantly; a stream in flight for the
   * new call morphs over. The version affinity resets because version
   * histories are per address: the new address's writes come from a
   * different counter, and policy A's stale-guard must not drop them
   * against the old stream's numbering. Segment bookkeeping resets with it,
   * mirroring the version-bump branch of `apply` — fragment names restart
   * per stream.
   */
  rebind(id) {
    if (this.#disposed || id === this.#options.id) return;
    const { host, id: oldId } = this.#options;
    if (host && oldId !== undefined) host.unregister(oldId, this);
    // Copy-on-rebind: the options object belongs to the creator.
    this.#options = { ...this.#options, id };
    if (this.#element && this.#element.nodeType === ELEMENT_NODE) {
      this.#element.setAttribute(FRAME_ID_ATTR, id);
    }
    this.#version = undefined;
    // The applied state leaves with the old address (see #resetStreamState):
    // the new address's html may be byte-identical to the old one's
    // (slot-driven content ships its differences as records, not markup),
    // and the value-skip must not swallow the new stream's morph; the old
    // root RECORD goes too, so a flush between this rebind and the new
    // stream's html finds no stale shell to re-apply. The DOM keeps showing
    // the old content either way (async-holds-latest owns that); a warm
    // re-registration re-seeds its own root record and still answers
    // synchronously.
    this.#resetStreamState();
    if (host) host.register(id, this);
  }

  /**
   * Forget the version baseline without touching content: the store, DOM,
   * and slot state stay, but the next write is accepted whatever its number.
   * The host calls this after seeding a registration from the resident
   * store — the store's version belongs to whatever stream space last wrote
   * it, and it must not out-rank the registering mount's live counter.
   */
  rebase() {
    this.#version = undefined;
  }

  /** The have-list of what this mount shows (see the `Frame` interface). */
  have() {
    return this.#have;
  }

  /**
   * Ledger upkeep for an applied content record: the entry under `key`
   * takes the record's digest and the map of holes inside it. A record
   * without a digest (an older producer) leaves the entry as it was.
   * Without a ledger (no digest-carrying root applied) there is nothing to
   * keep — the next resume is a full snapshot either way.
   */
  #recordHave(key, record) {
    if (!this.#have || !record || record.digest === undefined) return;
    this.#have[key] = record.digest;
    if (record.holes) Object.assign(this.#have, record.holes);
  }

  dispose() {
    if (this.#disposed) return;
    // Unregister FIRST: a last-unmount may capture this boundary's interior
    // into the resident store (see host.unregister), and that must see the
    // DOM before the teardown below releases records and regions.
    const { host, id } = this.#options;
    if (host && id !== undefined) host.unregister(id, this);
    this.#disposed = true;
    if (this.#recordRefresh) {
      clearTimeout(this.#recordRefresh);
      this.#recordRefresh = null;
    }
    this.#releaseHold();
    for (const key of [...this.#slotCleanups.keys()]) this.#runSlotCleanups(key);
    // Release this frame's occurrences' records from the store that owns them
    // (an ancestor's, for a region frame's nested occurrences) so a torn-down
    // region leaves nothing stale to dedupe a later re-navigation against.
    for (const key of this.#mountedSlots) this.#removeSlotRecord(key);
    for (const regions of this.#slotRegions.values()) disposeRegions(regions);
    this.#slotRegions.clear();
    this.#mountedSlots.clear();
  }

  #applyRoot(html) {
    const fragment = parseFragment(html);
    const parent = this.#parent();
    if (!this.#hasContent) {
      this.#clearContent();
      // Claim before insertion empties the fragment — matching compiled
      // output, which claims at creation, pre-insert.
      this.#claimTree(fragment);
      parent.insertBefore(fragment, this.#end);
      this.#hasContent = true;
    } else {
      // #claimTree self-gates on registered nav-claim handlers, so it
      // threads in unconditionally.
      const claim = this.#claimTree;
      // Frame-wide displaced-range index. Slot ranges are keyed by occurrence
      // id, unique within this frame's content, and a keyed re-render can move
      // an occurrence ACROSS PARENTS (deleting a list item shifts every range
      // below it into a different <li>). The reconcile's sibling-scoped
      // matching can't see those; without the index it adopted the incoming
      // empty marker pair and the record dedupe then never re-invoked — the
      // occurrence's live interior was silently destroyed.
      const ranges = new Map();
      this.#collectSlots(ranges);
      // Identity-first (DR-5): the reconcile resolves every incoming marker
      // pair against this index — in its own pass, and through graft sites
      // recorded as wholesale-inserted subtrees land — so a live range is
      // never orphaned by position. Entries left over are occurrences the
      // new content dropped: detached, exactly what removal meant.
      const grafts = [];
      reconcileChildren(parent, fragment, this.#start, this.#end, claim, ranges, grafts);
      if (ranges.size) for (const root of grafts) flushGrafts(root, ranges);
    }
  }

  /**
   * Morph a live hole's marked range (`<!--lh:N-->…<!--lh:/N-->`, marker =
   * `lh:N`) to its re-emitted html — the client half of the Stage 3 hole
   * ledger. The same range-anchored reconcile as the root morph, so
   * interior element identity (focus, media, third-party widget state)
   * survives value ticks. Live holes never contain slot ranges or nested
   * regions (the server's record gate latches such holes), so no
   * displaced-range index is needed. Returns whether the markers were
   * found and the morph ran.
   */
  #applyHole(marker, html) {
    if (!this.#hasContent) return false;
    const open = findLiveTarget(
      this.#firstContent(),
      this.#end,
      n => n.nodeType === COMMENT_NODE && n.data === marker
    );
    if (!open) return false;
    const close = rangeClose(open, "lh:/" + marker.slice(3));
    if (!close) {
      if ("_SOLID_DEV_") {
        console.error(
          `Live hole "${marker}" is missing its closing comment; update dropped. ` +
            `Likely an HTML-rewriting layer stripped it.`,
          open
        );
      }
      return false;
    }
    reconcileChildren(open.parentNode, parseFragment(html), open, close, this.#claimTree);
    return true;
  }

  /**
   * Apply a live attr-hole re-emission: find the element addressed
   * `data-lha="addr"` in this frame's range, parse the rebuilt attribute
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
   */
  #applyAttrs(addr, text, removed) {
    if (!this.#hasContent) return false;
    const el = findLiveTarget(
      this.#firstContent(),
      this.#end,
      n => n.nodeType === ELEMENT_NODE && n.getAttribute("data-lha") === addr
    );
    if (!el) return false;
    const parsed = parseFragment(`<i${text}></i>`).firstChild;
    const keepOpen = preservesOpen(el);
    // Binding-slot positions the rebuilt text marks stay the client's, as in
    // the root morph (`morphAttributes`).
    const owned = parsed ? ownedPositions(parsed) : null;
    const current = el.attributes;
    for (let i = current.length - 1; i >= 0; i--) {
      const name = current[i].name;
      if (name === "data-lha" || (keepOpen && name === "open")) continue;
      if (!parsed || !parsed.hasAttribute(name)) {
        if (applyOwned(el, name, "", owned) !== undefined) continue;
        el.removeAttribute(name);
      }
    }
    if (parsed) {
      for (let i = 0; i < parsed.attributes.length; i++) {
        const { name, value } = parsed.attributes[i];
        if (keepOpen && name === "open") continue;
        if (applyOwned(el, name, value, owned) !== undefined) continue;
        if (el.getAttribute(name) !== value) el.setAttribute(name, value);
      }
    }
    if (removed)
      for (const name of removed) {
        if (keepOpen && name === "open") continue;
        if (applyOwned(el, name, "", owned) !== undefined) continue;
        el.removeAttribute(name);
      }
    return true;
  }

  /** Remove the frame's current content (bounded to its range). */
  #clearContent() {
    removeUntil(this.#parent(), this.#firstContent(), this.#end);
  }

  /** Sweep-claim the frame's existing content (the adoption path). */
  #claimContent() {
    let n = this.#firstContent();
    while (n && n !== this.#end) {
      this.#claimTree(n);
      n = n.nextSibling;
    }
  }

  #segmentReady(name) {
    const content = this.#store[`seg:${name}`];
    if (!content || content.kind !== "html") return false;
    // Reveal gate must be present and truthy.
    if (!this.#store[`seg:${name}:reveal`]) return false;
    // Style gate: the segment's streamed stylesheets must be loaded before it
    // shows (the $dfs/$dfc analogue). ensureStylesheet inserts pending links
    // immediately — even when other prerequisites are missing — so loading
    // overlaps with the rest of the stream; #styleFlush re-runs this frame
    // when one settles. Inline styles never gate (they apply on insertion).
    const assets = this.#store[`seg:${name}:assets`];
    if (assets && assets.styles) {
      let ready = true;
      for (const entry of assets.styles) ready = ensureStylesheet(entry, this.#styleFlush) && ready;
      if (!ready) return false;
    }
    // Structural prerequisite: the placeholder must exist in this frame's range.
    if (!this.#findPlaceholder(name)) return false;
    return true;
  }

  /**
   * Reveal a segment into its placeholder range ($df semantics): remove any
   * materialized fallback between the `pl-` template and its closing comment,
   * insert the content there, and remove both markers.
   */
  #revealSegment(name) {
    const tpl = this.#findPlaceholder(name);
    if (!tpl) return;
    // Inline styles ride the segment's assets record and apply just before
    // its content shows (document order: <style> precedes the template).
    const assets = this.#store[`seg:${name}:assets`];
    if (assets && assets.inlineStyles) applyInlineStyles(assets.inlineStyles);
    const content = this.#store[`seg:${name}`];
    const closing = rangeClose(tpl, placeholderId(name));
    if ("_SOLID_DEV_" && !closing) {
      console.error(
        `Frame fragment placeholder "${name}" is missing its closing comment ` +
          `(<!--${placeholderId(name)}-->); revealed content will be appended at the end of ` +
          `its parent instead of in place. Likely an HTML-rewriting layer stripped the ` +
          `comment, or invalid nesting split the placeholder range.`,
        tpl
      );
    }
    const parent = tpl.parentNode;
    // Clear the current range interior (a materialized fallback, if #showFallback
    // ran) — both paths below re-own this position.
    removeUntil(parent, tpl.nextSibling, closing);

    if (this.#options.reveal) {
      // Boundary-driven reveal (the ratified "per-`<Loading>`" model): the
      // server `<Loading>` boundary's footprint on the client is this exact
      // placeholder seam, so the binding reconstructs a client boundary here —
      // fallback = the placeholder's own template content, children = the
      // segment content plus its client fills, rendered INSIDE the boundary so
      // their readiness gates it. An unboundaried async fill suspends up to
      // THIS boundary and is covered, not orphaned; a fill with its own
      // boundary contains itself. Cost is one boundary per revealed segment —
      // and segments are `<Loading>` boundaries (few, author-placed), so this
      // is React's granularity, not a per-chunk tax. `closing` stays as the
      // boundary's insertion anchor; only the template is removed.
      const fallbackFrag = tpl.content.cloneNode(true);
      this.#claimTree(fallbackFrag);
      this.#options.reveal({
        before: closing,
        fallback: [...fallbackFrag.childNodes],
        content: () => {
          const materialized = this.#materialize(content);
          this.#syncSlots(materialized);
          this.#claimTree(materialized);
          return materialized;
        }
      });
      tpl.remove();
      this.#revealed.add(name);
      this.#recordHave(name, content);
      return;
    }

    const materialized = this.#materialize(content);
    this.#claimTree(materialized);
    parent.insertBefore(materialized, closing);
    tpl.remove();
    closing && closing.remove();
    this.#revealed.add(name);
    this.#recordHave(name, content);
  }

  /**
   * Materialize the placeholder template's own content into the range
   * ($dfl semantics) without resolving the segment. Returns whether the
   * fallback was shown.
   */
  #showFallback(name) {
    const tpl = this.#findPlaceholder(name);
    if (!tpl) return false;
    const closing = rangeClose(tpl, placeholderId(name));
    if (!closing) return false;
    const fallback = tpl.content.cloneNode(true);
    this.#claimTree(fallback);
    closing.parentNode.insertBefore(fallback, closing);
    return true;
  }

  /** Materialize a content record into nodes (HTML fragments — the v1 and
   *  only payload mode; see docs/frame-seams-decision.md on why structural
   *  compression is not pursued). */
  #materialize(record) {
    return record.kind === "html" ? parseFragment(record.value) : parseFragment("");
  }
} /**
 * A frame rendering into an EXISTING element boundary. Pass `adopt: true` for
 * the document-SSR path: the element already holds server-rendered content,
 * so the first apply morphs against it and slots sync immediately (hydration
 * attach), claiming their server-rendered DOM — a document boot needs no
 * chunk.
 * @experimental
 */
export function createFrame(boundary: Element, options?: FrameOptions): Frame;

export function createFrame(boundary, options) {
  return new FrameImpl(boundary, null, null, options);
}

// The boundary/region element vocabulary — the DOM contract the producer
// (frame-sink.js) emits at t=0 and this consumer creates/adopts on the
// client. A frame mounts INTO this element: server content is its children,
// morphed in place. Making the boundary a first-class node is the whole
// point of the element-seams decision — `insert`/`reconcileArrays`/Suspense
// handle it natively with no brand (closing #550), and it cannot be split by
// invalid nesting or stripped by a CDN the way a comment-marker range can
// (see docs/frame-seams-decision.md). Kept in sync with the producer by
// convention, like the `slot:`/`frame:` marker strings already are — the two
// don't share a module (one is server-only, one client-only).
export const FRAME_TAG = "solid-frame";
export const FRAME_ID_ATTR = "data-fid"; /**
 * Create a boundary/region ELEMENT and bind a host-registered frame to it.
 * The frame mounts INTO the element (server content is its children, morphed
 * in place). Because the boundary is a real node, `insert` places the
 * returned `element` in any position — single, array, or fragment — with no
 * special-casing. One frame per element; lifecycle belongs to the creator via
 * `dispose()` (register it with your owner's cleanup).
 * @experimental
 */
export function createFrameElement(options: FrameOptions): {
  readonly element: Element;
  readonly frame: Frame;
  dispose(): void;
};

/**
 * Create a boundary/region element and bind a frame to it (element mode).
 * Boundary identity belongs to the client, so the client creates the
 * element: a `<solid-frame>` rendered `display:contents` — layout- and
 * box-transparent, exactly like the comment range it replaces. Registered
 * with `options.host` under `options.id`, so streamed chunks route to it,
 * including any buffered before mount.
 *
 * Returns the element (a real node `insert()` places with no brand, in any
 * position — array, fragment, single) plus lifecycle. One frame per element;
 * server updates flow through the stream (policy A morphs in place), and
 * teardown is `dispose()` — the Solid binding ties it to its owner via
 * `onCleanup`.
 *
 * The tag is always `<solid-frame>`: a boundary can't sit inside table
 * internals at t=0 (the parser foster-parents a non-table element out of a
 * `<table>`), which is a documented, nameable limitation — own the whole
 * table in the server component, or supply rows via a client slot — not an
 * `as` escape hatch.
 */
export function createFrameElement(options) {
  const el = makeFrameElement(options.id);
  const frame = new FrameImpl(el, null, null, options);
  return {
    element: el,
    frame,
    dispose() {
      frame.dispose();
      el.remove();
    }
  };
}

/**
 * Create a bare boundary/region element (no frame bound yet). `<solid-frame>` is
 * inlined as `display:contents` — not a stylesheet or custom-element
 * registration — so it holds before any bundle loads and needs nothing
 * defined: an undefined custom element is inert HTMLUnknownElement, and
 * `display:contents` makes it generate no box, so its children lay out in the
 * frame's parent.
 */
function makeFrameElement(id) {
  const el = document.createElement(FRAME_TAG);
  el.style.display = "contents";
  if (id !== undefined) el.setAttribute(FRAME_ID_ATTR, id);
  return el;
}

/** Whether `node` is a frame boundary/region element (carries our id attr). */
function isFrameElement(node) {
  return node.nodeType === ELEMENT_NODE && node.hasAttribute(FRAME_ID_ATTR);
}

/** Returns the segment name for a `seg:<name>` content key, else `null`. */
function segmentName(key) {
  const m = /^seg:([^:]+)$/.exec(key);
  return m ? m[1] : null;
}

/** An async value in the DR-2 value-tier sense: passed whole, the consumer's
 *  READ settles. Never serialization-comparable — see #refArgsUnchanged. */
function isAsyncLike(v) {
  return !!v && (typeof v.then === "function" || typeof v[Symbol.asyncIterator] === "function");
}

/** The prop name for a slot occurrence id: `comment#0` -> `comment`, `x` -> `x`. */
function propOf(occurrence) {
  const hash = occurrence.indexOf("#");
  return hash === -1 ? occurrence : occurrence.slice(0, hash);
}

/** Whether an occurrence id names a render-prop CALL (`prop#n`, minted with
 *  a record) rather than the bare prop (a direct-insert position). */
function isCalled(occurrence) {
  return occurrence.indexOf("#") !== -1;
}

function isDataRef(value) {
  return !!value && typeof value.$ref === "string";
}

function isFrameRef(value) {
  return !!value && typeof value.$frame === "string";
}

/** Dispose every bound frame in a slot's region-entry map. */
function disposeRegions(regions) {
  for (const { frame } of regions.values()) frame?.dispose();
}

/** Remove siblings from `n` (inclusive) up to `stop` (exclusive). */
function removeUntil(parent, n, stop) {
  while (n && n !== stop) {
    const next = n.nextSibling;
    parent.removeChild(n);
    n = next;
  }
}

/** Parse an HTML string into a document fragment, preserving comments. */
function parseFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

// ---- Style loading (reveal gating) ------------------------------------
//
// Minimal, import-free mirror of the client asset registry's conventions
// (client.js acquireAsset): data-asset ids for inline styles, attribute-
// compared lookup instead of selector interpolation, adopt elements already
// in the document. The Solid binding can swap in the ref-counted
// registry later; the gate only needs "are this segment's stylesheets loaded,
// and call me back when they settle".

// Mirrors head.ts without importing it into the standalone frame client.
const PRELOAD_QUALIFIERS = ["as", "crossorigin", "type", "media", "imagesrcset", "imagesizes"];

// Mirrors head.ts's qualifierValue — keep them in step. `as` folds ASCII
// case; an empty source set or size reads as absent (registration never
// emits one); `crossorigin` is three states, not a string range, so `""`, a
// bare attribute and `anonymous` are one request. Frame `attrs` are already
// canonical strings, but the document may carry any spelling.
function qualifierValue(name, value) {
  if (value == null) return null;
  if (name === "imagesrcset" || name === "imagesizes") return value === "" ? null : value;
  if (name === "as") return value.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
  if (name !== "crossorigin") return value;
  return value.length === 15 && value.toLowerCase() === "use-credentials"
    ? "use-credentials"
    : "anonymous";
}

/** Attribute-compared head lookup so href/id values never need escaping. */
function findHeadElement(selector, attr, value, qualifiers) {
  candidate: for (const node of document.head.querySelectorAll(selector)) {
    if (node.getAttribute(attr) !== value) continue;
    if (!qualifiers) return node;
    for (let i = 0; i < PRELOAD_QUALIFIERS.length; i++) {
      const name = PRELOAD_QUALIFIERS[i];
      if (
        qualifierValue(name, node.getAttribute(name)) !==
        qualifierValue(name, qualifiers[name] ?? null)
      )
        continue candidate;
    }
    return node;
  }
  return null;
}

/** Ensure one typed preload exists, preserving request-qualifying attributes. */
function ensurePreload(entry) {
  const attrs = entry.attrs;
  const href = entry.href;
  if (findHeadElement('link[rel="preload"]', "href", href || null, attrs)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  for (const name in attrs) link.setAttribute(name, attrs[name]);
  if (href) link.setAttribute("href", href);
  document.head.appendChild(link);
}

/**
 * Ensure a stylesheet link exists and report whether it has settled. A link
 * this loader created tracks waiters until load/error (error unblocks too —
 * same policy as the document runtime's $dfc gate); a link that was
 * already in the document counts as settled. `entry` is a url string or an
 * attributed record `{ href, attrs }` (fetch-metadata attributes carried by
 * useHead stylesheets).
 */
function ensureStylesheet(entry, onSettle) {
  const href = typeof entry === "string" ? entry : entry.href;
  let link = findHeadElement('link[rel="stylesheet"]', "href", href);
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    if (typeof entry !== "string" && entry.attrs) {
      for (const name in entry.attrs) link.setAttribute(name, entry.attrs[name]);
    }
    link.href = href;
    const waiters = new Set();
    link._$frWaiters = waiters;
    const settle = () => {
      link._$frWaiters = null;
      for (const fn of waiters) fn();
    };
    link.addEventListener("load", settle);
    link.addEventListener("error", settle);
    document.head.appendChild(link);
  }
  const waiters = link._$frWaiters;
  if (waiters == null) return true; // settled, or document-owned
  waiters.add(onSettle);
  return false;
}

/** Ensure a modulepreload link exists for `href` (deduped, adopt existing). */
function ensureModulePreload(href) {
  if (findHeadElement('link[rel="modulepreload"]', "href", href)) return;
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  document.head.appendChild(link);
}

/** Insert inline-style entries into the head, deduped by data-asset id. */
function applyInlineStyles(inlineStyles) {
  for (const entry of inlineStyles) {
    if (findHeadElement("style[data-asset]", "data-asset", entry.id)) continue;
    const el = document.createElement("style");
    el.setAttribute("data-asset", entry.id);
    if (entry.attrs) {
      for (const name in entry.attrs) el.setAttribute(name, entry.attrs[name]);
    }
    el.textContent = entry.content || "";
    document.head.appendChild(el);
  }
}

/** Whether `node` is the `<template id="pl-KEY">` placeholder start marker. */
function isPlaceholderStart(node, id) {
  return node.tagName === "TEMPLATE" && node.id === id;
}

/** The `<!--pl-KEY-->` comment closing a placeholder range, or null. */
function rangeClose(start, id) {
  let n = start.nextSibling;
  while (n) {
    if (n.nodeType === COMMENT_NODE && n.data === id) return n;
    n = n.nextSibling;
  }
  return null;
}

/**
 * Depth-first search among the siblings `[n, end)` for a live-hole target —
 * an open comment (`<!--lh:N-->`) or an addressed element (`data-lha`),
 * matched by `test`. Descends through elements — including region elements,
 * whose holes belong to the stream that produced them (one id counter per
 * response) — but never into nested boundary frames (bare ids): those are
 * separate streams with their own hole/address namespaces.
 */
function findLiveTarget(n, end, test) {
  while (n && n !== end) {
    if (n.nodeType === ELEMENT_NODE) {
      const fid = isFrameElement(n) ? n.getAttribute(FRAME_ID_ATTR) : null;
      if (fid === null || fid.includes(".")) {
        if (test(n)) return n;
        const found = findLiveTarget(n.firstChild, null, test);
        if (found) return found;
      }
    } else if (test(n)) return n;
    n = n.nextSibling;
  }
  return null;
}

/** Depth-first search among the siblings `[n, end)` for a placeholder
 *  template with the given id (descending through elements). */
function findPlaceholder(n, end, id) {
  while (n && n !== end) {
    if (isPlaceholderStart(n, id)) return n;
    if (n.nodeType === ELEMENT_NODE) {
      const found = findPlaceholder(n.firstChild, null, id);
      if (found) return found;
    }
    n = n.nextSibling;
  }
  return null;
}

/**
 * Collect slot ranges (`slot:<key>:start`) among the siblings `[n, end)` into
 * `out`, keyed by slot id. Descends through server-owned elements but never
 * into a range's interior or a nested frame/region element — those are
 * child-owned (the child discovers, with callbacks and records threaded
 * down), so slots belonging to nested frames / client content are ignored.
 */
function collectSlots(n, end, out, elements) {
  while (n && n !== end) {
    const id = slotStartId(n);
    if (id !== null) {
      if ("_SOLID_DEV_") devCheckRange(n, id);
      if (!out.has(id)) out.set(id, n);
      n = afterRange(n, id);
      continue;
    }
    if (elements !== undefined && isTextStart(n)) {
      textPosition(n, elements);
      n = afterText(n);
      continue;
    }
    if (n.nodeType === ELEMENT_NODE && !isFrameElement(n)) {
      // Data occurrences (`_s:*` markers), when the caller wants them — the
      // slot sync does; the morph's range index does not (an element is
      // reconciled as an element, not relocated as a protected range). The
      // element's positions join its occurrence's consumer list, in document
      // order. The element's interior is still walked: it is server content
      // and may hold further occurrences of either kind.
      if (elements !== undefined && n.hasAttributes()) {
        const byOccurrence = slotPositions(n);
        if (byOccurrence !== null) {
          for (const occurrence in byOccurrence) {
            const consumers = consumersOf(elements, occurrence);
            if (consumers) consumers.push({ element: n, positions: byOccurrence[occurrence] });
          }
        }
      }
      collectSlots(n.firstChild, null, out, elements);
    }
    n = n.nextSibling;
  }
}

/**
 * Collect the OUTERMOST frame region elements in `node`'s subtree into
 * `regions` (keyed by arg name — the childId's final segment, always the
 * dot-free arg identifier — seeded for adoption). A region is opaque — its
 * own deeper regions belong to its occurrences, discovered when they claim —
 * so the walk stops descending at each region element. Client wrapper
 * elements around a region are descended through.
 */
function collectRegionElements(node, regions) {
  if (node.nodeType !== ELEMENT_NODE) return;
  if (isFrameElement(node)) {
    const childId = node.getAttribute(FRAME_ID_ATTR);
    // Region ids are dotted (`<producer frame>.<occurrence>.<arg>`); bare ids
    // belong to nested document BOUNDARIES, which own their interiors (the
    // walk stops at every frame element, so a nested boundary's own regions
    // are never reachable from here). The producer prefix is wire-relative —
    // a mount registered under a call ADDRESS still adopts markup produced
    // under the function id — so region membership is structural
    // (outermost-in-this-interior), not prefix-matched.
    if (childId && childId.includes(".")) {
      const argKey = childId.slice(childId.lastIndexOf(".") + 1);
      if (!regions.has(argKey)) {
        regions.set(argKey, { childId, element: node, frame: undefined, adopt: true });
      }
    }
    return;
  }
  for (let c = node.firstChild; c; c = c.nextSibling) collectRegionElements(c, regions);
}

/**
 * Point a cached region entry at a new wire name: the identity (occurrence,
 * arg) and the live element/interior stay, while the bound frame re-registers
 * under the id the incoming stream addresses its content by. An entry not
 * bound yet (discovery just seeded it) only updates its element's id — the
 * eager bind that follows registers under the new name.
 */
function renameRegion(entry, childId) {
  entry.childId = childId;
  if (entry.frame) entry.frame.rebind(childId);
  else entry.element.setAttribute(FRAME_ID_ATTR, childId);
}

/**
 * Walk a slot range's interior — every node between `start` and the range's
 * end marker — calling `cb` on each. The next sibling is captured before the
 * callback runs, so callbacks may detach the node. Returns the end marker
 * (null if the range is truncated).
 */
function eachInRange(start, key, cb) {
  const end = slotEnd(key);
  let n = start.nextSibling;
  while (n && !(n.nodeType === COMMENT_NODE && n.data === end)) {
    const next = n.nextSibling;
    cb(n);
    n = next;
  }
  return n;
}

// --- Morph -----------------------------------------------------------------
//
// A zero-allocation, two-cursor server-owned DOM patch path: text/attribute
// updates, child insertion/removal, and preservation of two protected marker
// kinds — fragment placeholder ranges and slot ranges. It walks the
// live children and the freshly parsed source in lockstep instead of building
// intermediate token/result arrays, so the common "server churn around client
// anchors" case stays competitive with hand-written morphers.
//
// Slot ranges are opaque protected units: their interior is never
// diffed, and a range already in the right position is never touched — which
// is what preserves focus/selection/media inside it. Placeholder templates
// morph as ordinary elements (their fallback lives in .content, which child
// reconciliation never descends into).

/** If `node` is a `slot:<id>:start` comment, return its id; else `null`. */
function slotStartId(node) {
  if (node.nodeType !== COMMENT_NODE) return null;
  const m = SLOT_START.exec(node.data);
  return m ? m[1] : null;
}

/** Whether `node` is any slot marker (start or end). */
function isSlotMarker(node) {
  if (node.nodeType !== COMMENT_NODE) return false;
  const data = node.data;
  return SLOT_START.test(data) || SLOT_END.test(data);
}

// Identity-first at the element level (DR-5's last rung): server markup can
// carry entity identity as `_key` (the `_hk` family — framework-owned marks,
// compiled from `$key` in server JSX), and a keyed element matches ONLY the
// element with the same key — never positionally. With mismatched keys
// incompatible, the reconcile's existing relocation lookahead moves the
// keyed node into place, so live element state the morph deliberately
// preserves (value/checked properties, `open`, focus) follows the ENTITY
// across reorders instead of latching to the position. Sibling-scoped by
// design: an author key is only unique among siblings (the same id can
// appear under two parents in one frame), so wider matching would
// misattribute horizontally — matching client `For` semantics, where a
// cross-parent move is a teardown. Unkeyed elements (both null) keep
// positional matching untouched.
function compatible(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === ELEMENT_NODE)
    return a.nodeName === b.nodeName && a.getAttribute("_key") === b.getAttribute("_key");
  return a.nodeType === TEXT_NODE || a.nodeType === COMMENT_NODE;
}

// Live-state the server can't know: `open` on <details>/<dialog> IS the
// user's toggle (unlike form value/checked, which are PROPERTIES that
// decouple from their attributes after input, so an attribute-only morph
// already leaves them alone). The morph makes attributes match server output
// exactly, which would reset a user-opened <details> on every navigation —
// so `open` is preserved: never removed, never set by the morph. A server
// that must force it can rebuild the boundary (a genuine teardown), not a
// morph. Popover/dialog "showing" is not an attribute (JS API), so nothing
// to guard there.
function preservesOpen(el) {
  const t = el.tagName;
  return t === "DETAILS" || t === "DIALOG";
}

// Binding-slot ownership (principles §9.2.3). The INCOMING element's `_s:*`
// markers say which of its positions a client fill writes: `_s:hidden` owns
// the `hidden` attribute; `_s:class="occ:k=done"` owns the class name
// `done` and `_s:class="occ:k"` the whole `class` string (likewise `style`
// and its properties); `_s:on:*` / `_s:ref` are not attributes and need no
// guard. A position the client owns is left alone by the morph: not
// removed, not set. `class`/`style` are shared attributes — the server's
// classes and the fill's toggled names live in one string — so when a fill
// owns NAMES within them the morph applies the server's value and re-imposes
// the owned names' live state on top. The markers themselves are ordinary
// attributes and morph like any other, which is what lets the slot sync
// see a consumer change.
function ownedPositions(el) {
  const attrs = el.attributes;
  let out = null;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (!name.startsWith(SLOT_MARKER)) continue;
    const pos = name.slice(SLOT_MARKER.length);
    if (pos === "ref" || pos.startsWith("on:")) continue;
    out || (out = { attrs: new Set(), class: null, style: null });
    if (pos !== "class" && pos !== "style") {
      out.attrs.add(pos);
      continue;
    }
    for (const entry of attrs[i].value.split(",")) {
      const eq = entry.indexOf("=");
      if (eq === -1) {
        out.attrs.add(pos); // a whole-value read owns the attribute
        continue;
      }
      (out[pos] || (out[pos] = [])).push(decodeURIComponent(entry.slice(eq + 1)));
    }
  }
  return out;
}

/** Set `class` to the server's value with the fill-owned class names' live
 *  state preserved. Returns whether the attribute changed. */
function morphOwnedClass(oldEl, value, names) {
  const list = oldEl.classList;
  const set = new Set(value ? value.split(/\s+/) : []);
  set.delete("");
  for (const name of names) list.contains(name) ? set.add(name) : set.delete(name);
  const next = [...set].join(" ");
  if (next === (oldEl.getAttribute("class") || "")) return false;
  next ? oldEl.setAttribute("class", next) : oldEl.removeAttribute("class");
  return true;
}

/** Set `style` to the server's value with the fill-owned properties' live
 *  values preserved. Returns whether the attribute changed. */
function morphOwnedStyle(oldEl, value, names) {
  const style = oldEl.style;
  const saved = names.map(name => [
    name,
    style.getPropertyValue(name),
    style.getPropertyPriority(name)
  ]);
  const before = oldEl.getAttribute("style");
  value ? oldEl.setAttribute("style", value) : oldEl.removeAttribute("style");
  for (const [name, v, priority] of saved) {
    v ? style.setProperty(name, v, priority) : style.removeProperty(name);
  }
  return oldEl.getAttribute("style") !== before;
}

/**
 * Apply the server's value for `name` (null: absent) to an element with
 * binding-slot positions: a client-owned attribute is left alone; owned
 * `class`/`style` NAMES are re-imposed over the server's string. Returns
 * whether the attribute changed, or undefined when the position is not
 * owned and the caller writes it.
 */
function applyOwned(oldEl, name, value, owned) {
  if (owned === null) return undefined;
  if (owned.attrs.has(name)) return false;
  if ((name === "class" || name === "style") && owned[name] !== null) {
    return name === "class"
      ? morphOwnedClass(oldEl, value, owned.class)
      : morphOwnedStyle(oldEl, value, owned.style);
  }
  return undefined;
}

function morphAttributes(oldEl, newEl, claim) {
  let reclaim = false;
  let changed = false;
  const keepOpen = preservesOpen(oldEl);
  const owned = ownedPositions(newEl);
  const oldAttrs = oldEl.attributes;
  for (let i = oldAttrs.length - 1; i >= 0; i--) {
    const name = oldAttrs[i].name;
    if (keepOpen && name === "open") continue;
    if (!newEl.hasAttribute(name)) {
      const handled = applyOwned(oldEl, name, "", owned);
      if (handled !== undefined) {
        changed = handled || changed;
        continue;
      }
      oldEl.removeAttribute(name);
      changed = true;
      reclaim ||= claimedAttr(name);
    }
  }
  const newAttrs = newEl.attributes;
  for (let i = 0; i < newAttrs.length; i++) {
    const attr = newAttrs[i];
    const name = attr.name;
    if (keepOpen && name === "open") continue;
    const handled = applyOwned(oldEl, name, attr.value, owned);
    if (handled !== undefined) {
      changed = handled || changed;
      continue;
    }
    if (oldEl.getAttribute(name) !== attr.value) {
      oldEl.setAttribute(name, attr.value);
      changed = true;
      reclaim ||= claimedAttr(name);
    }
  }
  // The morph is the only write path for server-owned elements, and it makes
  // attributes match server output exactly — including STRIPPING state a
  // claim consumer applied (aria-current, data-active). So a claimable
  // element re-claims on ANY attribute change, letting the consumer
  // reassert; `href`/`action` transitions re-claim even when the element no
  // longer matches the selector (removal must fire, mirroring compiled
  // setAttribute). Direct claims, not subtree sweeps.
  if (claim && (reclaim || (changed && oldEl.matches(CLAIMED_ELEMENTS)))) claim(oldEl, true);
}

/** Morph `oldNode` in place to match `newNode` (assumed `compatible`). */
function morphNode(oldNode, newNode, claim, ranges, grafts) {
  if (oldNode.nodeType === ELEMENT_NODE) {
    // Escape hatch (the claim contract's analogue): an element the author
    // marks `data-preserve` keeps its live attributes AND subtree untouched
    // by the morph — for server DOM that a third-party widget has taken over
    // (a rich editor, a chart) or any state the deny-list above can't name.
    // The element stays matched in position; only its interior is frozen.
    if (oldNode.hasAttribute("data-preserve")) return;
    morphAttributes(oldNode, newNode, claim);
    reconcileChildren(oldNode, newNode, null, null, claim, ranges, grafts);
  } else if (oldNode.data !== newNode.data) {
    oldNode.data = newNode.data;
  }
}

/** The sibling immediately after the `slot:<id>:end` marker for `start`. */
const afterRange = (start, id) => afterMarker(start, slotEnd(id));
/** The sibling after a text position's end marker. */
const afterText = start => afterMarker(start, SLOT_TEXT_END);

/** The sibling immediately after the first `end` comment following `start`
 *  (null if the range is truncated). */
function afterMarker(start, end) {
  let n = start.nextSibling;
  while (n) {
    if (n.nodeType === COMMENT_NODE && n.data === end) return n.nextSibling;
    n = n.nextSibling;
  }
  return null;
}

/**
 * Dev: a binding-slot occurrence's marked positions cannot bind — no
 * fill resolves for its prop (`why` = "fill"), or a called occurrence has
 * no args record once records can no longer arrive ("record"). The
 * failure this names is otherwise silent: a handler that never fires, a
 * class that never updates, indistinguishable from nothing happening.
 * One report per occurrence per frame (`slotOrphans`, keyed by frame so
 * the class carries no dev-only field); the elements ride along in `data`
 * so a console can jump to them. A module function, not a method, so the
 * production build sheds it whole with its gated call sites.
 */
let slotOrphans;
function devSlotOrphan(frame, occurrence, consumers, why) {
  if (!"_SOLID_DEV_") return;
  let seen = (slotOrphans ??= new WeakMap()).get(frame);
  if (!seen) slotOrphans.set(frame, (seen = new Set()));
  if (seen.has(occurrence)) return;
  seen.add(occurrence);
  const prop = propOf(occurrence);
  const positions = new Set();
  for (const c of consumers) for (const p of c.positions) positions.add(p.pos);
  const where = `${consumers.length} element${consumers.length === 1 ? "" : "s"} (positions: ${[...positions].join(", ")})`;
  DEV.report(
    OBSERVE.diagnostics.emit(
      {
        code: "BINDING_SLOT_POSITION",
        kind: "render",
        severity: "warn",
        message:
          why === "fill"
            ? `[BINDING_SLOT_POSITION] Server markup binds \`${occurrence}\` at ${where}, but no client fill ` +
              `resolves for slot \`${prop}\` — those positions never bind and the elements are inert. ` +
              `Pass \`${prop}\` to the server component on the client (a function returning the object the ` +
              `markup reads), or check that the prop name matches on both sides.`
            : `[BINDING_SLOT_POSITION] Server markup binds \`${occurrence}\` at ${where}, but no args record ` +
              `for it arrived and none can — the fill mounts with empty args. A called slot always emits its ` +
              `record ahead of the markup that reads it, so this is the frame protocol out of step, not the fill: ` +
              `a client and server from different builds (a stale dev prebundle, a cached asset), or a runtime ` +
              `bug minting the marker and the record under different ids.`,
        data: { reason: "orphan", why, occurrence, elements: consumers.map(c => c.element) }
      },
      null
    )
  );
}

/**
 * Dev-only range integrity check: a slot start marker whose end marker is not
 * a later sibling means the range was corrupted between the producer and
 * here. `afterRange` returning null is ambiguous (an end marker that IS the
 * last sibling also has no `nextSibling`), so this re-scans for the marker
 * itself and reports the two known corruption causes loudly instead of
 * letting collection silently truncate at the broken range.
 */
function devCheckRange(start, id) {
  if (!"_SOLID_DEV_") return;
  const end = slotEnd(id);
  let n = start.nextSibling;
  while (n) {
    if (n.nodeType === COMMENT_NODE && n.data === end) return;
    n = n.nextSibling;
  }
  // A finding on the one channel (`FRAME_MARKER_CORRUPTED`) and its console
  // face — the same code the server table reserves for the frames pair, so a
  // consumer sees the client-detected corruption beside the server's
  // findings. No owner locates it (a DOM walk, not a reactive scope); the
  // slot id in the message and `data` is the address.
  DEV.report(
    OBSERVE.diagnostics.emit(
      {
        code: "FRAME_MARKER_CORRUPTED",
        kind: "ssr",
        severity: "error",
        message:
          `[FRAME_MARKER_CORRUPTED] Frame slot range "${id}" is missing its end marker (<!--${end}-->) among its start ` +
          `marker's siblings. Slots after it in this content cannot be discovered. Likely causes: ` +
          `invalid HTML nesting split the range during parsing (e.g. a block element inside <p>), ` +
          `or an HTML-rewriting layer (CDN/minifier/translator) removed or moved the comment — ` +
          `serve frame documents with Cache-Control: no-transform.`,
        data: { slot: id, end }
      },
      null
    )
  );
}

/** Find a `slot:<id>:start` comment among siblings in `[from, bound)`. */
function findRangeStart(from, id, bound) {
  const target = `slot:${id}:start`;
  let n = from;
  while (n && n !== bound) {
    if (n.nodeType === COMMENT_NODE && n.data === target) return n;
    n = n.nextSibling;
  }
  return null;
}

/** Move the range `[start .. slot:<id>:end]` to before `ref` within `parent`. */
function moveRangeBefore(parent, start, id, ref) {
  const end = slotEnd(id);
  let n = start;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    parent.insertBefore(n, ref);
    if (isEnd) break;
    n = next;
  }
}

/** Place a live range — a stashed fragment or an attached start marker —
 *  before `ref` within `parent`. */
function placeRange(parent, range, id, ref) {
  if (range.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE: stashed range */) {
    parent.insertBefore(range, ref);
  } else {
    moveRangeBefore(parent, range, id, ref);
  }
}

/**
 * Move an incoming slot range from the source into `parent` before
 * `ref`, returning the source cursor just past the range's end marker.
 */
function adoptRange(parent, start, id, ref, claim) {
  const end = slotEnd(id);
  let n = start;
  let after = null;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    parent.insertBefore(n, ref);
    // Fresh server-sent placeholder content: claim indiscriminately (the
    // slot mount that later fills the range claims its own output through
    // compiled creation).
    if (claim) claim(n);
    if (isEnd) {
      after = next;
      break;
    }
    n = next;
  }
  return after;
}

/**
 * Reconcile the children of `parent` toward the children of `source`, reusing
 * existing DOM in place. `source` is a freshly parsed, disposable node whose
 * children are moved into `parent` only when they are genuinely new.
 *
 * When `boundStart`/`boundEnd` are given, only the nodes in `(boundStart,
 * boundEnd)` are reconciled and new nodes are inserted before `boundEnd` —
 * this is how a range-boundary frame reconciles between its markers without
 * touching the client content around them.
 *
 * `ranges` (threaded through the whole recursion from the frame's root apply)
 * indexes the frame content's slot ranges by occurrence id as they stood
 * BEFORE this morph. Occurrence ids are unique within a frame's content, so
 * a range the new content places under a different parent (keyed list churn)
 * is still THAT occurrence — the index is what lets the morph relocate it,
 * live interior intact, where sibling-scoped matching sees only a new id.
 */
function reconcileChildren(
  parent,
  source,
  boundStart = null,
  boundEnd = null,
  claim = null,
  ranges = null,
  grafts = null
) {
  let oldChild = boundStart ? boundStart.nextSibling : parent.firstChild;
  let newChild = source.firstChild;

  while (newChild) {
    const nextNew = newChild.nextSibling;
    const pid = slotStartId(newChild);
    // Treat reaching the upper bound as "no more old nodes".
    const old = oldChild === boundEnd ? null : oldChild;

    if (
      old &&
      isTextStart(newChild) &&
      old.nodeType === COMMENT_NODE &&
      old.data === newChild.data
    ) {
      // The same text position: its interior is the client's (the incoming
      // one is empty on the stream face) — keep it and skip both ranges.
      // Any other case reconciles as ordinary nodes; the consumer change
      // that follows rebinds the owner, which writes the new range.
      oldChild = afterText(old);
      newChild = afterText(newChild);
      continue;
    }
    if (pid !== null) {
      if (old && slotStartId(old) === pid) {
        // Same slot already here: preserve its live interior untouched
        // (this is what keeps focus/selection/media alive) and skip both
        // ranges.
        oldChild = afterRange(old, pid);
        newChild = afterRange(newChild, pid);
      } else {
        // Prefer the frame-wide index (relocations from ANY parent — a
        // removal loop may have stashed the range as a fragment); fall back
        // to the sibling scan when reconciling without one.
        const displaced = ranges && ranges.get(pid);
        const existing = displaced || findRangeStart(old, pid, boundEnd);
        if (existing) {
          if (ranges) ranges.delete(pid);
          // Relocate the existing client-owned range into position.
          placeRange(parent, existing, pid, old ?? boundEnd);
          newChild = afterRange(newChild, pid);
        } else {
          // New slot: adopt the server-sent placeholder range as-is.
          newChild = adoptRange(parent, newChild, pid, old ?? boundEnd, claim);
        }
      }
      continue;
    }

    if (!old) {
      parent.insertBefore(newChild, boundEnd);
      if (claim) claim(newChild);
      if (grafts) grafts.push(newChild);
      newChild = nextNew;
      continue;
    }
    if (isSlotMarker(old)) {
      // Old slot anchor: flow new server content in front of it without
      // disturbing the client-owned range.
      parent.insertBefore(newChild, old);
      if (claim) claim(newChild);
      if (grafts) grafts.push(newChild);
      newChild = nextNew;
      continue;
    }
    if (compatible(old, newChild)) {
      morphNode(old, newChild, claim, ranges, grafts);
      oldChild = old.nextSibling;
      newChild = nextNew;
      continue;
    }
    // Incompatible here — but a compatible element may sit further along:
    // content churn between versions (a placeholder where revealed content
    // was) shifts positions, and recreating a later match would destroy the
    // client-owned interiors it carries. Relocate it instead (skipping over
    // slot-range interiors, which belong to the client).
    if (newChild.nodeType === 1) {
      let ahead = old.nextSibling;
      while (ahead && ahead !== boundEnd && !compatible(ahead, newChild)) {
        const aheadPid = slotStartId(ahead);
        ahead = aheadPid !== null ? afterRange(ahead, aheadPid) : ahead.nextSibling;
      }
      if (ahead && ahead !== boundEnd) {
        parent.insertBefore(ahead, old);
        morphNode(ahead, newChild, claim, ranges, grafts);
        newChild = nextNew;
        continue;
      }
    }
    // No match anywhere: place the new node and leave the old one for later
    // matching or removal.
    parent.insertBefore(newChild, old);
    if (claim) claim(newChild);
    if (grafts) grafts.push(newChild);
    newChild = nextNew;
  }

  while (oldChild && oldChild !== boundEnd) {
    const next = oldChild.nextSibling;
    // A leftover range still in the index hasn't been matched YET — its new
    // position may live in a sibling this level hasn't reached, or deeper in
    // a subtree still to morph. Removing it node-by-node would sever the
    // siblings a later relocation walks, so stash the whole range (order
    // intact) into the index instead. A range nobody ends up claiming just
    // stays detached — exactly what removal meant.
    const pid = ranges ? slotStartId(oldChild) : null;
    if (pid !== null && ranges.get(pid) === oldChild) {
      const frag = document.createDocumentFragment();
      const after = stashRange(frag, oldChild, pid);
      ranges.set(pid, frag);
      oldChild = after;
      continue;
    }
    parent.removeChild(oldChild);
    oldChild = next;
  }
}

/**
 * Identity-first grafting (DR-5): a wholesale-inserted source subtree (a
 * new parent with no old counterpart) carries the source's own bare marker
 * pairs for the slot occurrences it contains — but occurrence identity,
 * not position, owns client ranges, so the reconcile records every such
 * subtree root at insertion, and this walk swaps each bare pair whose
 * occurrence still has a live range in the index (attached under a
 * departed old parent, or stashed as a fragment by the removal loop) for
 * that range — interior, and the client state mounted in it, intact.
 * Recording-at-insert is what makes "a live range was detached because its
 * parent didn't match" an unreachable state: every place a live range
 * could be owed is on the list by construction, no full-frame repair scan
 * to miss a case. The swap runs AFTER the reconcile — the range may still
 * be attached at (or after) a sibling cursor mid-walk, and moving it out
 * from under the cursor would corrupt the walk; by flush time every cursor
 * is dead and the removal loop has stashed whatever it reached. Same
 * traversal rules as the index (descend server-owned elements, never range
 * interiors or nested frames — those are child-owned). Index entries no
 * graft site claims just stay detached — exactly what removal meant.
 */
function flushGrafts(node, ranges) {
  if (node.nodeType !== ELEMENT_NODE || isFrameElement(node)) return;
  let n = node.firstChild;
  while (n) {
    const id = slotStartId(n);
    if (id !== null) {
      const next = afterRange(n, id);
      const displaced = ranges.get(id);
      if (displaced) {
        ranges.delete(id);
        placeRange(node, displaced, id, n);
        // Detach the fresh (bare) marker pair the source shipped.
        stashRange(document.createDocumentFragment(), n, id);
      }
      n = next;
      continue;
    }
    flushGrafts(n, ranges);
    n = n.nextSibling;
  }
}

/**
 * Detach the range `[start .. slot:<id>:end]` into `frag` preserving sibling
 * order; returns the node that followed the range's end marker.
 */
function stashRange(frag, start, id) {
  const end = slotEnd(id);
  let n = start;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    frag.appendChild(n);
    if (isEnd) return next;
    n = next;
  }
  return null;
}
