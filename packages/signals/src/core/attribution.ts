import { setAttributionHooks, type AttributionHooks } from "./attribution-hooks.js";
import { $REFRESH, NOT_PENDING } from "./constants.js";
// Cycle note: dev.ts imports this module for the `attribution` object, and we
// import its hoisted emitDiagnostic back — safe (only called at runtime) and
// treeshake-neutral (dev.ts is already reachable from the core).
import { emitDiagnostic } from "./dev.js";
import type { Computed, Signal } from "./types.js";

/**
 * Dev-mode "why did this run" attribution.
 *
 * The runtime already knows the full dependency set of every scope; this
 * module surfaces it. Every value commit stamps its node with a ChangeRecord
 * (a write, an async landing, a refresh() invalidation, or a derived change
 * whose `causes` chain back to root writes). When a computation re-executes,
 * the deps whose stamp is newer than the node's last run are its causes, so
 * each re-run can be explained as a chain down to the originating write:
 *
 *   [why-run] effect "docTitle" ran (run 4)
 *     ← memo "userLabel" changed (#6)
 *       ← signal "notifications" write (#5) 2 → 3
 *
 * This module is the attribution ENGINE: all semantics live here, and it is
 * decoupled from the core. `enable()` installs it into the core's narrow
 * dev-only hook points (attribution-hooks.ts); core's only obligation is to
 * call those hooks with true facts. Disabled cost is one null check per hook
 * site; prod builds fold the sites out entirely. The same hook surface is the
 * intended substrate for external consumers (devtools) — one mechanism, two
 * front-ends.
 */

export type ChangeKind = "write" | "derived" | "async" | "refresh";

export interface ChangeRecord {
  /** Global monotonic change sequence — orders causes across the app. */
  seq: number;
  kind: ChangeKind;
  name: string;
  /** Short previews of the value transition (writes only). */
  prev?: string;
  value?: string;
  /** First user frames of the triggering write's stack (opt-in). */
  stack?: string[];
  /** For derived changes: the upstream changes that produced this one. */
  causes?: ChangeRecord[];
}

export interface RerunEvent {
  /** Global monotonic run sequence. */
  run: number;
  /** How many times this node has re-run since attribution was enabled. */
  nodeRuns: number;
  nodeKind: "effect" | "memo";
  nodeName: string;
  node: Computed<any>;
  /**
   * The deps that changed since this node's previous run. Empty means the
   * re-run was not triggered by a tracked value change (creation-adjacent
   * pull, error retry, or a cause this prototype does not stamp yet).
   */
  causes: ChangeRecord[];
  /** Dependency count after this run. */
  depCount: number;
  /** Names of deps this run subscribed to that the previous run did not. */
  depsAdded: string[];
  /** Names of deps the previous run had that this run dropped. */
  depsRemoved: string[];
  /** Wall time of this run excluding nested recomputes (ms). */
  selfMs: number;
  /** Wall time of this run including nested recomputes (ms). */
  totalMs: number;
  /**
   * Whether the run committed a changed value. A PLAIN memo run with
   * `changed: false` was pure waste — the equality cutoff stopped it from
   * notifying anyone; an effect run with `changed: false` computed without
   * firing its effect phase. Summed as `wastedMs` in costs() (plain,
   * non-held runs only — see `phase`).
   */
  changed: boolean;
  /**
   * Which posture this run executed under. "optimistic" = under an
   * optimistic lane (overlay recompute); "transition" = a transition was
   * active or owns the node (the run may be replayed/settled later);
   * "plain" = an ordinary committed run. Overlay runs are real work (they
   * count toward time budgets) but are never blamed as waste, and costs()
   * reports their time separately as `overlayMs`.
   */
  phase: "plain" | "transition" | "optimistic";
  /**
   * The changed value was held in `_pendingValue` (a transition hold) rather
   * than committed directly; its reveal happens on the transition's own
   * schedule. Held runs are excluded from waste accounting.
   */
  held: boolean;
}

