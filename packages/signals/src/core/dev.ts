import {
  attrHooks,
  setAttributionHooks,
  withInteraction,
  withOrigin,
  type AttributionHooks,
  type InteractionRef,
  type OriginRef
} from "./attribution-hooks.js";
// Cycle note: core.ts imports this module; we read its live `context` binding
// only at call time (emitDiagnostic's default subject), never during module
// evaluation, so the cycle is inert — same shape as the attribution.ts edge.
import { context } from "./core.js";
import type { Computed, Link, Owner, Signal } from "./types.js";

export interface DevHooks {
  onOwner?: (owner: Owner) => void;
  onGraph?: (value: any, owner: Owner | null) => void;
  onUpdate?: () => void;
  onStoreNodeUpdate?: (state: any, property: PropertyKey, value: any, prev: any) => void;
}

/**
 * `info` is the advisory tier: a structural fact worth surfacing that is not
 * presumptively a bug (e.g. a 2-deep sequential fetch chain, which may be an
 * intrinsic data dependency). Budget/assertion consumers should treat only
 * `warn`/`error` as failures unless they opt in to `info`.
 */
export type DiagnosticSeverity = "info" | "warn" | "error";

export type DiagnosticCode =
  | "STRICT_READ_UNTRACKED"
  | "PENDING_ASYNC_UNTRACKED_READ"
  | "PENDING_ASYNC_FORBIDDEN_SCOPE"
  | "REACTIVE_WRITE_IN_OWNED_SCOPE"
  | "ACTION_CALLED_IN_OWNED_SCOPE"
  | "RUN_WITH_DISPOSED_OWNER"
  | "NO_OWNER_CLEANUP"
  | "CLEANUP_IN_FORBIDDEN_SCOPE"
  | "SETTLED_CLEANUP_UNOWNED"
  | "SETTLE_WALK_UNINITIALIZED_SOURCE"
  | "FLUSH_IN_EFFECT_CALLBACK"
  | "PRIMITIVE_IN_FORBIDDEN_SCOPE"
  | "NO_OWNER_EFFECT"
  | "NO_OWNER_BOUNDARY"
  | "ASYNC_OUTSIDE_LOADING_BOUNDARY"
  | "INVALID_REFRESH_TARGET"
  | "INVALID_AFFECTS_TARGET"
  | "MISSING_EFFECT_FN"
  | "SYNC_NODE_RECEIVED_ASYNC"
  | "REACTIVITY_HALTED"
  | "INVARIANT_VIOLATION"
  | "HUGE_FAN_OUT"
  | "HUGE_FAN_IN"
  | "HOT_SCOPE_RERUNS"
  | "HOT_SCOPE_TIME"
  | "WIDE_SCOPE_DEPS"
  | "UNSTABLE_MEMO_OUTPUT"
  | "WIDE_WRITE"
  | "ASYNC_WATERFALL"
  | "HOT_SCOPE_FANOUT"
  | "SILENT_HOLD"
  | "LONG_HOLD"
  | "EFFECT_WRITES_OWN_SOURCE"
  | "EFFECT_RELAY_TEAR"
  | "IMMUTABLE_UPDATE_IN_STORE"
  | "UNSTABLE_LIST_IDENTITY";

export type DiagnosticKind =
  | "strict-read"
  | "async"
  | "write"
  | "lifecycle"
  | "owner"
  | "error"
  | "perf"
  | "graph"
  /** Perceived responsiveness: the runtime behaved correctly but the user saw no feedback. */
  | "responsiveness";

/** First warning when a change reaches (or a pass tracks) this many edges. */
export const GRAPH_SIZE_WARN_AT = 2000;
/** Re-warn once the count has grown by this much since the last warning. */
export const GRAPH_SIZE_WARN_EVERY = 500;

export interface DiagnosticEvent {
  sequence: number;
  code: DiagnosticCode;
  kind: DiagnosticKind;
  severity: DiagnosticSeverity;
  message: string;
  ownerId?: string;
  ownerName?: string;
  nodeName?: string;
  /**
   * Root-first chain of named owners enclosing the subject of the event —
   * component roots as `<Name>`, computations by their `name` option (or
   * the `effect`/`computed` default) — e.g. `["<App>", "<TodoRow>", "effect"]`.
   * Unnamed owners (plain roots) are skipped. Absent when the subject has no
   * named owner at all (a top-level scope, or an unowned primitive — which
   * is usually the finding itself).
   */
  ownerPath?: string[];
  data?: Record<string, unknown>;
}

