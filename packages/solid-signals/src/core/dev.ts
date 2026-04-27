import type { Computed, Link, Owner, Signal } from "./types.js";

export interface DevHooks {
  onOwner?: (owner: Owner) => void;
  onGraph?: (value: any, owner: Owner | null) => void;
  onUpdate?: () => void;
  onStoreNodeUpdate?: (state: any, property: PropertyKey, value: any, prev: any) => void;
}

export type DiagnosticSeverity = "warn" | "error";

export type DiagnosticCode =
  | "STRICT_READ_UNTRACKED"
  | "PENDING_ASYNC_UNTRACKED_READ"
  | "PENDING_ASYNC_FORBIDDEN_SCOPE"
  | "SIGNAL_WRITE_IN_OWNED_SCOPE"
  | "RUN_WITH_DISPOSED_OWNER"
  | "NO_OWNER_CLEANUP"
  | "CLEANUP_IN_FORBIDDEN_SCOPE"
  | "PRIMITIVE_IN_FORBIDDEN_SCOPE"
  | "NO_OWNER_EFFECT"
  | "NO_OWNER_BOUNDARY"
  | "ASYNC_OUTSIDE_LOADING_BOUNDARY"
  | "MISSING_EFFECT_FN";

export type DiagnosticKind = "strict-read" | "async" | "write" | "lifecycle" | "owner";

export interface DiagnosticEvent {
  sequence: number;
  code: DiagnosticCode;
  kind: DiagnosticKind;
  severity: DiagnosticSeverity;
  message: string;
  ownerId?: string;
  ownerName?: string;
  nodeName?: string;
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
}

export interface Dev {
  hooks: DevHooks;
  diagnostics: Diagnostics;
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

const diagnostics: Diagnostics = {
  subscribe(listener) {
    diagnosticListeners.add(listener);
    return () => diagnosticListeners.delete(listener);
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
      getChildren,
      getSignals,
      getParent,
      getSources,
      getObservers
    }
  : (undefined as unknown as Dev);

export function emitDiagnostic(event: Omit<DiagnosticEvent, "sequence">): DiagnosticEvent {
  const entry: DiagnosticEvent = {
    sequence: ++diagnosticSequence,
    ...event
  };
  for (const listener of diagnosticListeners) listener(entry);
  for (const capture of diagnosticCaptures) capture.push(entry);
  return entry;
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
