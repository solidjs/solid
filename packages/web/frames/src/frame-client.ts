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
 * One transport chunk of a frame stream, addressed by frame `id`. Any
 * chunk may carry `tiers` (see `TierAnnouncement`).
 * @experimental
 */
export type FrameChunk = (
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
  | {
      /**
       * One server sweep's re-emissions as one unit (RFC 11 addendum, C13):
       * the `hole` / `attr` members a sweep produced, unaddressed (the
       * envelope addresses them), applied as one write — one flush, one
       * `frame:applied`. A sweep that changed one binding is emitted as
       * that member alone.
       */
      type: "ops";
      id: string;
      version: number;
      ops: (
        | { type: "hole"; key: string; html: string; digest?: string }
        | { type: "attr"; key: string; attrs: string; removed?: string[]; digest?: string }
      )[];
    }
  | {
      type: "complete";
      id: string;
      version: number;
      /**
       * Present when the producer ended a plain (non-`live`) response at
       * its streaming bound rather than at its sources' settling (RFC 11
       * addendum): `"yields"` — the later-yield count; `"time"` — the
       * wall-clock bound after the first flush, or the request's abort
       * after it. The content shown is a cut-off, not a settled value;
       * `live()` is the declared way past the bound.
       */
      bound?: "yields" | "time";
    }
  | { type: "error"; id: string; version: number; key?: string; error: unknown }
) &
  TierAnnouncement;

/**
 * The in-band tier announcement (frames savings pass §2; additive — RFC 11
 * addendum): the frames-client tiers the render first needed since the
 * last chunk left — `"bind"`, `"regions"`, `"assets"`, `"trace"`,
 * `"wire"` — on whichever chunk leaves next. The response head carries the
 * tiers minted before it (`X-Frame-Tiers`); a tier minted later rides
 * here. The client starts each named tier's load before applying the
 * chunk; a `data` chunk additionally AWAITS them (its node tree needs the
 * tier to decode). Absent on every chunk of a response that minted nothing
 * after its head, and ignored by a client that predates it.
 * @experimental
 */
export interface TierAnnouncement {
  tiers?: string[];
}

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
   * framework binding hydrates onto it (a claim: zero DOM mutation) or
   * replaces it.
   */
  existing: ChildNode[];
  /**
   * The range's own marker comments, when the occurrence has a placed range
   * — the anchor the fill owns its interior through: bind or place the
   * output before `end` (over `existing`) with the framework's insert
   * primitive. The frame never touches a range's interior itself (server
   * morphs protect slot ranges). Absent for a binding-slot occurrence
   * (`positions`) and for a range whose end marker is missing.
   */
  range?: { start: Comment; end: Comment };
}

/**
 * Client content for a server-declared slot. Direct-insert occurrences
 * call it with empty props; render-prop occurrences pass the occurrence's
 * resolved args (primitives literal, `{$ref}` data resolved through the
 * host, `{$frame}` regions as frame elements). The fill owns its range: it
 * places or binds its output before `ctx.range.end`, over `ctx.existing`
 * (claimed in place on hydration), and disposes it through `ctx.onCleanup`.
 * The return value is not read.
 * @experimental
 */
export type Slot = (props: Record<string, unknown>, ctx: SlotContext) => void;

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
  preview?(records: Record<string, unknown>): void;
  /** Tear down: slot cleanups cascade, later chunks are ignored. Idempotent. */
  dispose(): void;
}

/**
 * Routes a flat stream of addressed chunks to frames by id, buffering chunks
 * for frames that have not registered yet (only the newest version's chunks
 * are kept). `data` chunks are response-scoped and go to `applyData`; a
 * `slot` chunk's `{$ref}` args are resolved at the write, through the
 * response's data (a value, or a pending read the response settles).
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
   * `createServerComponentHandler`): a `slot` chunk's args — settled
   * through its own response's table, as at a write — reach the
   * occurrences mounted under its id as re-resolved props into their live
   * bindings, while the store, the markup, and every structural change
   * wait for the chunk's `apply`. Other chunk types are ignored.
   * @internal
   */
  preview?(chunk: FrameChunk): void;
  /** The first registered frame under the id, if any. */
  get(id: string): Frame | undefined;
  /**
   * The address as an async source: its first landing is the first flush of
   * the first response for it — the root content or its completion; the
   * stream's error is the source ERRORING (frames-rulings 3.3, A0
   * corollary 4 outward: the frame is one async value, and its `:error`
   * is that value rejecting, exactly as any `createAsync` that rejects). A
   * promise resolved at the write that lands it while that response is in
   * flight and REJECTED with the error record at an `:error` write;
   * `undefined` once the address has a landing to show (a later response
   * in flight then morphs over it — the committed value holds), or when
   * nothing has begun for the address. An errored address has no landing
   * to show: a read of it is a promise for the NEXT flight's landing — an
   * errored landing is not a landing for a fresh consumer, and the
   * consumer that reads it re-asks (the integration's `reset`). A mount's
   * covering `<Loading>` pends on this — and on nothing inside the frame —
   * exactly as it pends on any async source's first landing.
   */
  landing(id: string): Promise<void> | undefined;
  serialize(value: unknown): { $ref: string };
  /**
   * See FrameHostOptions.revive. Assignable after creation: the frames
   * client's traces tier installs the container-trace reviver on the
   * shared host when its chunk loads (`@solidjs/web/frames/trace`).
   */
  revive?(value: unknown, claiming?: boolean): unknown;
}

/**
 * Options for `createFrameHost`.
 * @experimental
 */
export interface FrameHostOptions {
  /**
   * Backs `{$ref}` slot args (typically a codec data table's `resolve`).
   * Called at a `slot` chunk's write with the chunk's frame id and version
   * — the RESPONSE the record belongs to (data tables are response-scoped;
   * one response is one version of one id), so the integration answers from
   * that response's table and never a later one's. Answers the key's value,
   * or — for a key the response has not delivered yet — the table's own
   * PENDING READ: a promise marked `s = 0`, carrying `c` (the callbacks run
   * when it settles), that the key's `data` chunk settles (stamped `s`/`v`
   * as it does) and `closeData` rejects (frames-rulings 1.3; the L1 rule —
   * a value that never comes is an error, not a silence). The host counts
   * a record's pending reads so a fresh mount waits for them
   * (`record.pending`) and re-applies the record when the last settles.
   * `current` is the version the id's store is at — every version below it
   * is superseded, and an integration keeping a table per response may
   * drop theirs.
   */
  resolve?(ref: { $ref: string }, frameId: string, version: number, current?: number): unknown;
  /** Test/host-side counterpart of `resolve`. */
  serialize?(value: unknown): { $ref: string };
  /**
   * Receives each `data` chunk whole. Wire a codec table:
   * `applyData: c => table.apply(c)` (see `createJSONDataTable`); a table
   * per response keys on `chunk.version` (see `resolve` for `current`).
   */
  applyData?(chunk: Extract<FrameChunk, { type: "data" }>, current?: number): void;
  /**
   * The response (one version of one id) has ended — its `complete`, or
   * its `error` with no key — and a key it never delivered never comes:
   * the integration closes that response's table so every pending read of
   * it rejects (`table.close(error)`, with the response's error record when
   * it ended by one). Called after the end chunk's own apply, so the frame
   * has the response's last word first.
   */
  closeData?(frameId: string, version: number, error?: unknown): void;
  /**
   * A lazily-loaded deserializer's load, awaited by the transport before it
   * delivers a `data` chunk or a `slot` chunk whose args carry a `{$ref}` —
   * `applyData`/`resolve` can assume the codec is resident when a chunk
   * that reads data arrives. Keeps codec weight out of the eager client
   * graph for responses that never carry serialized data.
   */
  prepareData?(): Promise<unknown>;
  /**
   * Revive protocol markers inside LITERAL slot args (values that are
   * neither `{$ref}` nor `{$frame}`) at arg-resolution time — the mount's
   * read of the record, where an adopted occurrence's claim can read the
   * revived value as the markup was rendered from it. Document-face
   * container traces ride this way — inline in the record, revived by the
   * integration (`reviveContainerTraces`) into live local containers.
   * `claiming` marks the args of an adopt-time mount — the occurrence is
   * about to hydrate server markup rendered from these values (the
   * materializer parks a trace's backlog beyond the snapshot the markup
   * shows until hydration ends — frames-rulings 3.6 (iii)).
   */
  revive?(value: unknown, claiming?: boolean): unknown;
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
   * Boundary-driven segment reveal. `#revealSegment` hands the placeholder
   * seam to this hook: the binding reconstructs a client `<Loading>` there —
   * `fallback` is the placeholder's own template content (shown while
   * holding), `content()` materializes the segment and renders its client
   * fills INSIDE the boundary so their readiness gates the reveal — and
   * inserts it before `before`. An unboundaried async fill suspends up to
   * that boundary and is covered instead of orphaned; one boundary per
   * revealed segment, i.e. per author-placed `<Loading>`. Omitted, the
   * default seam inserts `content()` before `before` at once and removes
   * `before` (the framework-agnostic swap: no boundary, no reactive reveal).
   */
  reveal?(seam: { before: Node; fallback: Node[]; content: () => Node | DocumentFragment }): void;
  /**
   * Adopt path only. Called when a sync leaves an adopted occurrence
   * waiting — for its args record, for a read of it to settle, or for the
   * tier its mount needs to load — while none was before; returns the
   * release, called when a sync leaves none waiting or the frame disposes. The
   * integration registers the hold with whatever counts its page as not
   * yet settled (hydration-done counts it as a pending boundary —
   * frames-rulings 3.1): a claim the frame has not made yet is page work
   * still pending. The record's delivery is the integration's to observe
   * (the document declares it at the marker and settles it — see
   * `adoptBoundary`); the frame only re-syncs on the write.
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
 *   - root HTML apply into a boundary ELEMENT (the frame's range is the
 *     element's children — `createFrame` / `createFrameElement`)
 *   - version as a stale-guard only ("policy A": a newer version morphs in
 *     place; client slots/regions and their state survive — teardown is
 *     dispose(), never a version bump)
 *   - async fragment placeholder ranges + reveal readiness buffering
 *   - a zero-allocation server-owned morph that preserves protected
 *     slot ranges and fragment placeholders
 *   - the slot model: direct-insert and render-function slots as one callback
 *     primitive, iteration by occurrence id, re-call on args change, slot
 *     resolution threaded down through nested frames; the fill OWNS its
 *     range (it places or binds its output before the range's end marker —
 *     the frame discovers ranges and invokes, it never writes an interior)
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
//
// Everything that READS a marker — the entry parser, the consumer
// registration (`positions` / `text`), the owned-position arms of the
// morph (`owned` / `apply`), the per-frame consumer set and rebinder
// (`sync` / `rebinder` / `unmount`) and the fill's binding (`bind`) — is
// the BIND TIER's (`@solidjs/web/frames/bind`, bind-tier.ts; frames savings
// pass §3 row C6), reached through its resident stamp (`tierLoads.bind.r`).
// The eager client keeps the constants, one test — whether a node carries
// a marker at all (`hasSlotMarker`, `isTextStart`) — and the morph's
// text-pair arm (a position's text survives a morph by not being
// reconciled; see `reconcileChildren`). The sync's walk NOTES a marker met
// while the tier is absent (`found.b`) and the frame holds on the note —
// the tier's load started by the readiness check, the install's flush
// re-walking with the tier in place.
/** @internal (the bind tier's own copy — see bind-tier.ts) */
export const SLOT_MARKER = "_s:";
/** @internal (the bind tier's own copy — see bind-tier.ts) */
export const SLOT_TEXT = SLOT_MARKER + "t=";
const SLOT_TEXT_END = "/" + SLOT_MARKER + "t";

