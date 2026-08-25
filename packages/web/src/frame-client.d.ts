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

/**
 * One transport chunk of a frame stream, addressed by frame `id`.
 * @experimental
 */
export type FrameChunk =
  | { type: "start"; id: string; version: number }
  | { type: "html"; id: string; version: number; html: string }
  | { type: "fragment"; id: string; version: number; key: string; html: string }
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
    }
  | { type: "slot"; id: string; version: number; key: string; args: Record<string, unknown> }
  | { type: "complete"; id: string; version: number }
  | { type: "error"; id: string; version: number; key?: string; error: unknown };

/**
 * Maps a wire chunk onto resident-store record writes. `data` chunks map to
 * no records — they are response-scoped and the host applies them through
 * its data hook.
 * @experimental
 */
export function chunkToRecords(chunk: FrameChunk): Record<string, unknown>;

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
  /** The first registered frame under the id, if any. */
  get(id: string): Frame | undefined;
  serialize(value: unknown): { $ref: string };
  /** `frameId` is the resolving frame's id — route to its stream's table. */
  resolve(ref: { $ref: string }, frameId?: string): unknown;
  /** See FrameHostOptions.revive. */
  revive?(value: unknown): unknown;
  /** See FrameHostOptions.isContainer. */
  isContainer?(value: unknown): boolean;
}

/**
 * The bubbling DOM event (`"frame:applied"`) a frame dispatches from its
 * parent element whenever server content lands in the document — root
 * materialize/morph, segment reveal, fallback materialization — with
 * `detail: { id, version, reason }`. One document-level listener sees every
 * boundary (nested region frames dispatch too); use it to re-apply
 * client-owned decorations on server-owned markup (router affordance
 * reflection, e.g. `aria-current`) without a MutationObserver.
 * @experimental
 */
export const FRAME_APPLIED_EVENT: "frame:applied";

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
  /**
   * Arms event types for behavior claims: the `_bnd` sweep collects the
   * event names it finds and hands them here so delegated dispatch can
   * reach them. Platform glue passes its `delegateEvents` — the option
   * exists (rather than client.js importing the event system) so
   * tree-shaken subsets without events pay nothing. Frames registered
   * with this host inherit it unless they pass their own `delegate`.
   */
  delegate?(eventNames: Iterable<string>): void;
}

/** @experimental */
export function createFrameHost(options?: FrameHostOptions): FrameHost;

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
   * Raw client props for behavior-claim resolution: server elements carrying
   * `_bnd="pos=prop"` markers (compiled under the `serverComponents` option)
   * resolve ref/event positions by name through this object — read live at
   * dispatch/materialize time, so compiled prop getters stay latest-value.
   */
  props?: Record<string, unknown>;
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
  /** Per-frame override of the host's `delegate` (see FrameHostOptions). */
  delegate?(eventNames: Iterable<string>): void;
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
   * Document-face record-race guard (adopt path only — solidjs/solid#2968).
   * Nothing on the wire formally orders an occurrence's args-record data
   * script before the event that triggers adoption, so a recordless
   * occurrence is ambiguous while this returns true: the frame defers its
   * mount one macrotask (all currently parsed scripts run first), calls
   * `drainRecords`, and classifies with whatever is then resolvable. Return
   * false once the document can run no further data scripts.
   */
  recordsPending?(): boolean;
  /** Re-absorb the document's arrived-by-now records (idempotent per key). */
  drainRecords?(): void;
}

/**
 * A frame rendering into an EXISTING element boundary. Pass `adopt: true` for
 * the document-SSR path: the element already holds server-rendered content,
 * so the first apply morphs against it and slots sync immediately (hydration
 * attach), claiming their server-rendered DOM — a document boot needs no
 * chunk.
 * @experimental
 */
export function createFrame(boundary: Element, options?: FrameOptions): Frame;

/**
 * The default boundary/region element tag and its id attribute — the DOM
 * contract the producer emits at t=0 and the consumer creates/adopts.
 * @experimental
 */
export const FRAME_TAG: "dx-frame";
/** @experimental */
export const FRAME_ID_ATTR: "data-fid";

/**
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