export interface AttributionOptions {
  /** Pretty-print each re-run to the console (default true). */
  log?: boolean;
  /** Capture the user stack frame of each write — slow (default false). */
  stacks?: boolean;
  /** Ring-buffer size for `history()` (default 200). */
  historyLimit?: number;
  /**
   * Hot-scope warning: emit a diagnostic when one scope re-runs `count`
   * times within `windowMs` (default 120 runs / 1000ms — deliberately above
   * animation-frame cadence, so a legitimate rAF-driven scope at 60/s does
   * not cry wolf). `false` disables.
   */
  hotRuns?: { count: number; windowMs: number } | false;
  /**
   * Wide-scope warning: emit a diagnostic when a scope's dependency count
   * reaches this (default 30) — the coarse-read / helper-leak signature.
   * Re-warns only if the count then grows by another 50%. `false` disables.
   */
  wideDeps?: number | false;
  /**
   * Time-budget warning: emit a diagnostic when one scope's summed self-time
   * inside `windowMs` exceeds `budgetMs` (default 8ms / 1000ms — half a frame
   * spent in one scope). Unlike `hotRuns` this catches the few-but-expensive
   * scope that run counts miss. `false` disables.
   */
  hotTime?: { budgetMs: number; windowMs: number } | false;
  /**
   * Unstable-output warning: emit a diagnostic when a memo commits a
   * referentially-new but shallowly-equivalent plain object/array on this
   * many consecutive runs (default 4). Such a memo's equality gate never
   * closes — every subscriber re-runs on every upstream change — which makes
   * it a fan-out amplifier that is otherwise only findable by profiling.
   * `false` disables.
   */
  unstableMemos?: number | false;
  /**
   * Written-fan-out warning: emit a diagnostic when a committed root
   * invalidation (write, refresh, async landing) reaches a node with at
   * least this many subscribers (default 250). Complements the always-on
   * HUGE_FAN_OUT graph-size warning, specced against it deliberately:
   * HUGE_FAN_OUT fires at LINK time from GRAPH_SIZE_WARN_AT (2000) up —
   * static structure so large it warns even if never written — while this
   * fires at WRITE time from a much lower bar, because fan-out only costs
   * anything when the node actually changes. Once per node, re-warning only
   * on 2x subscriber growth, so the two never spam the same node. `false`
   * disables.
   */
  wideWrites?: number | false;
}

interface AttributedNode {
  _devChange?: ChangeRecord;
  _devSeenSeq?: number;
  _devRunCount?: number;
  _devWinStart?: number;
  _devWinCount?: number;
  _devHotWarned?: boolean;
  _devWideWarnedAt?: number;
  _devTimeWinStart?: number;
  _devTimeWinMs?: number;
  _devTimeWarned?: boolean;
  _devUnstableRuns?: number;
  _devUnstableWarned?: boolean;
  _devWideWriteWarnedAt?: number;
}

let attributionActive = false;

let changeSeq = 0;
let runSeq = 0;
const defaultOptions = {
  log: true,
  stacks: false,
  historyLimit: 200,
  hotRuns: { count: 120, windowMs: 1000 } as { count: number; windowMs: number } | false,
  wideDeps: 30 as number | false,
  hotTime: { budgetMs: 8, windowMs: 1000 } as { budgetMs: number; windowMs: number } | false,
  unstableMemos: 4 as number | false,
  wideWrites: 250 as number | false
};
let options: typeof defaultOptions = { ...defaultOptions };
const listeners = new Set<(event: RerunEvent) => void>();
let history: RerunEvent[] = [];

const now: () => number =
  typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

// Per-recompute frames: recomputes nest (pulls, child creation inside a
// parent's fn), so each frame carries the causes/prev-deps snapshot from
// recomputeStart plus the time its children consumed — the parent subtracts
// child time for honest self-time, the same discipline every profiler uses.
interface RunFrame {
  start: number;
  childMs: number;
  causes: ChangeRecord[] | null; // null on create runs
  prevDeps: unknown[] | null;
  /** Committed value before this run — baseline for the unstable-output check. */
  prevValue: unknown;
}
const frames: RunFrame[] = [];