const isTextStart = n => n.nodeType === COMMENT_NODE && n.data.startsWith(SLOT_TEXT);

/** Whether an element carries any `_s:*` marker (the detection alone; the
 *  tier parses it). */
function hasSlotMarker(el) {
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) if (attrs[i].name.startsWith(SLOT_MARKER)) return true;
  return false;
}

/**
 * Whether a slot arg value is an async value passed whole (a promise or an
 * async iterable) — DR-2's value tier. The server never resolves these to
 * dead values; the client suspends at the consumption read.
 * @internal (the client entry's and the bind tier's — each its own copy)
 */
export function isAsyncValue(v: any): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    (typeof v.then === "function" || typeof v[Symbol.asyncIterator] === "function")
  );
}

/**
 * A value's shape, as the binding-slot shape findings name it.
 * @internal (dev only; the client entry's and the bind tier's)
 */
export function shapeOf(v: unknown): string {
  return v === null
    ? "null"
    : typeof Node === "function" && v instanceof Node
      ? "a DOM node"
      : Array.isArray(v)
        ? "an array"
        : isAsyncValue(v)
          ? "an async value"
          : typeof v;
}

/**
 * Dev finding (`BINDING_SLOT_POSITION`): the client side of a binding slot
 * has the wrong shape — the fill's return is not an object or the prop is
 * not a function (`fill-shape`), or a text position's value is not a
 * primitive (`text-shape`). Through the diagnostics channel, so an
 * observer captures it beside the server's findings.
 * @internal (dev only; the client entry's and the bind tier's)
 */
