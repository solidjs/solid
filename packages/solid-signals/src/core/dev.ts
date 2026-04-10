import type { Computed, Link, Owner, Signal } from "./types.js";

export interface DevHooks {
  onOwner?: (owner: Owner) => void;
  onGraph?: (value: any, owner: Owner | null) => void;
  onUpdate?: () => void;
  onStoreNodeUpdate?: (state: any, property: PropertyKey, value: any, prev: any) => void;
}

export interface Dev {
  hooks: DevHooks;
  getChildren: typeof getChildren;
  getSignals: typeof getSignals;
  getParent: typeof getParent;
  getSources: typeof getSources;
  getObservers: typeof getObservers;
}

const hooks: DevHooks = {};

export const DEV: Dev = {
  hooks,
  getChildren,
  getSignals,
  getParent,
  getSources,
  getObservers
};

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