export type DiagnosticListener = (event: DiagnosticEvent) => void;

export interface DiagnosticCapture {
  readonly events: readonly DiagnosticEvent[];
  clear(): void;
  stop(): DiagnosticEvent[];
}

export interface Diagnostics {
  subscribe(listener: DiagnosticListener): () => void;
  capture(): DiagnosticCapture;
  /**
   * Records an event on the channel from outside the reactive core — a host
   * runtime reporting its own findings (hydration mismatches, server render
   * faults) so consumers see one stream. `subject` locates it like the
   * internal sites do; a host whose owners are not signals' owners passes
   * `ownerPath` on the event instead and it is used as-is.
   */
  emit(
    event: Omit<DiagnosticEvent, "sequence">,
    subject?: DiagnosticSubject | null
  ): DiagnosticEvent;
}

/**
 * The core's side of attribution: the hook slot an engine installs into, and
 * the interaction frame the rendering runtime opens around event dispatch.
 * The engine itself — "why did this run", costs, holds, feedback — is
 * `@solidjs/signals/attribution`, a separate entry so an observe build pays
 * for it only when something imports it.
 */
export interface AttributionSlot {
  /**
   * Installs `hooks` as the engine the core reports facts to (`null`
   * uninstalls). One engine at a time; the built-in engine's `enable()` calls
   * this, and an external consumer (devtools) may install its own instead.
   */
  install(hooks: AttributionHooks | null): void;
  /** The installed engine's hooks, or `null` when none is installed. */
  readonly installed: AttributionHooks | null;
  /**
   * Run `fn` as a user interaction's handler: root writes inside stamp it as
   * their origin, and actions/effects/flights it causes carry it. The web
   * runtime wraps every event dispatch in this; custom renderers and test
   * harnesses call it themselves. `fn()` when no engine is installed.
   */
  withInteraction<T>(ref: InteractionRef, fn: () => T): T;
  /**
   * Run `fn` as a declared unit of work — a router's navigation, described
   * by the parametrized route it matched: root writes inside are attributed
   * to it (under the enclosing interaction, if any), so the hold behind the
   * route's data, the re-runs and the verdicts carry the route's name. Any
   * router calls this around its location write; nothing else is
   * router-specific. `fn()` when no engine is installed.
   */
  withOrigin<T>(ref: OriginRef, fn: () => T): T;
}

/**
 * The observe tier: the structured channel and the attribution wiring —
 * everything a production observability consumer needs, and nothing that
 * assumes a developer at a console. Present in dev and observe builds
 * (`__OBSERVE__`); `undefined` in prod.
 */
export interface Observe {
  diagnostics: Diagnostics;
  /** The attribution hook slot and interaction frame — see `AttributionSlot`. */
  attribution: AttributionSlot;
  /**
   * The live node an emitted event was about, when the emitter knew it.
   * Events are serializable records and never carry the node; consumers that
   * run in-process (devtools, the console reporter) look it up here.
   */
  subjectOf(event: DiagnosticEvent): DiagnosticSubject | undefined;
}

/**
 * The dev tier: devtools hooks, graph traversal, and the console face of the
 * diagnostics channel. Present only in dev builds (`__DEV__`).
 */
export interface Dev {
  hooks: DevHooks;
  getChildren: typeof getChildren;
  getSignals: typeof getSignals;
  getParent: typeof getParent;
  getSources: typeof getSources;
  getObservers: typeof getObservers;
  /** Console face of an emitted event — see `reportDiagnostic`. */
  report(entry: DiagnosticEvent): void;
  /**
   * Registers a console footer appended to the first console report of
   * each diagnostic code — a discovery pointer to deeper guidance (e.g.
   * solid-js registers its shipped repair skill). Reported events carry
   * it as trailing lines of the same console entry; events that surface as
   * a thrown error instead get it as a follow-up line. Returning undefined
   * for an event suppresses the footer. Passing undefined unregisters and
   * resets the once-per-code memory.
   */
  setConsoleFooter(footer: ((event: DiagnosticEvent) => string | undefined) | undefined): void;
}

// A dev build without the wiring is a build whose checks emit into a channel
// nobody can subscribe to. Fail at module init rather than at the first
// silently dropped finding.
if (__DEV__ && !__OBSERVE__)
  throw new Error("@solidjs/signals: __DEV__ requires __OBSERVE__ (dev is a superset of observe)");

