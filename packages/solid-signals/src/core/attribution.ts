import { $REFRESH } from "./constants.js";
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
 * Everything here is dev-only and off by default: with attribution disabled
 * the only cost is one boolean check per recompute/write.
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
   * Whether the run committed a changed value. A memo run with
   * `changed: false` was pure waste — the equality cutoff stopped it from
   * notifying anyone; an effect run with `changed: false` computed without
   * firing its effect phase. Summed as `wastedMs` in costs().
   */
  changed: boolean;
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
   * times within `windowMs` (default 60 runs / 1000ms). `false` disables.
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
}

export let attributionActive = false;

let changeSeq = 0;
let runSeq = 0;
const defaultOptions = {
  log: true,
  stacks: false,
  historyLimit: 200,
  hotRuns: { count: 60, windowMs: 1000 } as { count: number; windowMs: number } | false,
  wideDeps: 30 as number | false,
  hotTime: { budgetMs: 8, windowMs: 1000 } as { budgetMs: number; windowMs: number } | false
};
let options: typeof defaultOptions = { ...defaultOptions };
const listeners = new Set<(event: RerunEvent) => void>();
let history: RerunEvent[] = [];

const now: () => number =
  typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

// Self-time bookkeeping: recomputes nest (pulls, child creation inside a
// parent's fn), so each frame tracks the time its children consumed and the
// parent subtracts it — the same discipline every profiler uses.
const timeStarts: number[] = [];
const childTimes: number[] = [];

/** Open a timing frame for a recompute. Must be paired with endTiming(). */
export function beginTiming(): void {
  timeStarts.push(now());
  childTimes.push(0);
}

/** Close the current timing frame; credits total time to the parent frame. */
export function endTiming(): { selfMs: number; totalMs: number } {
  const totalMs = now() - timeStarts.pop()!;
  const childMs = childTimes.pop()!;
  if (childTimes.length > 0) childTimes[childTimes.length - 1] += totalMs;
  return { selfMs: Math.max(0, totalMs - childMs), totalMs };
}

// Cost aggregates, reset on enable()/disable().
export interface ScopeCost {
  name: string;
  kind: "effect" | "memo";
  runs: number;
  selfMs: number;
  /** Self-time of runs that produced an unchanged value — recoverable. */
  wastedMs: number;
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
    scope = { name: event.nodeName, kind: event.nodeKind, runs: 0, selfMs: 0, wastedMs: 0 };
    scopeCosts.set(event.node, scope);
  }
  scope.runs++;
  scope.selfMs += event.selfMs;
  if (!event.changed) scope.wastedMs += event.selfMs;
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
    .filter(line => !/solid-signals[/\\](src|dist)[/\\]/.test(line))
    .slice(0, 3)
    .map(line => line.trim());
}

/** Sentinel for "no value transition to record" (refresh() stamps). */
export const NO_VALUES = Symbol("no-values");

/** Record a root change (setSignal / refresh / async landing) on the node. */
export function stampWrite(
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
}

/** Record a derived change (memo produced a new value) with its causes. */
export function stampDerived(node: Computed<any>, causes: ChangeRecord[]): void {
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
export function collectCauses(el: Computed<any>): ChangeRecord[] {
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
export function markSeen(el: Computed<any>): void {
  (el as AttributedNode)._devSeenSeq = changeSeq;
}

/** Snapshot the node's current dep identities (call before a run replaces them). */
export function captureDeps(el: Computed<any>): unknown[] {
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
export function checkDepWidth(el: Computed<any>): void {
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

export function recordRerun(
  el: Computed<any>,
  causes: ChangeRecord[],
  prevDeps: unknown[],
  timing: { selfMs: number; totalMs: number },
  changed: boolean
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
    changed
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
      `${event.selfMs.toFixed(2)}ms${event.changed ? "" : ", unchanged"})` +
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

export const attribution: Attribution = {
  enable(opts?: AttributionOptions) {
    options = { ...defaultOptions, ...opts };
    attributionActive = true;
    timeStarts.length = 0;
    childTimes.length = 0;
    scopeCosts.clear();
    writeCosts.clear();
  },
  disable() {
    attributionActive = false;
    listeners.clear();
    history = [];
    timeStarts.length = 0;
    childTimes.length = 0;
    scopeCosts.clear();
    writeCosts.clear();
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