// Cost aggregates, reset on enable()/disable().
export interface ScopeCost {
  name: string;
  kind: "effect" | "memo";
  runs: number;
  selfMs: number;
  /**
   * Self-time of PLAIN, non-held runs that produced an unchanged value —
   * the recoverable number. Overlay runs (optimistic/transition) are never
   * counted here: an optimistic recompute landing back on the committed
   * value is the mechanism working, not waste.
   */
  wastedMs: number;
  /** Self-time spent in optimistic/transition (overlay) runs. */
  overlayMs: number;
}
export interface WriteCost {
  /** Root cause name (a signal write, async landing, or refresh target). */
  name: string;
  /** Number of downstream re-runs this root triggered. */
  runs: number;
  /** Summed self-time of every downstream re-run it caused. */
  downstreamMs: number;
}
const scopeCosts = new Map<Computed<any>, ScopeCost>();
const writeCosts = new Map<string, WriteCost>();

function rootsOf(causes: ChangeRecord[], out: Set<string>): void {
  for (const c of causes) {
    if (c.kind === "derived" && c.causes && c.causes.length > 0) rootsOf(c.causes, out);
    else out.add(c.name);
  }
}

function recordCosts(event: RerunEvent): void {
  let scope = scopeCosts.get(event.node);
  if (scope === undefined) {
    scope = {
      name: event.nodeName,
      kind: event.nodeKind,
      runs: 0,
      selfMs: 0,
      wastedMs: 0,
      overlayMs: 0
    };
    scopeCosts.set(event.node, scope);
  }
  scope.runs++;
  scope.selfMs += event.selfMs;
  if (event.phase !== "plain") scope.overlayMs += event.selfMs;
  else if (!event.changed && !event.held) scope.wastedMs += event.selfMs;
  const roots = new Set<string>();
  rootsOf(event.causes, roots);
  for (const name of roots) {
    let write = writeCosts.get(name);
    if (write === undefined) writeCosts.set(name, (write = { name, runs: 0, downstreamMs: 0 }));
    write.runs++;
    write.downstreamMs += event.selfMs;
  }
}

function nodeName(node: Signal<any> | Computed<any>): string {
  return (node as AttributedNode & { _name?: string })._name ?? "anonymous";
}

function preview(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "undefined":
      return "undefined";
    case "string":
      return JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v);
    case "number":
    case "boolean":
    case "bigint":
      return String(v);
    case "function":
      return "[function]";
    case "symbol":
      return v.toString();
    default:
      return Array.isArray(v) ? `Array(${v.length})` : `[${v.constructor?.name ?? "object"}]`;
  }
}

function captureStack(): string[] | undefined {
  if (!options.stacks) return undefined;
  const raw = new Error().stack?.split("\n") ?? [];
  // Drop the message line and every frame inside the reactive core; the first
  // remaining frames are the user code that performed the write.
  return raw
    .slice(1)
    .filter(line => !/(?:^|[/\\])(?:packages[/\\])?signals[/\\](src|dist)[/\\]/.test(line))
    .slice(0, 3)
    .map(line => line.trim());
}

/** Sentinel for "no value transition to record" (refresh() stamps). */
const NO_VALUES = Symbol("no-values");

/** Record a root change (setSignal / refresh / async landing) on the node. */
/**
 * Written-fan-out warning — the write-time complement of the always-on
 * HUGE_FAN_OUT link-time warning (see dev.ts). Static fan-out that never
 * writes is harmless; a committed root invalidation reaching hundreds of
 * subscribers re-runs all of them this flush. Uses the dev-maintained
 * `_subCount` from the graph-size diagnostics — no core sites touched.
 * Once per node; re-warns only when the subscriber count has doubled since
 * the last warning, so it cannot spam alongside HUGE_FAN_OUT's own
 * 2000-and-up milestones.
 */