const hooks: DevHooks = {};
const diagnosticListeners = new Set<DiagnosticListener>();
const diagnosticCaptures = new Set<DiagnosticEvent[]>();
let diagnosticSequence = 0;
let consoleFooter: ((event: DiagnosticEvent) => string | undefined) | undefined;
const footeredCodes = new Set<DiagnosticCode>();

const diagnostics: Diagnostics = {
  subscribe(listener) {
    diagnosticListeners.add(listener);
    return () => diagnosticListeners.delete(listener);
  },
  emit(event, subject = null) {
    return emitDiagnostic(event, subject);
  },
  capture() {
    const events: DiagnosticEvent[] = [];
    diagnosticCaptures.add(events);
    return {
      get events() {
        return events;
      },
      clear() {
        events.length = 0;
      },
      stop() {
        diagnosticCaptures.delete(events);
        return [...events];
      }
    };
  }
};

const attributionSlot: AttributionSlot = {
  install: setAttributionHooks,
  get installed() {
    return attrHooks;
  },
  withInteraction,
  withOrigin
};

export const OBSERVE: Observe = __OBSERVE__
  ? {
      diagnostics,
      attribution: attributionSlot,
      subjectOf(event) {
        return eventSubjects.get(event);
      }
    }
  : (undefined as unknown as Observe);

export const DEV: Dev = __DEV__
  ? {
      hooks,
      getChildren,
      getSignals,
      getParent,
      getSources,
      getObservers,
      report: reportDiagnostic,
      setConsoleFooter(footer) {
        consoleFooter = footer;
        footeredCodes.clear();
      }
    }
  : (undefined as unknown as Dev);

/**
 * Dev-mode internal consistency check. A failure means the reactive system
 * contradicted itself (not that user code misbehaved) — see
 * INTERNALS-ASYNC-STATE.md for the invariant catalog. Throws under __TEST__
 * so the suite (and fuzzing) treats any violation as a hard failure; logs in
 * dev builds so user apps degrade instead of crashing.
 */
export function assertInvariant(condition: boolean, name: string, message: string): void {
  if (!__DEV__ || condition) return;
  const full = `[INVARIANT_VIOLATION] ${name}: ${message}`;
  const entry = emitDiagnostic({
    code: "INVARIANT_VIOLATION",
    kind: "error",
    severity: "error",
    message: full,
    data: { invariant: name }
  });
  if (typeof __TEST__ !== "undefined" && __TEST__) throw new Error(full);
  reportDiagnostic(entry);
}

/** Anything a diagnostic can be about: an owner (root, computed, effect) or a signal. */
export type DiagnosticSubject = Owner | Signal<any> | Computed<any>;

/**
 * Root-first names of the owners enclosing `subject` (inclusive when the
 * subject is itself a named owner). Signals hop to their registering owner
 * (`_owner`, set by registerGraph). Unnamed owners are skipped so the path
 * reads as the component tree plus the scope: `<App> › <TodoRow> › effect`.
 */
