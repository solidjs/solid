import { CONFIG_TRANSPARENT } from "./constants.js";
import { DEV } from "./dev.js";
import { getOwner } from "./owner.js";
import type { Owner } from "./types.js";

// Deferred hydration, dependency edges: plain-signal identities.
// While on (`setSignalIdentities`; the server-components client turns it on
// before hydrating), a plain signal created under an id-bearing owner is
// named `<owner id>~<n>`, n counting the plain signals (and plain store
// roots: `createStore` over an object, store/edges.ts) created under that
// owner in its current pass (transparent owners defer to the nearest
// id-bearing one, as child ids do). The server names the same signal the
// same way and restarts the count on every re-run, so an edge it shipped (a
// slot fill read it) matches the client node; the write hook receives the
// node and looks its name up (`signalName`). The count restarts when the owner's pass
// generation (`_depGen`, bumped by every recompute) moves on. Only the
// frames client imports this module, so nothing here ships without it.
// Names live in a side table, not on the node: frames reads them across the
// package boundary, where a mangled field would not survive.
let counts: WeakMap<Owner, [gen: number | undefined, n: number]> | null = null;
const names = new WeakMap<object, string>();

/** @internal The identity of a plain signal named while identities were on. */
export function signalName(node: object | undefined): string | undefined {
  return node === undefined ? undefined : names.get(node);
}

function identify(node: object): void {
  let o = getOwner();
  if (!o) return;
  while (o._config & CONFIG_TRANSPARENT && o._parent) o = o._parent;
  if (o.id == null) return;
  const gen = (o as any)._depGen as number | undefined;
  let c = counts!.get(o);
  if (c === undefined || c[0] !== gen) counts!.set(o, (c = [gen, 0]));
  const sid = o.id + "~" + c[1]++;
  // A store root named twice (one object made into two stores, or a store
  // handed to `createStore`) is one target under two server names: its
  // writes cannot be attributed (an empty name).
  names.set(node, names.has(node) ? "" : sid);
}

/** @internal Name plain signals from now on (`on`), or stop. */
export function setSignalIdentities(on: boolean): void {
  counts = on ? counts || new WeakMap() : null;
  signalHook = on ? identify : null;
}

/**
 * @internal Called with every plain signal `createSignal` makes, and every
 * plain store root `createStore` makes, while set (the namer above). Never
 * set unless `setSignalIdentities` is imported, so a bundle without it keeps
 * only a null check.
 */
export let signalHook: ((node: object) => void) | null = null;

/**
 * @internal Dev only: `watch` is called with every node read while set (the
 * dev hook `onRead`) — the frames client's identity-drift check watches the
 * named signals a deferred occurrence reads as it mounts. A no-op in prod.
 */
export function setReadWatch(watch: ((node: object) => void) | null): void {
  if (__DEV__) DEV.hooks.onRead = watch || undefined;
}