function checkWideWrite(
  node: Signal<any> | Computed<any>,
  kind: Exclude<ChangeKind, "derived">
): void {
  const limit = options.wideWrites;
  if (typeof limit !== "number") return;
  const subs = node._subCount ?? 0;
  const attributed = node as AttributedNode;
  if (subs < limit || subs < (attributed._devWideWriteWarnedAt ?? 0) * 2) return;
  attributed._devWideWriteWarnedAt = subs;
  const verb =
    kind === "refresh" ? "refresh of" : kind === "async" ? "async landing on" : "write to";
  const message =
    `[WIDE_WRITE] ${verb} "${nodeName(node)}" reached ${subs} subscribers — every one ` +
    `re-runs this flush. If consumers ask keyed questions of this value (for example every ` +
    `row comparing against one selected id), invert with createSelector or createProjection ` +
    `so only the keys whose answer flipped update.`;
  emitDiagnostic({
    code: "WIDE_WRITE",
    kind: "perf",
    severity: "warn",
    message,
    nodeName: nodeName(node),
    data: { subscribers: subs, write: kind }
  });
  console.warn(message);
}

function stampWrite(
  node: Signal<any> | Computed<any>,
  kind: Exclude<ChangeKind, "derived">,
  prev: unknown = NO_VALUES,
  value: unknown = NO_VALUES
): void {
  const record: ChangeRecord = { seq: ++changeSeq, kind, name: nodeName(node) };
  if (value !== NO_VALUES) {
    record.prev = prev === NO_VALUES ? undefined : preview(prev);
    record.value = preview(value);
  }
  record.stack = captureStack();
  (node as AttributedNode)._devChange = record;
  // stampWrite is the single funnel for committed root invalidations (sync
  // writes, refresh(), async landings), which makes it the one place the
  // written-fan-out check needs to live.
  checkWideWrite(node, kind);
}

/** Record a derived change (memo produced a new value) with its causes. */
function stampDerived(node: Computed<any>, causes: ChangeRecord[]): void {
  (node as AttributedNode)._devChange = {
    seq: ++changeSeq,
    kind: "derived",
    name: nodeName(node),
    causes
  };
}

/**
 * Collect the deps whose committed change is newer than this node's previous
 * run. Called at recompute entry, while `_deps` still holds the previous
 * run's links. A refresh() stamp on the node itself also counts — that is a
 * self-invalidation, not a dep change.
 */
function collectCauses(el: Computed<any>): ChangeRecord[] {
  const seen = (el as AttributedNode)._devSeenSeq ?? 0;
  const causes: ChangeRecord[] = [];
  const self = (el as AttributedNode)._devChange;
  if (self !== undefined && self.seq > seen && self.kind === "refresh") causes.push(self);
  for (let l = el._deps; l !== null; l = l._nextDep) {
    const change = (l._dep as AttributedNode)._devChange;
    if (change !== undefined && change.seq > seen) causes.push(change);
  }
  return causes;
}

/** Advance the node's seen-cursor to the present. Call after every run. */
function markSeen(el: Computed<any>): void {
  (el as AttributedNode)._devSeenSeq = changeSeq;
}

/** Snapshot the node's current dep identities (call before a run replaces them). */
function captureDeps(el: Computed<any>): unknown[] {
  const deps: unknown[] = [];
  for (let l = el._deps; l !== null; l = l._nextDep) deps.push(l._dep);
  return deps;
}

/**
 * Wide-scope warning — the coarse-read / helper-leak signature: one scope
 * subscribed to dozens of sources re-runs when ANY of them change. Fired from
 * recordRerun for re-runs and directly from recompute for creation runs (a
 * memo can be born too wide). Re-warns only on 50% further growth.
 */
