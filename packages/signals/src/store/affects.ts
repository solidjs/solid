/**
 * Store — the store half of `affects()` (plan §29, §37; A24 (4), #2882,
 * #2893, #2904).
 *
 * A mark on a store is a mark on nodes (affects.ts: a count on the node, a
 * dependency walk at probe time): `affects(record, key)` marks the slot's
 * leaf; `affects(record)` marks a carrier (the record's `$AFFECTS` leaf)
 * and every live node in the record's subtree — the edges existing readers
 * subscribed through. Coverage is by RAW IDENTITY, not read path (#2882: a
 * captured row proxy, a derived store sharing the source's raw, never read
 * through the declaration's proxy): the identities reachable at the
 * declaration are the mark's `scope`, so a node born inside the window on
 * a covered record inherits the mark (released with the carrier's last),
 * and an untracked probe through a record with no nodes is witnessed into
 * the verdict. A mark declared on a draft (inside a setter) or over an
 * optimistic family walks the view the writer sees.
 *
 * Installed by `store/index.ts`: a program with stores carries it; one
 * without pays nothing (affects.ts asks `GlobalQueue._storeMarks`).
 */
import { GlobalQueue } from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import { getNode, installAffectsHooks, optHooks } from "./store.js";
import { $OWNER, lookupTarget, type StoreFamily, type StoreTarget } from "./target.js";
import { $TARGET, isWrappable } from "./types.js";

type Marked = Signal<any> | Computed<any>;

/** The keyless mark's carrier key: a leaf of the record no read serves. */
const $AFFECTS: unique symbol = Symbol(__DEV__ ? "STORE_AFFECTS" : 0);

/** A live mark's scope: the raw identities it covers (keyless: every record
 * reachable at the declaration; keyed: the owning record's), the nodes born
 * inside its window that inherited it, and — keyed — the one key. Dies with
 * the carrier's last registration. */
interface Scope {
  scope: Set<object>;
  inherited: Marked[];
  key?: PropertyKey;
}
const scopes = new Map<Marked, Scope>();

/** The nodes an `affects(store[, key])` declaration marks (affects.ts
 * registers each). */
function storeMarks(t: StoreTarget, key: PropertyKey | undefined): Marked[] {
  if (key === undefined) {
    const carrier = getNode(t, $AFFECTS);
    let entry = scopes.get(carrier);
    if (entry === undefined) scopes.set(carrier, (entry = { scope: new Set(), inherited: [] }));
    const found: Marked[] = [carrier];
    walk(t.px, entry, found, t.fam, new Set());
    return found;
  }
  const node = t.n?.[key as any] ?? getNode(t, key);
  let entry = scopes.get(node);
  if (entry === undefined) scopes.set(node, (entry = { scope: new Set(), inherited: [], key }));
  entry.scope.add(t.v);
  if (t.pb !== null) entry.scope.add(t.pb);
  return [node];
}

/** The identities reachable from `value` into the scope (the draft's and
 * the committed backing both, when a draft is open; an optimistic family's
 * view), every live node under each record into `found`. Untracked by
 * construction: raws, never traps. */
function walk(
  value: any,
  entry: Scope,
  found: Marked[],
  fam: StoreFamily | null,
  visited: Set<object>
): void {
  if (!isWrappable(value)) return;
  const t: StoreTarget | undefined = value[$TARGET] ?? lookupTarget(value, fam);
  let raw: Record<PropertyKey, any> = t !== undefined ? (t.pb ?? t.v) : value;
  if (visited.has(raw)) return;
  visited.add(raw);
  entry.scope.add(raw);
  if (t !== undefined) {
    if (t.pb !== null) entry.scope.add(t.v);
    // The writer's view: the tick's own unflushed guesses are in motion too.
    if (t.fam?.opt === true) raw = optHooks!.view(t, raw, true);
    const nodes = t.n;
    if (nodes !== null)
      for (const k of Reflect.ownKeys(nodes))
        // Another mark's carrier is its own channel: counting it here would
        // extend that scope's lifetime to this declaration's.
        if (k !== $AFFECTS) found.push(nodes[k as any]);
    const has = t.h;
    if (has !== null) for (const k of Reflect.ownKeys(has)) found.push(has[k as any]);
    if (t.k !== null) found.push(t.k);
    if (t.dk !== null) found.push(t.dk);
    fam = t.fam ?? fam;
  }
  for (const k of Reflect.ownKeys(raw)) {
    if (k === $OWNER) continue;
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (d === undefined || d.get !== undefined) continue;
    walk(d.value, entry, found, fam, visited);
  }
}

/** A live scope covering `t`'s identity (keyed: for `key`). Chained
 * backings (§7b): a view's backing is another store's proxy — marks cover
 * the BASE raw, so every identity along the chain is checked. */
function covering(t: StoreTarget, key: PropertyKey | undefined, skip?: Marked): Marked | null {
  for (const [carrier, entry] of scopes) {
    if (carrier === skip || (entry.key !== undefined && entry.key !== key)) continue;
    for (let r: any = t.v; ; ) {
      if (entry.scope.has(r)) return carrier;
      const inner: StoreTarget | undefined = r?.[$TARGET];
      if (inner === undefined) break;
      const backing = inner.pb ?? inner.v;
      if (backing === r) break;
      r = backing;
    }
  }
  return null;
}

installAffectsHooks({
  // A node born on a record a live mark covers inherits it (released with
  // the carrier's last registration).
  born(t, node, key) {
    if (key === $AFFECTS) return;
    const carrier = covering(t, key, node);
    if (carrier === null) return;
    GlobalQueue._mark!(node);
    scopes.get(carrier)!.inherited.push(node);
  },
  // An untracked probe (`isPending(() => s.x)` with no observer) reading a
  // record a live mark covers: no node carries the mark for it — the
  // verdict is told directly.
  witness(t, key) {
    const own = t.n?.[$AFFECTS as any];
    if ((own !== undefined && own._x !== null && own._x._marks !== 0) || covering(t, key) !== null)
      GlobalQueue._witnessMark!();
  }
});

GlobalQueue._storeMarks = storeMarks;
/** The carrier's last mark released (affects.ts): its scope dies, and the
 * nodes that inherited the mark release theirs. */
GlobalQueue._releaseMarkScope = carrier => {
  const entry = scopes.get(carrier);
  if (entry === undefined) return;
  scopes.delete(carrier);
  GlobalQueue._releaseMarks!(entry.inherited);
};
