/**
 * Deferred hydration, dependency edges for stores. Only the frames client
 * imports this module, so nothing here ships without it.
 *
 * A plain store root (`createStore` over an object) is named like a plain
 * signal (core/identities.ts: `<owner id>~<n>`, on the same count), and the
 * whole store goes by that one name: the server records it for any read of
 * the store, at any depth, and a setter call on the store — on its root or
 * on a proxy nested in it — is a write to it. Its readers mount at the
 * setter's entry, before the draft runs, as a plain signal's do.
 */
import { CONFIG_SLOT_NODE } from "../core/constants.js";
import { signalName } from "../core/identities.js";
import type { StoreTarget } from "./target.js";
import { $TARGET, $THIN } from "./types.js";
import { thinParents } from "./thinParents.js";

/**
 * @internal The name of the store `x` belongs to — `x` a store proxy (a
 * setter's entry) or one of its property nodes (the setter notifying it) —
 * or undefined when it has none or it cannot be placed: a projection or
 * optimistic family, a store chained over another store's proxy, a root
 * named twice, or a proxy reached through a store other than the one it
 * was named as the root of.
 */
export function storeName(x: object | undefined): string | undefined {
  if (x === undefined) return undefined;
  let t: StoreTarget | undefined =
    (x as any)._config & CONFIG_SLOT_NODE ? (x as any)._host : (x as any)[$TARGET];
  // SPIKE (thin store): a thin target walks the noted parents instead.
  const thin =
    t === undefined ? (x as any)[$THIN] : t !== undefined && !("px" in t) ? t : undefined;
  if (thin !== undefined) {
    let c: any = thin;
    for (let p; (p = thinParents.get(c)) !== undefined; c = p[0])
      if (c._fam !== null || c.c !== null || signalName(c) !== undefined) return undefined;
    return c._fam !== null || c.c !== null ? undefined : signalName(c) || undefined;
  }
  if (t === undefined) return undefined;
  // Up to the root; a target on the way named as a root of its own is one
  // object in two stores.
  while (t.u !== null) {
    if (t._fam !== null || t.ch || signalName(t) !== undefined) return undefined;
    t = t.u;
  }
  if (t._fam !== null || t.ch) return undefined;
  return signalName(t) || undefined;
}