function checkDepWidth(el: Computed<any>): void {
  const limit = options.wideDeps;
  if (limit === false) return;
  let count = 0;
  const names: string[] = [];
  for (let l = el._deps; l !== null; l = l._nextDep) {
    count++;
    if (names.length < 12) names.push(nodeName(l._dep));
  }
  const node = el as AttributedNode;
  if (count < limit || count < (node._devWideWarnedAt ?? 0) * 1.5) return;
  node._devWideWarnedAt = count;
  const kind = (el as { _type?: number })._type ? "effect" : "memo";
  const message =
    `[WIDE_SCOPE_DEPS] ${kind} "${nodeName(el)}" is subscribed to ${count} sources — ` +
    `it re-runs when any of them change. Narrow its reads or split it into smaller memos. ` +
    `Sources: ${names.join(", ")}${count > names.length ? ", …" : ""}`;
  emitDiagnostic({
    code: "WIDE_SCOPE_DEPS",
    kind: "perf",
    severity: "warn",
    message,
    nodeName: nodeName(el),
    data: { depCount: count, deps: names }
  });
  console.warn(message);
}

/**
 * Hot-scope warning — flags a scope that re-ran more than `count` times
 * inside one `windowMs` window. Warned once per window, with the most recent
 * cause chain named so the leaking signal is identified in the message.
 */
function checkHotRuns(el: Computed<any>, event: RerunEvent): void {
  const cfg = options.hotRuns;
  if (cfg === false) return;
  const node = el as AttributedNode;
  const now = Date.now();
  if (node._devWinStart === undefined || now - node._devWinStart > cfg.windowMs) {
    node._devWinStart = now;
    node._devWinCount = 0;
    node._devHotWarned = false;
  }
  node._devWinCount = (node._devWinCount ?? 0) + 1;
  if (node._devHotWarned || node._devWinCount < cfg.count) return;
  node._devHotWarned = true;
  const rootCause = event.causes.map(c => `"${c.name}" (${c.kind})`).join(", ");
  const message =
    `[HOT_SCOPE_RERUNS] ${event.nodeKind} "${event.nodeName}" re-ran ${node._devWinCount} times ` +
    `in ${Math.max(1, now - node._devWinStart)}ms — a hot signal is likely leaking into this ` +
    `scope. Latest cause: ${rootCause || "(untracked pull)"}`;
  emitDiagnostic({
    code: "HOT_SCOPE_RERUNS",
    kind: "perf",
    severity: "warn",
    message,
    nodeName: event.nodeName,
    data: {
      runs: node._devWinCount,
      windowMs: cfg.windowMs,
      causes: event.causes.map(c => c.name)
    }
  });
  console.warn(message);
}

/**
 * Time-budget warning — the counterpart of checkHotRuns for the
 * few-but-expensive scope: warns when one scope's summed self-time within a
 * window exceeds the budget. Warned once per window.
 */
function checkHotTime(el: Computed<any>, event: RerunEvent): void {
  const cfg = options.hotTime;
  if (cfg === false) return;
  const node = el as AttributedNode;
  const at = now();
  if (node._devTimeWinStart === undefined || at - node._devTimeWinStart > cfg.windowMs) {
    node._devTimeWinStart = at;
    node._devTimeWinMs = 0;
    node._devTimeWarned = false;
  }
  node._devTimeWinMs = (node._devTimeWinMs ?? 0) + event.selfMs;
  if (node._devTimeWarned || node._devTimeWinMs < cfg.budgetMs) return;
  node._devTimeWarned = true;
  const rootCause = event.causes.map(c => `"${c.name}" (${c.kind})`).join(", ");
  const message =
    `[HOT_SCOPE_TIME] ${event.nodeKind} "${event.nodeName}" spent ` +
    `${node._devTimeWinMs.toFixed(1)}ms of compute inside one ${cfg.windowMs}ms window ` +
    `(budget ${cfg.budgetMs}ms). Latest cause: ${rootCause || "(untracked pull)"}`;
  emitDiagnostic({
    code: "HOT_SCOPE_TIME",
    kind: "perf",
    severity: "warn",
    message,
    nodeName: event.nodeName,
    data: {
      spentMs: node._devTimeWinMs,
      budgetMs: cfg.budgetMs,
      windowMs: cfg.windowMs,
      causes: event.causes.map(c => c.name)
    }
  });
  console.warn(message);
}