export function slotShapeFinding(data: Record<string, string>, message: string) {
  DEV!.report(
    OBSERVE!.diagnostics.emit(
      { code: "BINDING_SLOT_POSITION", kind: "render", severity: "warn", message, data },
      null
    )
  );
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
    case "ops":
      // One sweep's members as one write: the records merge into one map
      // and the frame flushes once over all of them (C13).
      return Object.assign({}, ...chunk.ops.map(chunkToRecords));
    case "complete":
      // `:bound` beside `:complete` — the producer's streaming bound when
      // it cut the response there (`undefined` for a settled one, as
      // `holes` is for a root without them): a consumer can tell a cut-off
      // from a settled value; the frame landed either way.
      return { ":complete": true, ":bound": chunk.bound };
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
 *   resolve?: (ref: { $ref: string }, frameId: string, version: number, current?: number) => unknown,
 *   applyData?: (chunk: object, current?: number) => void,
 *   closeData?: (frameId: string, version: number, error?: unknown) => void,
 *   prepareData?: () => Promise<unknown>,
 *   revive?: (value: unknown, claiming?: boolean) => unknown
 * }} [options]
 *   `serialize`/`resolve` back slot data refs (response-scoped table — a
 *   key not delivered yet answers with the table's pending read);
 *   `applyData` receives each `data` chunk whole — keyed codec records
 *   ({ key, node, initial }, apply via createJSONDataTable) or eval-style
 *   `payload` scripts, depending on the producer's serializer; `closeData`
 *   is told a response ended, so its table rejects what it never
 *   delivered. A host whose deserializer loads lazily exposes the load as
 *   `prepareData`: the transport awaits it before delivering a chunk that
 *   reads data (a `data` chunk, a `slot` chunk carrying a `{$ref}`), so
 *   `applyData` / `resolve` can assume the codec is resident.
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
  // is the MOUNT — a re-sent record updates its live occurrence's props,
  // whose own equality decides what moved — not a merge of two responses in
  // one store). The address is an async SOURCE
  // over it (`landing` below): a response announces itself with `start`
  // and is in flight (`open`) until its first flush lands — the root, the
  // stream's error, or its completion; `shown` is the record set of the
  // latest version that landed — the source's committed value, what a mount
  // opened mid-flight seeds from (holds-latest) — and the same object as
  // `records` once the version in flight has landed. A `shown` holding the
  // `:error` record is the value REJECTED (frames-rulings 3.3): the landing
  // that carried it rejected its awaiters, and `landing` answers a fresh
  // consumer with the next flight's promise instead of a value.
  //
  // A `{$ref}` wait is the response's too (frames-rulings 1.1, 1.3): a slot
  // record's data refs resolve AT THE WRITE, through the integration's table
  // for the chunk's response (`options.resolve(ref, id, version)`), so the
  // record the store holds — and every mount reads — carries values, never
  // refs, and a later response's data can answer none of them. A key the
  // response has not delivered yet resolves to the TABLE's pending read — a
  // promise the table owns (marked `s = 0`; the key lives there, so the
  // wait does too), stamped like a serialized promise once it settles
  // (`s`/`v`, the marks a fill's prop read adopts synchronously): the key's
  // `data` chunk settles it through the table's own `apply`, and the
  // response's end closes the table (`closeData`) so every read it never
  // answered rejects (L1 — a value that never comes surfaces where it is
  // read, instead of leaving the record silently unapplied); a bump drops
  // the superseded response's table with its reads unanswered (their
  // readers re-derive from the new response's record; nothing is left to
  // tell). What the host keeps is the COUNT: a record counts its unsettled
  // reads (`pending`) — a mounted occurrence takes the read as it is (its
  // prop pends and holds the value it shows, A17), while a FRESH mount
  // waits for the record to settle (the frame's `#syncSlots`), so the
  // frame's shell shows at its landing with the range as the server left
  // it, and the mount's covering boundary pends on the landing alone (A0,
  // corollary 4); the last read to settle re-applies the record and the
  // mount runs with values.
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
  // One write's fan-out: every frame mounted under the id applies it.
  const applyTo = (id, version, r) => {
    const set = frames.get(id);
    if (set) for (const frame of set) frame.apply({ version, r });
  };
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
  /**
   * Settle the record's `{$ref}` args into client values through the
   * response's table (or its pending read for a key not delivered yet).
   * The record notes what it found so the frames never probe a value again
   * (a decoded value may be a live container, whose property reads throw
   * not-ready while pending): `decoded` names the args that came through
   * the table — the frame passes those through untouched — and `regions`
   * the `{$frame}` args (arg name -> the region's wire id), which are
   * addressing, not data. A literal stays as written: it is revived at the
   * mount (`revive`), where a claim can read it as the markup was rendered
   * from it.
   *
   * A pending read (the table's promise, marked `s = 0` — a delivered value
   * that is itself a promise, an async arg passed whole, carries no mark
   * and is taken as the value it is) is counted on the record (`pending`),
   * and the last of them to settle — the key delivered, or the response
   * closed — re-applies the record to the frames (`settle`, pushed on the
   * read's `c` and run by the table in the `apply` / `close` that settles
   * it — not the promise's `then`, which a delivered promise value would
   * defer to ITS settle), so a fresh mount that waited for it runs with
   * values (or throws the rejection where it reads, L1). Re-applied only
   * if the record is still the one the store holds: a bump replaced it
   * (the read belongs to a superseded response), a re-sent record under
   * the same version superseded it, or it was a staged refetch's PREVIEW
   * (never the store's — the commit's own write re-settles it).
   */
  const settleArgs = (store, recordKey, record, chunk) => {
    const args = record.args;
    const out = {};
    let regions, decoded;
    const settle = () => {
      if (!--record.pending && store.records[recordKey] === record)
        applyTo(chunk.id, store.version, { [recordKey]: record });
    };
    for (const key in args) {
      const value = args[key];
      if (value && typeof value.$ref === "string") {
        const resolved = (out[key] =
          options.resolve && options.resolve(value, chunk.id, chunk.version, store.version));
        (decoded ??= {})[key] = true;
        // `instanceof` before the mark: a decoded value may be a live
        // container, whose property reads throw not-ready while pending —
        // `instanceof` is a prototype walk, no property read.
        if (resolved instanceof Promise && resolved.s === 0) {
          record.pending = (record.pending || 0) + 1;
          resolved.c.push(settle);
        }
      } else {
        if (value && typeof value.$frame === "string") (regions ??= {})[key] = value.$frame;
        out[key] = value;
      }
    }
    record.args = out;
    record.regions = regions;
    record.decoded = decoded;
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
      // Data payloads are response-scoped: they go to the data hook, not
      // the store — but under the store's version guard like every other
      // chunk (frames-rulings 1.2): a `data` chunk of a response the
      // address has moved past lands nowhere, never in the table that is
      // now the current response's (the transport restamps every chunk
      // with its response's version; the integration rotates the table at
      // the header and creates it at first use, so the first use must be
      // the current response's). A record waiting on the chunk's key is
      // answered by the table's own apply (see `settleArgs`).
      if (chunk.type === "data") {
        const store = stores.get(chunk.id);
        const current = store && store.version;
        // (`n < undefined` is false: a store with no version yet, or a chunk
        // with none, guards nothing.)
        if (store && chunk.version < current) return;
        options.applyData && options.applyData(chunk, current);
        return;
      }
      // Write through to the resident store first: the store version-guards
      // once for all mounts, and an unmounted address simply warms.
      const records = chunkToRecords(chunk);
      const store = storeFor(chunk.id);
      if (!write(store, chunk.version, records)) return;
      // The record's refs resolve through ITS response's data — the table
      // current for the version the write just made the store's.
      if (chunk.type === "slot") {
        const key = `slot:${chunk.key}`;
        settleArgs(store, key, records[key], chunk);
      }
      // The producer cut a plain response at its streaming bound: what the
      // address shows is a cut-off, not a settled value. `live()` is the
      // declared way past the bound; say so once per response, in dev.
      if ("_SOLID_DEV_" && chunk.type === "complete" && chunk.bound) {
        console.warn(
          `Server component "${chunk.id}" kept streaming past the server's ${chunk.bound} ` +
            `bound and was cut off (complete.bound: "${chunk.bound}"); its content is the last ` +
            `value the server sent, not a settled one. A source meant to keep streaming is ` +
            `declared with live(): wrap the server function (live(fn)) so the client holds a ` +
            `standing connection instead.`
        );
      }
      let r = records;
      // The address as a source: `start` opens a flight; the write that
      // lands it makes the version the one SHOWN and answers whoever awaited
      // the landing — before the frames apply, so a mount gating on it reads
      // the content in the beat its frame shows it. The landing fans out as
      // the version's WHOLE record set: a mount opened mid-flight seeded the
      // committed value and has none of this version's earlier writes (a
      // frame already at the version re-receives the same records — a
      // no-op). A document-adopted store never opens: its content is page
      // markup, written by no `start`. An `:error` write is the source
      // REJECTING (frames-rulings 3.3): whoever awaited the landing sees the
      // error — the mount's content node throws it to the nearest client
      // `<Errored>` — and the address shows no landing until a later flight
      // lands one (`landing` below). The `complete` that follows an errored
      // response's `error` settles nothing: the error already did, and a
      // promise minted since is the next flight's.
      if (chunk.type === "start") store.open = true;
      else if (lands(records)) {
        store.open = false;
        store.shown = r = store.records;
        store.shownVersion = chunk.version;
        const landed = landings.get(chunk.id);
        if (landed && !(":complete" in records && ":error" in r)) {
          landings.delete(chunk.id);
          ":error" in records ? landed.j(records[":error"]) : landed.r();
        }
      }
      applyTo(chunk.id, chunk.version, r);
      // The response's end: a key it never delivered never comes, and every
      // read waiting on one fails where it is read (L1) — the integration
      // closes the response's table, a mount that waited for the record
      // runs and its read throws. After the end chunk's own apply, so the
      // frame has the response's last word first.
      if (":complete" in records || ":error" in records)
        options.closeData && options.closeData(chunk.id, chunk.version, records[":error"]);
    },
    landing(id) {
      const store = stores.get(id);
      // Nothing to wait for: nothing has begun for the address, or it has a
      // landing to show already — the committed value a mount reads
      // (holds-latest) while a later response is in flight. An ERRORED
      // landing is not one (frames-rulings 3.3): the value rejected, and a
      // fresh consumer of it awaits the next flight's landing instead — the
      // promise is minted here, for the flight the consumer's re-ask opens.
      if (!store || (!store.open && !store.shown)) return undefined;
      if (store.shown && !(":error" in store.shown)) return undefined;
      let wait = landings.get(id);
      if (!wait) {
        landings.set(id, (wait = {}));
        wait.p = new Promise((r, j) => ((wait.r = r), (wait.j = j)));
      }
      return wait.p;
    },
    preview(chunk) {
      if (chunk.type !== "slot") return;
      const set = frames.get(chunk.id);
      if (!set) return;
      const records = chunkToRecords(chunk);
      const key = `slot:${chunk.key}`;
      // Through the STAGED response's table (its version's): a key it has
      // not delivered is that table's pending read — never the shown
      // response's — and this record is never the store's, so its settle
      // re-applies nothing; the committed write's own settle does.
      settleArgs(storeFor(chunk.id), key, records[key], chunk);
      for (const frame of set) frame.preview && frame.preview(records);
    },
    get(id) {
      const set = frames.get(id);
      return set && set.values().next().value;
    },
    serialize(value) {
      if (!options.serialize) throw new Error("host has no serializer");
      return options.serialize(value);
    },
    revive: options.revive,
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

// === Tiers (frames savings pass §2: the server-announced tier mechanism) ===
//
// A TIER is a named slice of the frames client's capability that may live
// in its own chunk and load on demand: `bind` (binding-slot positions),
// `regions` (nested server-content regions), `assets`, `trace` (container
// traces), `wire` (the live loop). The server knows at render time which
// of them a response or a document needs — it mints the feature — and
// ANNOUNCES the names (`X-Frame-Tiers` on a stream, `_$HY.r["sc:tiers"]`
// plus `modulepreload` links on a document, `chunk.tiers` in-band), so the
// client starts the import in parallel with the content instead of at the
// first use. The announcement is a warm start, never a dependency: a
// readiness check that finds a tier absent starts the load itself and
// holds, so an un-announced response converges to the same DOM.
//
// `tierLoaders` is the seam a tier plugs into: `name -> () => import(...)`,
// the module whose exports are the tier's APPLIERS — the functions this
// runtime dispatches to once the module is resident (off the load's `r`
// stamp, see `tierLoads`) — and whose optional `install()` writes whatever
// state lives elsewhere (the traces tier sets the shared host's `revive`
// and the plugin's materializer). The built-in table (the frames client
// entry, client.ts) carries the tiers that have been cut — `trace`, the
// container tier's client half (plan step C3); `regions`, nested
// server-content regions (C4); `assets`, the head mirror and the
// stylesheet gate (C5); `bind`, binding-slot positions (C6) — and
// `installServerComponents({ tiers })` adds or replaces entries; a name
// with no loader is eager and resident by definition (`wire` today).
/**
 * A frames-client tier's module, as its loader resolves it: its exports are
 * the tier's appliers — the functions the runtime dispatches to once the
 * module is resident (the regions tier's `resolve` / `bind` / …, the assets
 * tier's `gate` / `apply`) — and the optional `install()` runs once at the
 * load, for state that lives outside the runtime's dispatch (the traces
 * tier sets the shared host's `revive`). The index signature is what lets a
 * module with no `install` — a module whose exports are all appliers — be
 * one (TypeScript's weak-type rule would otherwise reject it).
 * @experimental
 */
export interface TierModule {
  install?(): void;
  [applier: string]: unknown;
}
export const tierLoaders: Record<string, () => Promise<TierModule>> = {};
// `name -> the load`, a promise stamped `r` with the MODULE once it has
// installed (truthy = resident): the dispatch table. A frame reaches a
// tier's appliers through the stamp — `tierLoads.regions?.r.bind(...)`,
// `tierReady("assets").gate(...)` — with no registration step; absent until
// the load installs, so every read is conditional on residency — and the
// readiness checks (`tierReady`) guarantee a record that NEEDS a tier never
// reaches an applier before it is here. One per name for the page's
// lifetime: tiers never uninstall. Exported for the tier specs alone (a
// test re-arms a tier's hold by deleting its load; the dist's entry never
// re-exports it).
/** @internal */
export const tierLoads: Record<string, Promise<void> & { r?: any }> = {};
// Every live frame, so an install can wake them all: a frame whose sync
// held an occurrence on the tier re-syncs and mounts it; the rest see a
// no-op flush.
const liveFrames = new Set();

/**
 * Start (or join) a tier's load. Idempotent per name; a name with no loader
 * is resident already and resolves at once. Resolves once the module has
 * installed and every live frame has been flushed.
 * @internal The frames client's own seam (the announcement reads call it).
 */
export function prepareTier(name: string): Promise<void> & { r?: any };

export function prepareTier(name) {
  let load = tierLoads[name];
  if (!load) {
    const loader = tierLoaders[name];
    tierLoads[name] = load = loader
      ? loader().then(module => {
          // The install: the module is the resident stamp (its exports are
          // the tier's appliers — the dispatch for a tier that has them), its
          // `install` hook writes any state that lives elsewhere, then one
          // flush per live frame — the write is empty, so a frame re-walks
          // what it holds and applies what the tier now makes applicable
          // (the held occurrence mounts and its hold releases; a buffered
          // record applies; a style-gated segment's sheets are requested). A
          // frame with no version yet keeps none.
          load.r = module;
          module.install?.();
          for (const frame of liveFrames) frame.apply({ version: frame.version, r: {} });
        })
      : Promise.resolve();
  }
  return load;
}

/**
 * Whether a tier's code is resident — eager (no loader: `true`), or
 * installed (its module). A tier that is neither has its load started here
 * (the un-announced fallback: detection at the readiness check), and the
 * caller holds. A tier dispatched off the stamp (`assets`) needs its loader
 * wired — the client entry does; a spec driving this module directly wires
 * and warms it (see frames-assets-client.spec).
 */
const tierReady = name => !tierLoaders[name] || prepareTier(name).r;

// The regions tier's reason to wait (frames savings pass §1, "regions"; §3
// row C4): a record naming a `{$frame}` region — the host noted the args
// that are addressing (`record.regions`, see `settleArgs`) — while the
// tier that resolves it to a region element and binds a frame over it is
// absent. One test, on the note the host already made (no arg walk). A
// fresh mount waits in the held set (adopt path: the hold registers under
// frames-rulings 3.1, the server interior stays on screen); a MOUNTED
// occurrence's new record stays pending in the store — the live binding
// keeps showing the previous args — until the install's flush re-syncs.
// Either way the check starts the load (`tierReady`): the un-announced
// fallback.
const needsRegions = record => record.regions && !tierReady("regions");

// The traces tier's reason to hold (frames savings pass §1, "traces"): a
// container-trace marker — `{ $tr, $ta }`, the eval face's literal for a
// trace (frame-container-plugin.js) — somewhere in a record's args while
// the tier that materializes it is absent. The marker can sit at any depth
// of an argument (`{ filters: { user: proj } }` is one arg), so the test is
// a walk; it runs ONLY while the tier is not resident — once it is, a
// decoded arg may already be a live container, whose property traps throw
// not-ready on a pending one, and nothing can be a marker any more (the
// codec materializes at decode, the revive walk at the mount). Before the
// tier is resident no live container can exist (only the tier's install
// makes one), so the walk is trap-safe. A record whose literal args carry
// a marker found while the tier is absent starts the load (`tierReady`)
// and holds the occurrence: its server interior stays on screen, the
// frame's hold registers (3.1), the install's flush mounts it.
const carriesTrace = value =>
  value != null &&
  typeof value === "object" &&
  (value.$tr != null || Object.values(value).some(carriesTrace));
const needsTrace = args => !tierLoads.trace?.r && carriesTrace(args) && !tierReady("trace");

class FrameImpl {
  // A frame renders INTO an element: the boundary / region element is the
  // range (its children are the content), so it moves with the element and
  // needs no markers of its own.
  #element;
  #options;
  // The frame this one is a region OF (`options.parent`, set by the regions
  // tier at bind): slot callbacks, records and record removal thread up
  // this link (`#resolveSlot` …). (`#parent` is the DOM parent, below.)
  #outer;
  #version;
  #store = Object.create(null);
  // The applied state is keyed by RECORD identity (frames-rulings 2.1,
  // 2.2): the root record this mount morphed, the error record it notified.
  // A new record under the same version applies again; the version bump
  // and the rebind reset both (`#resetStreamState`), so a byte-identical
  // root under a new version applies as the new version's.
  #appliedRoot;
  #appliedError;
  #hasContent = false;
  // The rest of the applied state, one map: store key -> the record this
  // MOUNT applied under it — a segment's content record at its reveal, a
  // fallback gate at its materialization, a live hole's range morph, an
  // attr patch, a hole error's diagnostic. Per mount, not per store — a
  // fresh mount seeding from a warm resident store must replay hole
  // records over the re-materialized shell and reveal the segments the
  // store already holds. Whether a segment is SHOWN is otherwise the DOM's
  // to say (frames-rulings 2.4: its placeholder is gone once it swapped),
  // so no second ledger of revealed names exists beside this.
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
  // No region state here: a frame's nested server-content regions — the
  // `{$frame}` args' elements and the frames bound over them — are the
  // REGIONS TIER's (`@solidjs/web/frames/regions`, plan C4), kept by that
  // module per frame and reached through its resident stamp
  // (`tierLoads.regions.r`).
  // Nor data-occurrence state (§9.2.3): the consumer set last handed to a
  // mount and the mount's rebind callback (`ctx.onRebind`) are the BIND
  // TIER's (`@solidjs/web/frames/bind`, plan C6), kept by that module per
  // frame (`sync` / `rebinder` / `unmount` off `tierLoads.bind.r`).
  // Nor the mounts' output: the fill owns its range (it places or binds
  // before the end marker through `ctx.range`), and nothing reads the
  // nodes back — "mounted" is `#mountedSlots`, not a check on them.
  // The release of the frame's hold with the integration while a sync
  // leaves an occurrence waiting to mount (see #syncSlots' end).
  #hold;
  // Adopt path: the record an unmounted occurrence was first HELD with (for
  // its tier, for its record's reads — see #syncSlots). The adopted range's
  // server interior was rendered from that record; should the store move on
  // while it waits (a refetch, a rebind), the mount still claims with it
  // and the current record applies as the args change it is
  // (frames-rulings 3.6: a claim reads what the markup was rendered from).
  #heldRecords = new Map();
  #disposed = false;

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

  constructor(element, options = {}) {
    this.#element = element;
    this.#options = options;
    this.#slots = options.slots;
    this.#outer = options.parent;
    // Enumerable for a tier's install (see `prepareTier`), until disposal.
    liveFrames.add(this);
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

  /** Server content landed: caller hook + the bubbling document notification. */
  #applied(version, reason) {
    this.#options.onApply?.({ version, reason });
    const parent = this.#element;
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

  get version() {
    return this.#version;
  }

  get store() {
    return this.#store;
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
      // preserves occurrence state is the mount itself — a re-sent record
      // updates the live occurrence's props, never re-calls it — not a
      // merge of two responses.
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
   * delivered the content — so the args are staged with that transaction
   * and the fills' derivations re-derive in the pass that commits it, never
   * a flush behind it (principles §9.2.2). Nothing else moves: the store,
   * the markup, mounts, re-calls and unmounts all wait for the apply. Args
   * that add or rename a region are structural too — those occurrences
   * wait. Records reach the regions below that inherit them (their own
   * store does not shadow the key). Whether a pushed value CHANGED is the
   * props' own equality (the binding's per-prop memo), as for any write.
   *
   * An adopted record is also written to the store that owns it — this
   * frame's, for regions below too — so a flush before the apply (the
   * apply's own first chunks, which precede the slot records) finds the
   * occurrence's record adopted instead of pushing the old args back. A
   * record nothing adopted stays out of the store: an early flush would
   * apply it against the old markup.
   */
  preview(records, inherited?) {
    const adopted = new Set<string>();
    if (this.#disposed) return adopted;
    const R = tierLoads.regions?.r;
    for (const key in records) {
      const record = records[key];
      if (!record || record.kind !== "slot" || !key.startsWith("slot:")) continue;
      if (inherited && key in this.#store) continue;
      const occurrence = key.slice(5);
      const update = this.#mountedSlots.has(occurrence) && this.#slotUpdaters.get(occurrence);
      // A record that adds a region to the occurrence or renames one of its
      // regions is not previewed (its chunks ride the new name, so the
      // rename lands with them at the commit) — the regions tier reads its
      // cache for that; with the tier absent no region can exist yet, so
      // any region the record names is an addition.
      if (!update || (R ? R.changed(this, occurrence, record) : record.regions)) continue;
      this.#slotArgs.set(occurrence, record);
      adopted.add(key);
      update(this.#resolveArgs(occurrence, record));
    }
    if (R)
      for (const frame of R.frames(this))
        for (const key of frame.preview(records, true)) adopted.add(key);
    if (!inherited) for (const key of adopted) this.#store[key] = records[key];
    return adopted;
  }

  /**
   * The applied state is one version's (frames-rulings 2.1): the version
   * bump and the rebind replace it wholesale — the store (every record of
   * the previous response), the root the morph applied (so a byte-identical
   * root under the new version applies as the new version's — 2.2), the
   * error it notified, the applied map (segments revealed, fallbacks shown,
   * holes, asset records). Nothing applied under the previous version is
   * consulted under the next; the DOM keeps showing what it showed until
   * the new version's writes morph it.
   */
  #resetStreamState() {
    this.#store = Object.create(null);
    this.#appliedRoot = this.#appliedError = undefined;
    this.#appliedHoles.clear();
  }

  #flush() {
    if (this.#disposed) return;
    const version = this.#version;

    const root = this.#store[""];
    if (root && root.kind === "html" && root !== this.#appliedRoot) {
      const reason = this.#hasContent ? "morph" : "materialize";
      this.#applyRoot(root.value);
      this.#appliedRoot = root;
      // The root resets the ledger: everything shown is now this root.
      this.#have = root.digest === undefined ? undefined : { "": root.digest, ...root.holes };
      this.#applied(version, reason);
    }

    // An error record is an APPLY too: a consumer gating on first apply (a
    // mount holding its covering boundary open until the frame has content)
    // must release on a failed stream — surfacing the error state beats
    // holding a fallback forever. Once per error record: later flushes
    // (data, complete) find it applied, and a new version's reset clears it.
    const error = this.#store[":error"];
    if (error && error !== this.#appliedError) {
      this.#appliedError = error;
      this.#applied(version, "error");
    }

    // Asset records (`seg:<k>:assets`, the root's `seg::assets`): module
    // and typed preloads, inline styles — through the ASSETS TIER
    // (`@solidjs/web/frames/assets`, plan step C5), once per record identity
    // per mount (the applied map — root asset records reuse one key, so the
    // record is the unit; a fresh mount seeding from a warm store replays
    // them). Before the segments, so a segment's inline styles precede its
    // content in the head as the document face orders them. Stylesheets
    // are the reveal gate's (#segmentReady), never applied here. A record
    // met while the tier is absent starts its load (`tierReady`) and stays
    // pending — the install's flush applies it; the walk stops there (the
    // rest wait on the same load).
    for (const key in this.#store) {
      const record = this.#store[key];
      if (!key.endsWith(":assets") || !record || this.#appliedHoles.get(key) === record) continue;
      const tier = tierReady("assets");
      if (!tier) break;
      this.#appliedHoles.set(key, record);
      tier.apply(record);
    }

    // Segments: every content record the store holds whose placeholder is
    // in the frame's range reveals; a revealed segment's own range is
    // applied as it is revealed (nested segments included — see
    // #revealSegments), so one pass over the frame suffices.
    this.#revealSegments();

    // Live-hole records, one pass: range morphs (`hole:`), element attr
    // patches (`attr:`), and hole-keyed error diagnostics. After the
    // segment loop, so a hole inside a segment revealed THIS flush is
    // findable now; a record whose target isn't in the DOM yet simply
    // stays pending — any later flush retries, store-model style. Dedupe
    // is by record identity (every chunk mints a fresh record; a fresh
    // mount's empty map replays the warm store). A hole error is terminal
    // server-side — the range latched at its last markup, and unlike a
    // rejected arg ref there is no client read to throw into, so it
    // surfaces as a one-time diagnostic. The pass is announced ONCE after
    // every applicable record landed (C13: one write is one frame — a
    // sweep's `ops` unit arrives as one write, and a listener on
    // `frame:applied` must never read the DOM with one of its holes moved
    // and a sibling still showing the previous value).
    let morphed = false;
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
          morphed = true;
        }
      } else if (key.startsWith("attr:")) {
        if (this.#applyAttrs(key.slice(5), record.value, record.removed)) {
          this.#appliedHoles.set(key, record);
          this.#recordHave("lha:" + key.slice(5), record);
          morphed = true;
        }
      }
    }
    if (morphed) this.#applied(version, "morph");

    this.#syncSlots();
  }

  /**
   * Resolve a slot callback by prop: this frame's slots, then ancestors'.
   * A nested region frame carries its parent (`options.parent`, set by the
   * regions tier when it binds the region — frame-internal, not a public
   * option), and the three thread-ups below walk that link: private
   * access across instances of this class, so the chain costs no closure
   * per region. (`#outer && #outer.#x()`, not `parent?.#x()` — TypeScript
   * rejects a private name in an optional chain, TS18030.)
   */
  #resolveSlot(prop) {
    return this.#slots?.[prop] ?? (this.#outer && this.#outer.#resolveSlot(prop));
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
    return this.#outer && this.#outer.#resolveSlotRecord(occurrence);
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
    } else this.#outer && this.#outer.#removeSlotRecord(occurrence);
  }

  // `root`, when given, scopes discovery to a detached fragment instead of the
  // frame's live content: a boundary-driven reveal renders a segment's fills
  // INSIDE the reconstructed `<Loading>` (so their readiness gates the reveal),
  // then the filled fragment is committed. Those occurrences mount here and are
  // skipped by the next full sync; the unmount sweep is full-frame-only (a
  // scoped fill only ADDS occurrences, never removes the frame's others).
  #syncSlots(root) {
    if (!this.#slots && !this.#outer) return;

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
    const found: Map<any, any> & { b?: boolean } = new Map();
    if (root) collectSlots(root.firstChild, null, found, found);
    else this.#collectSlots(found, found);
    // Whether this sync leaves an occurrence WAITING to mount — for its
    // record, for a `{$ref}`'s data: a claim the frame owes the page and has
    // not made yet (see the hold at the end).
    let waiting = false;
    // The regions and bind tiers' appliers, if resident (an install cannot
    // land mid-sync: it is a load's continuation). Absent, nothing in this
    // sync can need them — a record naming a region waits (`needsRegions`);
    // a marker met with the bind tier absent is a NOTE on the found map
    // (`found.b`, no consumer entry — see `collectSlots`) and the sync
    // holds on it below, so `B` is resident wherever `consumers` exist.
    const R = tierLoads.regions?.r;
    const B = tierLoads.bind?.r;

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
      // A mounted occurrence is one this frame invoked and has not unmounted;
      // the morph never destroys a mount's output (identity-first matching
      // relocates a range among siblings and recreates nothing — DR-5), so
      // "mounted" is the set, not a check on the nodes.
      const mounted = this.#mountedSlots.has(occurrence);
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
      // The document face delivers its records as writes too: the producer
      // DECLARES each record at the marker (a pending value under its key,
      // settled with the args — as a fragment's `<key>_fr`), and the
      // adopting integration applies it when it settles, so a record that
      // trails the reveal is a write the frame sees, not a plain assignment
      // it would have to poll for. A called occurrence still recordless on
      // a stream once nothing can deliver its record is the protocol's
      // invariant broken (a record dropped, or marker and record minted
      // under different ids), never something the fill can fix; dev names
      // it there (the document's declaration may still settle).
      if (record === undefined && isCalled(occurrence)) {
        waiting ||= !mounted;
        if ("_SOLID_DEV_" && consumers && !mounted && !this.#options.adopt)
          devSlotOrphan(this, occurrence, consumers, "record");
        continue;
      }
      // A record's args are client values by the time it is here: the host
      // settled its `{$ref}`s at the write — a delivered value, or the
      // table's pending read its `data` chunk settles (`record.pending`
      // counts those still open). A MOUNTED occurrence takes the read as it
      // is: its prop pends and holds what it shows until the value lands
      // (DR-2's value tier, the path a promise passed whole takes). A fresh
      // mount waits for the record to settle — the host re-applies it then
      // — so the frame's
      // shell shows at its landing with the range as the server left it,
      // instead of a fill whose first read pends into the mount's covering
      // boundary (which would hold the frame's own address follow behind
      // the fallback). A read the response never answers settles rejected
      // at its end: the mount runs then and the read throws (L1).
      //
      // A fresh mount also waits for the TIER its occurrence needs (frames
      // savings pass §2 — the server-announced tier mechanism): a called
      // occurrence whose record names a region needs `regions`
      // (`needsRegions` — the host's note of the `{$frame}` args), one
      // whose literal args carry a container-trace marker needs `trace`
      // (`needsTrace` — the marker walk, run only while that tier is
      // absent). Resident tiers cost one test; an absent one has its load
      // started by the check (`tierReady`) and the occurrence stays as the
      // server left it — its interior on screen — until the install's
      // flush re-syncs. (A data occurrence's own tier, `bind`, is waited
      // for at the walk: absent, no consumer entry reaches this loop — see
      // the note after it.) On the adopt path this wait is one more reason
      // in the frame's registered hold (3.1): hydration-done waits. The
      // hold does NOT keep the delegated-event replay window open for the
      // page's elements — replay is keyed on each `_hk` element's
      // completion, which the root pass grants long before the hold lifts;
      // an event-slot consumer's window is its own `_hk` stamp, completed
      // by the bind tier at the bind (see bind-tier.ts).
      if (
        !mounted &&
        record &&
        (record.pending || needsRegions(record) || needsTrace(record.args))
      ) {
        waiting = true;
        // Remember what the adopted interior was rendered from. A hold is
        // the t=0 mount deferred: when it lifts, the mount must do what t=0
        // would have — claim with THIS record — even if a later write has
        // since replaced it in the store (the mount below falls through to
        // the args-change path for the replacement). A claim with the
        // replacement's args instead would trust markup rendered from the
        // old ones and leave every differing text hole stale: a claim pass
        // never rewrites text (frames-rulings 3.6).
        // A data occurrence mounts with the CURRENT record instead: its
        // positions are written whole at the bind (the fill's object over
        // the server's values — never claimed), so the latest args are the
        // right ones and the held/current two-step would write twice.
        if (this.#options.adopt && !consumers)
          this.#heldRecords.has(occurrence) || this.#heldRecords.set(occurrence, record);
        continue;
      }
      if (!mounted) {
        // Direct-insert occurrences have no `slot:<id>` record and mount with
        // empty props; render-function occurrences mount with resolved props.
        // The fill owns the range interior (`ctx.range`, `ctx.existing`): on
        // a fresh stream it is empty, but an adopted document-SSR range
        // already holds the server-rendered client content — the fill
        // claims it in place (hydration attach; the DOM is untouched) or
        // replaces it (client render).
        // In an adopt frame, a MOUNT is the hydration attach — whether the
        // constructor sync or a registration-flush drain (t=0 records
        // buffered before adoption) triggered it. ctx.adopted lets
        // consumers claim server-rendered DOM exactly then; stream re-calls
        // (the mounted branch below) must render for real or replaced
        // content is silently dropped (#547). Occurrences a post-boot
        // stream introduces mount with EMPTY interiors (the producer ships
        // bare marker pairs), so consumers' existing-content gate already
        // excludes them from claiming.
        // Regions (the regions tier, through #resolveArgs): on the adopt
        // path the record's `{$frame}` args resolve to the region ELEMENTS
        // already rendered in the interior — the tier discovers them before
        // the fill runs, claim wiring, not identity recovery (A5) — so the
        // wrapper is handed the adopted node instead of an empty one; a
        // fresh mount has no interior regions yet and the tier mints its
        // elements during the invoke.
        // A held occurrence mounts with the record it was held on (see the
        // hold above); a current record that differs applies right after,
        // through the mounted path below.
        const held = this.#heldRecords.get(occurrence);
        this.#heldRecords.delete(occurrence);
        const mountRecord = held || record;
        this.#invokeSlot(occurrence, callback, mountRecord, start, this.#options.adopt);
        // A data occurrence's consumer set is handed to the tier (`sync`),
        // which keeps it per frame for the rebind below.
        if (consumers) B.sync(this, occurrence, consumers);
        this.#mountedSlots.add(occurrence);
        // Bind the occurrence's regions (the tier): a frame over each region
        // element #resolveArgs minted or — on the adopt path — discovered in
        // the interior before the fill ran.
        R?.bind(this, occurrence);
        if (mountRecord === record || !record || record.kind !== "slot") continue;
      }
      // A mounted data occurrence whose CONSUMERS changed — a morph replaced
      // one of its elements, a response added or dropped a bound position
      // — rebinds in place: the fill's computation stays, the binding gets
      // the new set. The tier compares against the set it keeps and calls
      // the mount's rebinder. Independent of an args change, which follows.
      if (consumers) B.sync(this, occurrence, consumers);
      if (record !== this.#slotArgs.get(occurrence)) {
        // A new record that names a region while the regions tier is absent
        // (a refetch adding a `{$frame}` arg to a mounted occurrence — the
        // response announced the tier, its load is in flight) is NOT taken:
        // it stays pending in the store, the live binding keeps the args it
        // shows, and the install's flush re-syncs to here with the tier in
        // place. The check starts the load when nothing announced it. (A
        // mounted occurrence reaching here has a record: a called one
        // without left above, a bare one's is `undefined` on both sides.)
        // The same wait for the TRACES tier: a new record whose literal
        // args carry a `{ $tr }` marker while that tier is absent — a live
        // slot op minting the page's first trace after the shell, a refetch
        // adding a projection arg — would otherwise be pushed into the live
        // binding raw (the marker read as the value). `needsTrace` guards
        // the fresh mount above; this is its update-site twin.
        if (needsRegions(record) || needsTrace(record.args)) continue;
        // A re-sent record, live binding (the mount registered
        // ctx.onUpdate): push the re-resolved props into the LIVE
        // occurrence instead of re-calling — the consumer's reactive props
        // update in place, so client state on the occurrence (expansion,
        // focus, animation) follows the entity across morphs. Whether a
        // value CHANGED is the props' own equality (the binding's per-prop
        // memo compares the resolved values — a re-sent record whose refs
        // decode to equal values churns nothing), not the frame's: the
        // frame records delivery, the reader decides. #resolveArgs
        // reuses/renames the cached regions, so `{$frame}` args keep their
        // live elements and this stream's region chunks reach them.
        const update = this.#slotUpdaters.get(occurrence);
        if (update) {
          // One record shape (A5): every transport's record carries ALL of
          // the occurrence's region args as `{$frame}` refs, so the resolved
          // props are complete — a key the record omits really was removed.
          const props = this.#resolveArgs(occurrence, record);
          this.#slotArgs.set(occurrence, record);
          update(props);
          R?.bind(this, occurrence);
          continue;
        }
        // Args changed (incl. late args): re-call this occurrence only,
        // reusing its cached server-content regions; the fill replaces its
        // previous output (`ctx.existing`) over the same range.
        this.#invokeSlot(occurrence, callback, record, start);
        R?.bind(this, occurrence);
      }
    }

    // The bind tier's wait (frames savings pass §1, "bind"; §3 row C6): the
    // walk met a `_s:*` marker — an element's or a text position's — while
    // the tier that parses it is absent, and noted it (`found.b`) without
    // registering an occurrence. The data occurrences stay as the server
    // left them — positions at the server's values, handlers inert, their
    // events queued behind each consumer's own `_hk` stamp — and the frame
    // waits: the check starts the load (the un-announced fallback;
    // announced, it is already in flight), the install's flush re-syncs
    // with the tier in place and the loop above mounts them.
    if (found.b && !tierReady("bind")) waiting = true;

    // Unmount occurrences whose range has disappeared from the server content
    // — full-frame syncs only; a scoped fragment fill never removes siblings.
    if (!root) {
      for (const occurrence of [...this.#mountedSlots]) {
        if (!found.has(occurrence)) this.#unmountSlot(occurrence);
      }
      // The frame's hold (frames-rulings 3.2): ONE registration with the
      // integration while a sync leaves an occurrence waiting to mount —
      // for its record, for the record's reads to settle, or for its tier
      // — released by the first sync that leaves none, or by disposal. The
      // waits are bounded as a `<Loading>` resume's is: the record by its
      // declared value settling, the read by the stream's
      // `complete`/`:error`, the tier by its load settling.
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
   * framework binding can hydrate onto it, `ctx.range` the markers it
   * places or binds its output within. The frame never writes an interior.
   */
  #invokeSlot(occurrence, callback, record, start, adopted) {
    // A (re-)call replaces the occurrence's binding wholesale: drop the old
    // binding's updater so a stream args-change can't push props into a
    // disposed instance. The new invocation re-registers if it wants updates.
    this.#slotUpdaters.delete(occurrence);
    const cleanups = this.#slotCleanups.get(occurrence) ?? [];
    // One walk yields both the interior and the end marker. The end marker is
    // the consumer contract (ctx.range): the fill owns the range and needs
    // an anchor to insert before — the markers are the only stable nodes in
    // the range.
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
      // The range's own markers, when it has them: the fill places or binds
      // its output before `end` — the frame never touches the interior
      // (morphs protect slot ranges).
      range: end ? { start, end } : undefined,
      // Binding slot (§9.2.3): the positions of server markup that read this
      // occurrence — `[{ element, positions: [{ pos, key, name }] }]` in
      // document order. The consumer runs the fill and writes each position
      // from its returned object (there is nothing to place). `onRebind`
      // receives the new set when consumers change
      // (a morph replaced an element; a response bound a new position)
      // without the args changing — the fill's computation survives. The
      // rebinder is kept by the bind tier (resident: positions exist only
      // once it is), beside the consumer set it compares.
      positions,
      onRebind: positions ? fn => tierLoads.bind.r.rebinder(this, occurrence, fn) : undefined
    };
    // One record shape (A5): the t=0 record carries used regions as
    // `{$frame}` refs like any stream record would, and #resolveArgs
    // resolves them to the elements the regions tier discovers in the
    // adopted interior (`start`, on the adopt path) — the wrapper's own
    // reactivity OWNS the already-rendered element from the first render
    // (a client-only toggle can hide/show it at t=0, no re-arming stream
    // needed). `adopted` doubles as the claiming hint: this mount is about
    // to hydrate server markup rendered from these args (see #resolveArgs).
    const props =
      record && record.kind === "slot" ? this.#resolveArgs(occurrence, record, adopted, start) : {};
    // Run under the boundary's owner (when the creator provided one): slot
    // content reads the mount point's context (routers, stores) and bounds
    // its lifetime there. The t=0 adopt sync happens to run inside the
    // adopting render, but stream-driven mounts and re-calls arrive from
    // microtasks with no owner of their own — without the scope, a render
    // prop touching context works on boot and throws on the first refresh.
    this.#scoped(() => callback(props, ctx));
    this.#slotArgs.set(occurrence, record);
    if (cleanups.length) this.#slotCleanups.set(occurrence, cleanups);
  }

  #unmountSlot(key) {
    this.#mountedSlots.delete(key);
    // Long-session hygiene: an occurrence gone from the stream releases its
    // record and caches — keyed churn must not accumulate forever.
    this.#slotArgs.delete(key);
    this.#slotUpdaters.delete(key);
    this.#heldRecords.delete(key);
    this.#removeSlotRecord(key);
    this.#runSlotCleanups(key);
    // The occurrence's regions (the tier's): their frames dispose, the
    // entries go. Nothing to do while the tier is absent — no region was
    // ever bound. Likewise its consumer set and rebinder (the bind tier's).
    tierLoads.regions?.r?.unmount(this, key);
    tierLoads.bind?.r?.unmount(this, key);
  }

  #runSlotCleanups(key) {
    const cleanups = this.#slotCleanups.get(key);
    if (!cleanups) return;
    this.#slotCleanups.delete(key);
    for (const fn of cleanups) fn();
  }

  /**
   * The frame's options, for the regions tier: a nested region frame
   * inherits the host, the owner scope and the claim scope of the frame it
   * is bound under (`regions-tier.ts`, `bind`). Not on the `Frame`
   * interface.
   * @internal
   */
  get options() {
    return this.#options;
  }

  /**
   * Resolve a slot record's args into client-facing props. The record's
   * data refs are already the client's — the host settled every `{$ref}`
   * into a value (or a pending read) at the write and named those args
   * (`record.decoded`); they pass through untouched, never probed (a
   * decoded value may be a live container). What the FRAME resolves:
   *  - frame ref `{$frame}` (named in `record.regions`) -> a nested
   *    reconciled region delivered as a frame ELEMENT the wrapper places,
   *    **cached per slot** so a re-call reuses the same element and its
   *    bound frame — the REGIONS TIER's work (`regions-tier.ts`, `resolve`;
   *    this runs only with the tier resident: a record naming a region
   *    waits for it, `needsRegions`). On the adopt path (`claiming`, with
   *    the range's `start`) the tier first discovers the region elements
   *    already rendered in the interior, so the wrapper is handed those.
   *  - a literal -> through the host's `revive` (document-face container
   *    traces arrive as inline markers), HERE rather than at the write: an
   *    adopted occurrence's claim must read the container as the markup
   *    was rendered from it, and the materializer keys that on the claim
   *    (frames-rulings 3.6 (iii)) — `claiming` is that hint, true for the
   *    adopt-time mount (`#invokeSlot`'s `adopted`), threaded to `revive`.
   */
  #resolveArgs(slotKey, record, claiming, start) {
    const { args, regions, decoded } = record;
    const revive = this.#options.host && this.#options.host.revive;
    const props = {};
    for (const key in args) {
      if (regions && key in regions) continue;
      const value = args[key];
      props[key] = revive && !(decoded && key in decoded) ? revive(value, claiming) : value;
    }
    if (regions) tierLoads.regions.r.resolve(this, slotKey, regions, props, claiming && start);
    return props;
  }

  /** Collect this frame's own top-level slot ranges (bounded to its content),
   *  and — for the slot sync — its binding-slot elements into the same map. */
  #collectSlots(found, elements) {
    collectSlots(this.#element.firstChild, null, found, elements);
  }

  /** The `pl-<name>` template in `root` (a segment's content being
   *  revealed) or, without one, in the frame's content; null when absent —
   *  not in the range yet, or already swapped out. */
  #findPlaceholder(name, root) {
    return findPlaceholder((root || this.#element).firstChild, null, placeholderId(name));
  }

  /**
   * For the host's last-unmount capture (see host.unregister): an element
   * boundary's current interior, needed exactly when its content never rode
   * chunks — a document-adopted frame, whose markup arrived as page HTML —
   * so the resident store lacks the root record a later mount would
   * re-materialize from. Null when there is nothing to capture.
   */
  contentHTML() {
    if (this.#disposed || !this.#hasContent) return null;
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
    liveFrames.delete(this);
    this.#releaseHold();
    for (const key of [...this.#slotCleanups.keys()]) this.#runSlotCleanups(key);
    // Release this frame's occurrences' records from the store that owns them
    // (an ancestor's, for a region frame's nested occurrences) so a torn-down
    // region leaves nothing stale to dedupe a later re-navigation against.
    for (const key of this.#mountedSlots) this.#removeSlotRecord(key);
    // Every region bound under this frame disposes with it (the tier's).
    tierLoads.regions?.r?.unmount(this);
    this.#mountedSlots.clear();
  }

  #applyRoot(html) {
    const fragment = parseFragment(html);
    const parent = this.#element;
    if (!this.#hasContent) {
      parent.textContent = "";
      // Claim before insertion empties the fragment — matching compiled
      // output, which claims at creation, pre-insert.
      this.#claimTree(fragment);
      parent.appendChild(fragment);
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
      reconcileChildren(parent, fragment, null, null, claim, ranges, grafts);
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
      this.#element.firstChild,
      null,
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
      this.#element.firstChild,
      null,
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

  /** Sweep-claim the frame's existing content (the adoption path). */
  #claimContent() {
    for (let n = this.#element.firstChild; n; n = n.nextSibling) this.#claimTree(n);
  }

  /**
   * Apply the store's segment records against a range: reveal every
   * segment whose content and reveal gate the store holds and whose
   * placeholder is in `root` — the frame's whole range (a flush), or the
   * content of a segment being revealed (a reveal is an apply,
   * frames-rulings 2.3: the revealed range is applied as content that
   * arrived, nested placeholders included, so the pass over the frame never
   * has to retry for a placeholder a reveal just inserted). Then
   * materialize every fallback gate whose segment has not revealed ($dfl
   * semantics: the placeholder's template content shows while the segment
   * stays pending). Readiness is read off the store + DOM, not arrival
   * order, so content, reveal and placeholder may arrive in any order; the
   * applied state is the record applied, by identity (2.1), so a segment
   * reveals once per content record and a mount seeding from a warm store
   * reveals what the store already holds.
   */
  #revealSegments(root) {
    const version = this.#version;
    for (const key in this.#store) {
      const record = this.#store[key];
      const name = segmentName(key);
      if (name === null || !record || this.#appliedHoles.get(key) === record) continue;
      if (this.#segmentReady(name, root)) {
        this.#appliedHoles.set(key, record);
        this.#revealSegment(name, root);
        this.#applied(version, "reveal");
      }
    }
    for (const key in this.#store) {
      const m = /^seg:([^:]+):fallback$/.exec(key);
      if (!m || this.#appliedHoles.has(key) || this.#appliedHoles.has(`seg:${m[1]}`)) continue;
      if (this.#showFallback(m[1], root)) {
        this.#appliedHoles.set(key, this.#store[key]);
        this.#applied(version, "reveal");
      }
    }
  }

  #segmentReady(name, root) {
    const content = this.#store[`seg:${name}`];
    if (!content || content.kind !== "html") return false;
    // Reveal gate must be present and truthy.
    if (!this.#store[`seg:${name}:reveal`]) return false;
    // Style gate: the segment's streamed stylesheets must be loaded before it
    // shows (the $dfs/$dfc analogue), and the code that loads them is the
    // ASSETS TIER — so the term is two-fold (frames savings pass §1,
    // "assets": the reveal-readiness term): the segment is not ready while
    // the tier is not resident (`tierReady` starts its load if nothing
    // announced it; the server's fallback stays on screen; the install's
    // flush re-evaluates), and once it is, not until every named sheet has
    // settled — the tier's `gate` inserts pending links immediately, even
    // when other prerequisites are missing, so loading overlaps the rest of
    // the stream, and re-flushes this frame when one settles. The reveal is
    // at max(tier load, stylesheet load); no segment reveals unstyled. A
    // segment whose record carries INLINE styles holds the same way while
    // the tier is absent — its `<style>` lands in the assets walk, which the
    // tier performs, so revealing before the install would be the unstyled
    // window the term exists to prevent; once the tier is resident inline
    // styles never gate (the walk applied them at the record's arrival, in
    // the same flush, ahead of the segments). A segment with neither never
    // consults the tier: modules and preloads do not gate.
    const assets = this.#store[`seg:${name}:assets`];
    if (
      assets &&
      (assets.styles || assets.inlineStyles) &&
      !tierReady("assets")?.gate(assets.styles || [], this)
    )
      return false;
    // Structural prerequisite: the placeholder must exist in the range.
    return !!this.#findPlaceholder(name, root);
  }

  /**
   * Reveal a segment into its placeholder range ($df semantics): remove any
   * materialized fallback between the `pl-` template and its closing comment,
   * insert the content there, and remove both markers.
   */
  #revealSegment(name, root) {
    const tpl = this.#findPlaceholder(name, root);
    if (!tpl) return;
    // The segment's inline styles rode its assets record and landed in the
    // head at the record's arrival (the assets walk in #flush, ahead of the
    // segments), so they precede the content as the document face orders
    // them; with the assets tier absent then, the segment held (#segmentReady)
    // and they land at the install's flush, still ahead of this reveal.
    const content = this.#store[`seg:${name}`];
    const closing = rangeClose(tpl, placeholderId(name));
    // A placeholder without its closing comment is not a range: nothing
    // reveals into it (as #showFallback materializes nothing there).
    if (!closing) {
      if ("_SOLID_DEV_")
        console.error(
          `Frame fragment placeholder "${name}" is missing its closing comment ` +
            `(<!--${placeholderId(name)}-->); the segment is not revealed. Likely an ` +
            `HTML-rewriting layer stripped the comment, or invalid nesting split the ` +
            `placeholder range.`,
          tpl
        );
      return;
    }
    // Clear the current range interior (a materialized fallback, if #showFallback
    // ran) — the seam re-owns this position.
    removeUntil(tpl.parentNode, tpl.nextSibling, closing);

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
    // boundary's insertion anchor; only the template is removed. The
    // content is applied as it is revealed (2.3): its fills mount and its
    // nested segments reveal INSIDE the still-detached fragment, so a
    // placeholder the boundary commits later (a pending fill holds it)
    // is already swapped when it lands. A frame created without the hook
    // reveals through the default seam — the same content, inserted at
    // once (no boundary).
    const fallbackFrag = tpl.content.cloneNode(true);
    this.#claimTree(fallbackFrag);
    (this.#options.reveal || revealAtOnce)({
      before: closing,
      fallback: [...fallbackFrag.childNodes],
      content: () => {
        const materialized = this.#materialize(content);
        this.#syncSlots(materialized);
        this.#claimTree(materialized);
        this.#revealSegments(materialized);
        return materialized;
      }
    });
    tpl.remove();
    this.#recordHave(name, content);
  }

  /**
   * Materialize the placeholder template's own content into the range
   * ($dfl semantics) without resolving the segment. Returns whether the
   * fallback was shown.
   */
  #showFallback(name, root) {
    const tpl = this.#findPlaceholder(name, root);
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
  return new FrameImpl(boundary, options);
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
  const frame = new FrameImpl(el, options);
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
 *
 * Exported (with `isFrameElement` and `eachInRange`) for the regions tier
 * (`regions-tier.ts`), which bundles its own copy of these pure helpers;
 * the eager entry re-exports none of them.
 * @internal
 */
export function makeFrameElement(id) {
  const el = document.createElement(FRAME_TAG);
  el.style.display = "contents";
  if (id !== undefined) el.setAttribute(FRAME_ID_ATTR, id);
  return el;
}

/** Whether `node` is a frame boundary/region element (carries our id attr).
 *  @internal */
export function isFrameElement(node) {
  return node.nodeType === ELEMENT_NODE && node.hasAttribute(FRAME_ID_ATTR);
}

/** Returns the segment name for a `seg:<name>` content key, else `null`. */
function segmentName(key) {
  const m = /^seg:([^:]+)$/.exec(key);
  return m ? m[1] : null;
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

/**
 * The default reveal seam (`FrameOptions.reveal` omitted): the segment's
 * content inserted before the closing comment at once, the comment removed
 * — the framework-agnostic swap, no boundary.
 */
function revealAtOnce(seam) {
  seam.before.parentNode.insertBefore(seam.content(), seam.before);
  seam.before.remove();
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
    // Binding-slot markers (`_s:*`), when the caller wants them — the slot
    // sync does; the morph's range index does not (an element is reconciled
    // as an element, not relocated as a protected range). The BIND TIER
    // parses them: a text position's start marker joins its parent
    // element's consumer entry (`text`); an element's positions join its
    // occurrence's consumer list, in document order (`positions`). With
    // the tier absent, the walk only NOTES that a marker was met
    // (`elements.b`) — the sync holds on the note and the install's flush
    // re-walks. A text pair's interior (one text node, the end marker) and
    // the element's interior are walked like any server content: they may
    // hold further occurrences of either kind.
    if (elements !== undefined && isTextStart(n)) {
      const B = tierLoads.bind?.r;
      B ? B.text(n, elements) : (elements.b = true);
    }
    if (n.nodeType === ELEMENT_NODE && !isFrameElement(n)) {
      if (elements !== undefined && n.hasAttributes()) {
        const B = tierLoads.bind?.r;
        B ? B.positions(n, elements) : hasSlotMarker(n) && (elements.b = true);
      }
      collectSlots(n.firstChild, null, out, elements);
    }
    n = n.nextSibling;
  }
}

/**
 * Walk a slot range's interior — every node between `start` and the range's
 * end marker — calling `cb` on each. The next sibling is captured before the
 * callback runs, so callbacks may detach the node. Returns the end marker
 * (null if the range is truncated).
 * @internal (exported for the regions tier — see `makeFrameElement`)
 */
export function eachInRange(start, key, cb) {
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
//
// The parse and the re-imposition are the BIND TIER's (`owned` / `apply`,
// bind-tier.ts): while it is absent nothing is bound, so nothing is the
// client's and the morph writes the server's values whole — `null` here,
// the "no owned positions" answer the arms already take.
/** The incoming element's owned positions, or null (none, or the tier
 *  absent). */
const ownedPositions = el => {
  const B = tierLoads.bind?.r;
  return B ? B.owned(el) : null;
};
/**
 * Apply the server's value for `name` (null: absent) to an element with
 * binding-slot positions: a client-owned attribute is left alone; owned
 * `class`/`style` NAMES are re-imposed over the server's string. Returns
 * whether the attribute changed, or undefined when the position is not
 * owned and the caller writes it.
 */
const applyOwned = (oldEl, name, value, owned) =>
  owned === null ? undefined : tierLoads.bind.r.apply(oldEl, name, value, owned);

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
      // The same binding-slot text position: its interior is the client's
      // (the incoming one is empty on the stream face) — keep it and skip
      // both ranges. Any other case reconciles as ordinary nodes; the
      // consumer change that follows rebinds the owner, which writes the
      // new range. Eager, not the bind tier's: reconciled as ordinary nodes
      // the pair's text would be dropped and its unchanged position would
      // not rebind (same start marker), and a dispatch point here costs
      // what the arm does (measured, C6).
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