export function ownerPath(subject: DiagnosticSubject | null | undefined): string[] | undefined {
  if (!subject) return undefined;
  let owner: Owner | null =
    "_parent" in subject ? (subject as Owner) : (((subject as any)._owner as Owner | null) ?? null);
  const path: string[] = [];
  for (; owner !== null; owner = owner._parent) {
    const name = (owner as any)._name;
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? path.reverse() : undefined;
}

/**
 * Records a diagnostic on the structured channel (listeners, captures) and
 * returns the entry. `subject` locates it: the current reactive `context` by
 * default (right for the synchronous rule checks — they fire inside the
 * scope that misbehaved); pass the node for scheduler-time findings whose
 * ambient context is the flush, or `null` for events that have no location
 * by nature. An `ownerPath` already on the event wins over the subject walk
 * (hosts whose owners are not signals' owners compute their own). Console
 * output is a separate, dev-tier step — see `reportDiagnostic`.
 */
export function emitDiagnostic(
  event: Omit<DiagnosticEvent, "sequence">,
  subject: DiagnosticSubject | null | undefined = context
): DiagnosticEvent {
  const entry: DiagnosticEvent = {
    sequence: ++diagnosticSequence,
    ...event
  };
  if (entry.ownerPath === undefined) {
    const path = ownerPath(subject);
    if (path) entry.ownerPath = path;
  }
  if (subject) eventSubjects.set(entry, subject);
  for (const listener of diagnosticListeners) listener(entry);
  for (const capture of diagnosticCaptures) capture.push(entry);
  // Footer for events that never reach reportDiagnostic because the call site
  // throws the message instead (every such site is severity "error"): a
  // microtask lands it below the thrown error. Sites that DO report consume
  // the once-per-code slot synchronously first, so this finds it taken and
  // stays silent — one console entry per finding. Advisory (`info`) events
  // are structured-channel only and get no footer: nothing on the console
  // for it to follow. Dev-tier: the footer is console guidance.
  if (__DEV__ && entry.severity === "error" && consoleFooter && !footeredCodes.has(entry.code)) {
    queueMicrotask(() => {
      const footer = takeFooter(entry);
      if (footer) console.warn(footer);
    });
  }
  return entry;
}

/** The once-per-code footer text, consuming the slot. Undefined if taken or unregistered. */
function takeFooter(entry: DiagnosticEvent): string | undefined {
  if (!consoleFooter || footeredCodes.has(entry.code)) return undefined;
  footeredCodes.add(entry.code);
  return consoleFooter(entry);
}

/**
 * The subject each emitted event was about, for the console step: events are
 * serializable records and cannot carry the node, but the console can show
 * what the node knows — a rendering runtime may stamp a binding effect with
 * the DOM element it writes (`_devElement`), and a live element reference
 * beside the message is the most addressable pointer a console can print.
 */
const eventSubjects = new WeakMap<DiagnosticEvent, DiagnosticSubject>();

/**
 * The console face of a diagnostic — ONE entry per finding: the message, the
 * owner path (`in <App> › <TodoRow> › effect`) so a human can locate it, the
 * once-per-code footer as trailing lines, and — when the subject is a
 * binding effect the rendering runtime tagged — the element it writes, as a
 * second console argument (hover highlights it, click jumps to Elements).
 * Severity picks the console method. Call sites report the entry
 * `emitDiagnostic` returned so the structured and console channels never
 * disagree. Dev-tier: in an observe build this is a no-op, so wiring paths
 * that both emit and report (graph-size warnings) reach the channel only —
 * production observability never writes to the console.
 */
export function reportDiagnostic(entry: DiagnosticEvent): void {
  if (!__DEV__) return;
  let text = entry.message;
  if (entry.ownerPath) text += `\n  in ${entry.ownerPath.join(" › ")}`;
  const footer = takeFooter(entry);
  if (footer) text += `\n${footer}`;
  const element = (eventSubjects.get(entry) as { _devElement?: object } | undefined)?._devElement;
  const args = element !== undefined ? [text, element] : [text];
  entry.severity === "error" ? console.error(...args) : console.warn(...args);
}

/**
 * Shared strict-read diagnostics for core read() and the store proxy traps.
 * Single source for the message text — the #2897 safeguard parity between
 * memos and stores is exactly these firing identically from both paths.
 */
export function throwPendingUntrackedRead(
  strictReadLabel: string,
  fields?: Partial<Omit<DiagnosticEvent, "sequence" | "data" | "ownerPath">>
): never {
  const message =
    `[PENDING_ASYNC_UNTRACKED_READ] Reading a pending async value directly in ${strictReadLabel}. ` +
    `Async values must be read within a tracking scope (JSX, a memo, or an effect's compute function).`;
  emitDiagnostic({
    code: "PENDING_ASYNC_UNTRACKED_READ",
    kind: "async",
    severity: "error",
    message,
    ...fields,
    data: { strictRead: strictReadLabel }
  });
  throw new Error(message);
}

export function warnStrictReadUntracked(
  strictReadLabel: string,
  fields?: Partial<Omit<DiagnosticEvent, "sequence" | "ownerPath">>
): void {
  const message =
    `[STRICT_READ_UNTRACKED] Reactive value read directly in ${strictReadLabel} will not update. ` +
    `Move it into a tracking scope (JSX, a memo, or an effect's compute function).`;
  reportDiagnostic(
    emitDiagnostic({
      code: "STRICT_READ_UNTRACKED",
      kind: "strict-read",
      severity: "warn",
      message,
      data: { strictRead: strictReadLabel },
      ...fields
    })
  );
}

/**
 * Observe-tier: stamp a signal with its creating owner so `ownerPath` can
 * locate signal subjects. The per-owner `_signals` list and the devtools
 * `onGraph` hook are dev-tier — the observe build pays one property write.
 */
export function registerGraph(value: any, owner: Owner | null): void {
  (value as any)._owner = owner;
  if (__DEV__) {
    if (owner) {
      if (!(owner as any)._signals) (owner as any)._signals = [];
      (owner as any)._signals.push(value);
    }
    DEV.hooks.onGraph?.(value, owner);
  }
}

export function clearSignals(node: Owner): void {
  (node as any)._signals = undefined;
}

// Graph traversal helpers

export function getChildren(owner: Owner): Owner[] {
  const children: Owner[] = [];
  let child = owner._firstChild;
  while (child) {
    children.push(child);
    child = child._nextSibling;
  }
  return children;
}

export function getSignals(owner: Owner): any[] {
  return (owner as any)._signals ? [...(owner as any)._signals] : [];
}

export function getParent(owner: Owner): Owner | null {
  return owner._parent;
}

export function getSources(computation: Computed<any>): (Signal<any> | Computed<any>)[] {
  const sources: (Signal<any> | Computed<any>)[] = [];
  let link: Link | null = computation._deps;
  while (link) {
    sources.push(link._dep);
    link = link._nextDep;
  }
  return sources;
}

export function getObservers(node: Signal<any> | Computed<any>): Computed<any>[] {
  const observers: Computed<any>[] = [];
  let link: Link | null = node._subs;
  while (link) {
    observers.push(link._sub);
    link = link._nextSub;
  }
  return observers;
}

/**
 * Graph-size warnings are once per node, re-warning only when the count has
 * grown by GRAPH_SIZE_WARN_EVERY since the last one — off-node, so the
 * pathological handful of nodes that ever reach the threshold are the only
 * ones that cost anything, and no node carries a bookkeeping field for it.
 */
const graphSizeWarnedAt = new WeakMap<object, number>();

function shouldWarnGraphSize(node: object, count: number): boolean {
  const last = graphSizeWarnedAt.get(node);
  if (last !== undefined && count < last + GRAPH_SIZE_WARN_EVERY) return false;
  graphSizeWarnedAt.set(node, count);
  return true;
}

/**
 * Observe-tier: a committed change on `node` is about to re-run `count`
 * subscribers (the notify walk in `insertSubs` counted them as it went —
 * fan-out costs exactly one local increment in a loop that already visits
 * every edge, and nothing at link time). Fires from GRAPH_SIZE_WARN_AT up,
 * on the write rather than the link: a fan-out that is never written costs
 * nothing, and one that is re-runs every subscriber this flush. Always-on
 * wherever the channel exists — unlike the opt-in attribution engine, a
 * graph-size pathology should surface without asking.
 */
export function noteFanOut(node: Signal<any> | Computed<any>, count: number): void {
  if (!shouldWarnGraphSize(node, count)) return;
  const name = node._name;
  const message =
    `[HUGE_FAN_OUT] ${name ? `Signal "${name}"` : "A signal"} changed with ${count} subscribers — ` +
    `every one re-runs this flush. If many independent computations read the same value ` +
    `(for example every row of a list comparing against one selected id), prefer a per-key ` +
    `store or projection so only the items whose result flipped update.`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "HUGE_FAN_OUT",
        kind: "graph",
        severity: "warn",
        message,
        nodeName: name,
        ownerId: (node as Computed<any>).id,
        ownerName: name,
        data: { count }
      },
      node
    )
  );
}

/**
 * Observe-tier: a recompute pass of `node` tracked `count` distinct sources
 * (counted by `link()` on each first touch of the pass — see graph.ts).
 * Fires from GRAPH_SIZE_WARN_AT up, at the end of the pass that read them.
 */
export function noteFanIn(node: Computed<any>, count: number): void {
  if (!shouldWarnGraphSize(node, count)) return;
  const name = node._name;
  const message =
    `[HUGE_FAN_IN] ${name ? `Computation "${name}"` : "A computation"} tracked ${count} sources. ` +
    `It will re-run when any of them change. Narrow the read or split the derivation so each ` +
    `computation tracks only what it needs.`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "HUGE_FAN_IN",
        kind: "graph",
        severity: "warn",
        message,
        nodeName: name,
        ownerId: node.id,
        ownerName: name,
        data: { count }
      },
      node
    )
  );
}