function recordRerun(
  el: Computed<any>,
  causes: ChangeRecord[],
  prevDeps: unknown[],
  timing: { selfMs: number; totalMs: number },
  changed: boolean,
  phase: "plain" | "transition" | "optimistic",
  held: boolean
): void {
  const node = el as AttributedNode;
  // Subscription diff: `prevDeps` was captured at run entry; `_deps` now
  // holds the fresh set. A changed set is the "helper edit changed distant
  // call sites" signal — surfaced per-event and in the console format.
  const newDeps = captureDeps(el);
  const prevSet = new Set(prevDeps);
  const newSet = new Set(newDeps);
  const depsAdded: string[] = [];
  const depsRemoved: string[] = [];
  for (const d of newDeps) if (!prevSet.has(d)) depsAdded.push(nodeName(d as Signal<any>));
  for (const d of prevDeps) if (!newSet.has(d)) depsRemoved.push(nodeName(d as Signal<any>));
  const event: RerunEvent = {
    run: ++runSeq,
    nodeRuns: (node._devRunCount = (node._devRunCount ?? 0) + 1),
    nodeKind: (el as { _type?: number })._type ? "effect" : "memo",
    nodeName: nodeName(el),
    node: el,
    causes,
    depCount: newDeps.length,
    depsAdded,
    depsRemoved,
    selfMs: timing.selfMs,
    totalMs: timing.totalMs,
    changed,
    phase,
    held
  };
  history.push(event);
  if (history.length > options.historyLimit) history.shift();
  recordCosts(event);
  checkHotRuns(el, event);
  checkHotTime(el, event);
  checkDepWidth(el);
  for (const listener of listeners) listener(event);
  if (options.log) console.log(formatRerun(event));
}

function formatCause(cause: ChangeRecord, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth + 1);
  let line = `${pad}← ${cause.kind === "derived" ? "memo" : "signal"} "${cause.name}" ${
    cause.kind === "derived" ? "changed" : cause.kind
  } (#${cause.seq})`;
  if (cause.prev !== undefined) line += ` ${cause.prev} → ${cause.value}`;
  out.push(line);
  if (cause.stack) for (const frame of cause.stack) out.push(`${pad}    ${frame}`);
  if (cause.causes && depth < 10) {
    for (const upstream of cause.causes) formatCause(upstream, depth + 1, out);
  }
}

export function formatRerun(event: RerunEvent): string {
  const out = [
    `[why-run] ${event.nodeKind} "${event.nodeName}" ran (run ${event.nodeRuns}, ` +
      `${event.selfMs.toFixed(2)}ms${event.changed ? "" : ", unchanged"}` +
      `${event.phase === "plain" ? "" : `, ${event.phase}`}${event.held ? ", held" : ""})` +
      (event.causes.length === 0 ? " — no tracked cause (pull or retry)" : "")
  ];
  for (const cause of event.causes) formatCause(cause, 0, out);
  if (event.depsAdded.length > 0 || event.depsRemoved.length > 0) {
    const delta = [
      ...event.depsAdded.map(n => `+"${n}"`),
      ...event.depsRemoved.map(n => `-"${n}"`)
    ].join(" ");
    out.push(`  deps changed: ${delta} (${event.depCount} total)`);
  }
  return out.join("\n");
}

export interface Attribution {
  enable(opts?: AttributionOptions): void;
  disable(): void;
  subscribe(listener: (event: RerunEvent) => void): () => void;
  history(): readonly RerunEvent[];
  /** Re-run history for one node — pass a memo/effect accessor or raw node. */
  why(target: unknown): RerunEvent[];
  /** Current dependency names of one scope — the devtools subscription view. */
  subscriptions(target: unknown): string[];
  /**
   * Aggregated cost tables since enable(): `scopes` ranked by self-time
   * (with `wastedMs` = time spent on unchanged-value runs), `writes` ranked
   * by total downstream re-run time each root write caused.
   */
  costs(): { scopes: ScopeCost[]; writes: WriteCost[] };
  format: typeof formatRerun;
}

