import { attribution, type Attribution } from "./attribution.js";
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
  | "HOT_SCOPE_FANOUT";

export type DiagnosticKind =
  | "strict-read"
  | "async"
  | "write"
  | "lifecycle"
  | "owner"
  | "error"
  | "perf"
  | "graph";

/** First warning when a node's live edge count reaches this size. */
export const GRAPH_SIZE_WARN_AT = 2000;
/** Repeat the warning at this interval after the first. */
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

export interface Dev {
  hooks: DevHooks;
  diagnostics: Diagnostics;
  /** "Why did this run" re-run attribution — see attribution.ts. */
  attribution: Attribution;
  getChildren: typeof getChildren;
  getSignals: typeof getSignals;
  getParent: typeof getParent;
  getSources: typeof getSources;
  getObservers: typeof getObservers;
}

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
  setConsoleFooter(footer) {
    consoleFooter = footer;
    footeredCodes.clear();
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

export const DEV: Dev = __DEV__
  ? {
      hooks,
      diagnostics,
      // Getter: attribution.ts imports emitDiagnostic back from this module,
      // so when attribution.ts evaluates first the `attribution` binding is
      // still uninitialized here — defer the read to access time.
      get attribution() {
        return attribution;
      },
      getChildren,
      getSignals,
      getParent,
      getSources,
      getObservers
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
 * by nature. Console output is a separate step — see `reportDiagnostic`.
 */
export function emitDiagnostic(
  event: Omit<DiagnosticEvent, "sequence" | "ownerPath">,
  subject: DiagnosticSubject | null | undefined = context
): DiagnosticEvent {
  const entry: DiagnosticEvent = {
    sequence: ++diagnosticSequence,
    ...event
  };
  const path = ownerPath(subject);
  if (path) entry.ownerPath = path;
  for (const listener of diagnosticListeners) listener(entry);
  for (const capture of diagnosticCaptures) capture.push(entry);
  // Footer for events that never reach reportDiagnostic because the call site
  // throws the message instead (every such site is severity "error"): a
  // microtask lands it below the thrown error. Sites that DO report consume
  // the once-per-code slot synchronously first, so this finds it taken and
  // stays silent — one console entry per finding. Advisory (`info`) events
  // are structured-channel only and get no footer: nothing on the console
  // for it to follow.
  if (entry.severity === "error" && consoleFooter && !footeredCodes.has(entry.code)) {
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
 * The console face of a diagnostic — ONE entry per finding: the message, the
 * owner path (`in <App> › <TodoRow> › effect`) so a human can locate it, and
 * the once-per-code footer as trailing lines. Severity picks the console
 * method. Call sites report the entry `emitDiagnostic` returned so the
 * structured and console channels never disagree.
 */
export function reportDiagnostic(entry: DiagnosticEvent): void {
  let text = entry.message;
  if (entry.ownerPath) text += `\n  in ${entry.ownerPath.join(" › ")}`;
  const footer = takeFooter(entry);
  if (footer) text += `\n${footer}`;
  entry.severity === "error" ? console.error(text) : console.warn(text);
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

export function registerGraph(value: any, owner: Owner | null): void {
  (value as any)._owner = owner;
  if (owner) {
    if (!(owner as any)._signals) (owner as any)._signals = [];
    (owner as any)._signals.push(value);
  }
  DEV.hooks.onGraph?.(value, owner);
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

function shouldWarnGraphSize(count: number): boolean {
  return count >= GRAPH_SIZE_WARN_AT && (count - GRAPH_SIZE_WARN_AT) % GRAPH_SIZE_WARN_EVERY === 0;
}

/**
 * DEV-only: bump live edge counts after a new graph link and warn when a
 * node grows an unusually large fan-out (many subscribers on one source) or
 * fan-in (many sources on one computation). Repeat-reads that `link()`
 * dedupes never reach here. Always-on in dev — unlike the opt-in attribution
 * engine, a graph-size pathology should surface without asking.
 */
export function noteGraphLink(dep: Signal<any> | Computed<any>, sub: Computed<any>): void {
  const fanOut = (dep._subCount = (dep._subCount || 0) + 1);
  const fanIn = (sub._depCount = (sub._depCount || 0) + 1);
  if (shouldWarnGraphSize(fanOut)) {
    const name = dep._name;
    const message =
      `[HUGE_FAN_OUT] ${name ? `Signal "${name}"` : "A signal"} has ${fanOut} subscribers. ` +
      `Each will re-run when it changes. If many independent computations read the same value ` +
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
          ownerId: (dep as Computed<any>).id,
          ownerName: name,
          data: { count: fanOut }
        },
        dep
      )
    );
  }
  if (shouldWarnGraphSize(fanIn)) {
    const name = sub._name;
    const message =
      `[HUGE_FAN_IN] ${name ? `Computation "${name}"` : "A computation"} has ${fanIn} sources. ` +
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
          ownerId: sub.id,
          ownerName: name,
          data: { count: fanIn }
        },
        sub
      )
    );
  }
}

/** DEV-only: drop live edge counts when a link is removed. */
export function unnoteGraphLink(link: Link): void {
  const dep = link._dep;
  const sub = link._sub;
  if (dep._subCount) dep._subCount--;
  if (sub._depCount) sub._depCount--;
}
