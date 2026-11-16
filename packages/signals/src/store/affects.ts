/**
 * Store — the store half of `affects()` (plan sec. 29, plan sec. 37; A24 (4), #2882,
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
 * Imported by `affects()`, which installs it on its first store target
 * (#3891, after #3912): a program with stores that never declares a mark
 * carries none of it. It never imports the engine (thin.ts), so a program
 * declaring marks without stores carries this module alone: the store's
 * nodes and records come through `GlobalQueue._storeEngine`, and node birth and the
 * untracked traps reach back through `affectsHooks` (hooks.ts).
 */
import { GlobalQueue, releaseMarksHook } from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import { installAffectsHooks, type AffectsHooks } from "./hooks.js";
import type { StoreTarget } from "./target.js";
import { $THIN } from "./types.js";

type Marked = Signal<any> | Computed<any>;

/** The keyless mark's carrier key: a leaf of the record no read serves. */
const $AFFECTS: unique symbol = Symbol(__DEV__ ? "STORE_AFFECTS" : 0);

/** A live mark's scope: the raw identities it covers (keyless: every record
 * reachable at the declaration; keyed: the owning record's), the nodes born
 * inside its window that inherited it, and — keyed — the one key. Dies with
 * the carrier's last registration. */
interface Scope {
  _scope: Set<object>;
  _inherited: Marked[];
  _key: PropertyKey | undefined;
}
const scopes = new Map<Marked, Scope>();

function scopeOf(carrier: Marked, key: PropertyKey | undefined): Scope {
  let entry = scopes.get(carrier);
  if (entry === undefined)
    scopes.set(carrier, (entry = { _scope: new Set(), _inherited: [], _key: key }));
  return entry;
}

/** The nodes an `affects(store[, key])` declaration marks (affects.ts
 * registers each). */
export function storeMarks(t: StoreTarget, key: PropertyKey | undefined): Marked[] {
  const e = GlobalQueue._storeEngine!;
  const node = e.node(t, key === undefined ? $AFFECTS : key);
  const entry = scopeOf(node, key);
  if (key !== undefined) return (entry._scope.add(t.v), [node]);
  const found: Marked[] = [node];
  const visited = new Set<object>();
  // Untracked by construction: raws and nodes, never traps; the writer's
  // view (a draft's or an optimistic family's guesses) is what is walked.
  const walk = (v: any, fam: any): void => {
    let ct = e.target(v, fam);
    // Another store inside this family's value: the family's own view of
    // it is marked, never that store's data (#4914, A24 (4)).
    let it: any;
    if (fam && ct !== undefined && ct._fam !== fam) ((it = ct), (ct = fam.map.get(v)));
    const raw = it ? v : ct !== undefined ? ct.v : v;
    if (raw === null || typeof raw !== "object" || visited.has(raw)) return;
    visited.add(raw);
    entry._scope.add(raw);
    if (ct !== undefined) {
      // Another mark's carrier is its own channel: counting it here would
      // extend that scope's lifetime to this declaration's.
      if (ct.n !== null)
        for (const k of Reflect.ownKeys(ct.n)) if (k !== $AFFECTS) found.push(ct.n[k as any]);
      if (ct.h !== null) for (const k of Reflect.ownKeys(ct.h)) found.push(ct.h[k as any]);
      if (ct.k !== null) found.push(ct.k);
      if (ct.c) for (const st of e.sub(ct)) walk(st.p, fam);
    }
    if (it)
      for (const k of e.keys(it)) {
        const ft = e.target(e.value(it, k), it._fam);
        if (ft !== undefined) walk(ft.p, fam);
      }
    else if (ct !== undefined) {
      if (!ct.c) for (const k of e.keys(ct)) walk(e.value(ct, k), ct._fam ?? fam);
    } else
      for (const k of Reflect.ownKeys(raw)) {
        const d = Object.getOwnPropertyDescriptor(raw, k)!;
        if (d.get === undefined) walk(d.value, fam);
      }
  };
  e.view(true);
  try {
    walk((t as any).p, t._fam);
  } finally {
    e.view(false);
  }
  return found;
}

/** A live scope covering `t`'s identity (keyed: for `key`). */
function covering(t: StoreTarget, key: PropertyKey | undefined, skip?: Marked): Marked | null {
  for (const [carrier, entry] of scopes) {
    if (carrier === skip || (entry._key !== undefined && entry._key !== key)) continue;
    if (entry._scope.has(t.v)) return carrier;
    // A chained target is covered through the store it reads.
    const c = (t as any).c;
    if (c && entry._scope.has(c[$THIN].v)) return carrier;
    // A view of another store born in the window is covered through the
    // row it was read from.
    for (let p: any = t; (p.c || p.v[$THIN]) && (p = p.u) !== null; )
      if (entry._scope.has(p.v)) return carrier;
  }
  return null;
}

/** The store's side: node birth and the untracked traps call it (store.ts,
 * through `affectsHooks`) — with no live mark too: an empty scope map is
 * no work. */
const hooks: AffectsHooks = {
  // A node born on a record a live mark covers inherits it (released with
  // the carrier's last registration).
  _born(t, node, key) {
    if (scopes.size === 0 || key === $AFFECTS) return;
    const carrier = covering(t, key, node);
    if (!carrier) return;
    GlobalQueue._mark!(node);
    scopes.get(carrier)!._inherited.push(node);
  },
  // An untracked probe (`isPending(() => s.x)` with no observer) reading a
  // record a live mark covers: no node carries the mark for it — the
  // verdict is told directly.
  _witness(t, key) {
    if (t.n?.[$AFFECTS as any]?._x?._marks || covering(t, key)) GlobalQueue._witnessMark!();
  }
};

/** `affects()` calls it before a store-targeted declaration (idempotent). */
export function installStoreAffects(): void {
  installAffectsHooks(hooks);
}

/** The carrier's last mark released (affects.ts): its scope dies, and the
 * nodes that inherited the mark release theirs. */
export function releaseMarkScope(carrier: Marked): void {
  const entry = scopes.get(carrier);
  if (entry === undefined) return;
  scopes.delete(carrier);
  releaseMarksHook!(entry._inherited);
}