/**
 * Values eligible for the unstable-output check: plain objects and arrays
 * only. Promises, iterators, Dates, Maps, class instances etc. all have no
 * (or unrepresentative) own enumerable keys, so a shallow compare would
 * false-positive on them — a fresh Promise is a genuinely new value.
 */
function isPlainShape(v: unknown): v is object {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Shallow structural equivalence, capped so hot paths stay cheap. */
const UNSTABLE_KEY_CAP = 64;
function shallowEquivalent(a: object, b: object): boolean {
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length || arrA.length > UNSTABLE_KEY_CAP) return false;
    for (let i = 0; i < arrA.length; i++) if (arrA[i] !== arrB[i]) return false;
    return true;
  }
  const keys = Object.keys(a);
  if (keys.length > UNSTABLE_KEY_CAP || keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!(key in b) || (a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key])
      return false;
  }
  return true;
}

/**
 * Unstable-output warning — the fan-out amplifier signature: a memo whose
 * committed value is referentially new but structurally identical run after
 * run has an equality gate that never closes, so ALL its subscribers re-run
 * on EVERY upstream change. Checked only on plain (non-overlay) changed runs;
 * a genuinely different value (or a non-plain shape) resets the streak.
 */
function checkUnstableOutput(el: Computed<any>, prevValue: unknown, newValue: unknown): void {
  const limit = options.unstableMemos;
  // typeof guard: an explicit `unstableMemos: undefined` in enable() options
  // clobbers the default through the spread — treat any non-number as off.
  if (typeof limit !== "number") return;
  const node = el as AttributedNode;
  if (
    prevValue === newValue || // paranoia: changed runs should never hit this
    !isPlainShape(prevValue) ||
    !isPlainShape(newValue) ||
    !shallowEquivalent(prevValue, newValue)
  ) {
    node._devUnstableRuns = 0;
    node._devUnstableWarned = false;
    return;
  }
  node._devUnstableRuns = (node._devUnstableRuns ?? 0) + 1;
  if (node._devUnstableWarned || node._devUnstableRuns < limit) return;
  node._devUnstableWarned = true;
  const shape = Array.isArray(newValue) ? "array" : "object";
  const message =
    `[UNSTABLE_MEMO_OUTPUT] memo "${nodeName(el)}" produced a new-but-equivalent ${shape} on ` +
    `${node._devUnstableRuns} consecutive runs — its equality gate never closes, so every ` +
    `subscriber re-runs on every upstream change. Return stable references or pass an ` +
    `\`equals\` option.`;
  emitDiagnostic({
    code: "UNSTABLE_MEMO_OUTPUT",
    kind: "perf",
    severity: "warn",
    message,
    nodeName: nodeName(el),
    data: { runs: node._devUnstableRuns, shape }
  });
  console.warn(message);
}

// The engine's implementation of the core's dev hook points. Installed by
// enable(), uninstalled by disable() — while uninstalled the core pays one
// null check per site and nothing else.
let asyncStartSeq = 0;
let asyncStartTime = 0;
let asyncStartValue: unknown;
const engineHooks: AttributionHooks = {
  recomputeStart(el, create) {
    frames.push({
      start: now(),
      childMs: 0,
      causes: create ? null : collectCauses(el),
      prevDeps: create ? null : captureDeps(el),
      // Mirror recompute's own prev-value resolution: an earlier run in the
      // same flush may still be holding in _pendingValue.
      prevValue: el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value
    });
  },
  derivedChanged(el) {
    const frame = frames[frames.length - 1];
    stampDerived(el, frame !== undefined && frame.causes !== null ? frame.causes : []);
  },
  recomputeEnd(el, _create, changed, optimistic, transition, held) {
    const frame = frames.pop();
    // enable() can land mid-recompute: no opening frame, nothing to report.
    if (frame === undefined) return;
    const totalMs = now() - frame.start;
    if (frames.length > 0) frames[frames.length - 1].childMs += totalMs;
    const selfMs = Math.max(0, totalMs - frame.childMs);
    // Unstable-output check: memos only, non-create, plain runs with a
    // committed change. The fresh value sits in `_pendingValue` for held
    // plain-flush memo commits and in `_value` for direct ones. Overlay runs
    // are excluded — an optimistic re-derive legitimately produces fresh
    // equivalents while the lane settles.
    if (
      frame.causes !== null &&
      changed &&
      !optimistic &&
      !transition &&
      !(el as { _type?: number })._type
    )
      checkUnstableOutput(
        el,
        frame.prevValue,
        el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value
      );
    if (frame.causes !== null)
      recordRerun(
        el,
        frame.causes,
        frame.prevDeps!,
        { selfMs, totalMs },
        changed,
        optimistic ? "optimistic" : transition ? "transition" : "plain",
        held
      );
    // Creation runs still get the wide-scope check: a memo can be born with
    // its coarse-read problem already in place.
    else checkDepWidth(el);
    markSeen(el);
  },
  write(el, prev, value) {
    stampWrite(el, "write", prev, value);
  },
  refreshed(el) {
    stampWrite(el, "refresh");
  },
  asyncStart(el) {
    asyncStartSeq = (el as AttributedNode)._devChange?.seq ?? 0;
    asyncStartTime = el._time;
    asyncStartValue = el._value;
  },
  asyncEnd(el, prev, value, direct) {
    if (direct) {
      // Core calls this unconditionally (hook calls cannot live inside its
      // try blocks — see attribution-hooks.ts), so committed-ness is detected
      // here against the asyncStart snapshot: a direct commit moves `_value`
      // (or `_time`, for a same-reference commit under `equals: false`), and
      // a transition hold parks the value in `_pendingValue`. A landing the
      // equality gate swallowed moves none of them and must leave no stamp.
      const committed =
        el._value !== asyncStartValue ||
        el._time !== asyncStartTime ||
        (el as Computed<any>)._pendingValue === value;
      if (committed) stampWrite(el, "async", prev === undefined ? NO_VALUES : prev, value);
      return;
    }
    // Landed through setSignal: reclassify its "write" stamp as an async
    // landing — but only if it actually stamped (the value changed) since
    // asyncStart; a no-change landing must leave no fresh stamp behind.
    const change = (el as AttributedNode)._devChange;
    if (change !== undefined && change.seq > asyncStartSeq && change.kind === "write")
      stampWrite(el, "async", NO_VALUES, value);
  }
};

export const attribution: Attribution = {
  enable(opts?: AttributionOptions) {
    options = { ...defaultOptions, ...opts };
    attributionActive = true;
    frames.length = 0;
    scopeCosts.clear();
    writeCosts.clear();
    setAttributionHooks(engineHooks);
  },
  disable() {
    attributionActive = false;
    listeners.clear();
    history = [];
    frames.length = 0;
    scopeCosts.clear();
    writeCosts.clear();
    setAttributionHooks(null);
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  history() {
    return history;
  },
  why(target: unknown) {
    const node = ((target as Record<symbol, unknown>)?.[$REFRESH] ?? target) as Computed<unknown>;
    return history.filter(event => event.node === node);
  },
  subscriptions(target: unknown) {
    const node = ((target as Record<symbol, unknown>)?.[$REFRESH] ?? target) as Computed<any>;
    const names: string[] = [];
    for (let l = node?._deps ?? null; l !== null; l = l._nextDep) names.push(nodeName(l._dep));
    return names;
  },
  costs() {
    return {
      scopes: [...scopeCosts.values()].sort((a, b) => b.selfMs - a.selfMs),
      writes: [...writeCosts.values()].sort((a, b) => b.downstreamMs - a.downstreamMs)
    };
  },
  format: formatRerun
};
