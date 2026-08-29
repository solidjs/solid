// @ts-nocheck
// Patch-mode dual driver + list driver (DESIGN-PATCH-CHANNEL.md).
//
// PAY-FOR-USE: this module is retained ONLY by compiled patch-mode output —
// `patchDriver`/`rowProof` imports exist solely in apps built with the
// compiler's patch mode on. Importing it installs the list driver into the
// runtime's insert seam (`installListDriver`); classic apps retain nothing
// but an undefined check. Do not import this module from the always-retained
// runtime graph.
import {
  createOwner,
  onCleanup,
  patchableRaw,
  patchProxyFor,
  registerPatch,
  registerRowOps,
  registerSlotPatch,
  runWithOwner,
  sharedConfig,
  storeHasOptimisticFamily,
  storeIsShallow,
  untrack
} from "solid-js";
import { effect } from "./render.js";
import { installListDriver } from "./client.js";

const PURE_ROW = Symbol.for("solid.pure-row");

// SIDE-EFFECT-FREE ARMING: the dist is a flat bundle, so a module-scope
// install call would be an unshakeable top-level side effect retaining the
// whole driver in every app. Instead ROWPROOF arms the insert seam — it is
// the compiled marker of a patch-mode LIST (stamped at template creation,
// always before the list's insert), and the only consumer of the list
// driver: an unstamped list never engages, so a bundle without rowProof
// needs no driveList. patchDriver deliberately does NOT arm — non-list
// patch templates must not retain the list driver (LIS, row binding, ops
// apply) they can never use.
const arm = () => {
  installListDriver(driveList);
};

export function rowProof<T extends Function>(fn: T): T {
  arm();
  (fn as any)[PURE_ROW] = true;
  return fn;
}

// Patch-mode dual driver (DESIGN-PATCH-CHANNEL.md, PR-C): compiled template
// scopes whose bindings are pure member reads of one subject hand ONE
// compiled body `(next, prev, force) => { compares + writes }` here.
// - Patchable store record: initial force-apply reads the RAW backing (no
//   proxy traffic, no tracking), then the store's own visibility transitions
//   dispatch the body through the patch channel (effect-phase timing, lanes,
//   transition holds — all channel semantics).
// - Anything else (props, signals-derived objects, accessor records): a
//   render effect force-applies the same body; reads through the subject
//   track normally, force short-circuits every compare so `prev` is never
//   dereferenced. Same semantics, different dispatcher.
// Row-bind collector, active while the list driver binds a row.
// - `unbinds`: every patch registration made during the bind (deep rows —
//   the stamped template's one patchDriver on the row record). The driver
//   retains them per row so a REMOVED row's registration is severed even
//   when user code externally retains the record — otherwise the patch
//   keeps firing against detached DOM for the record's lifetime, where
//   classic per-row effects die with the row (audit lifecycle hole).
// - `bodies`: shallow store rows are RAW (no record target to register on),
//   so compiled bodies whose subject IS the row are collected and
//   dispatched by the driver from the array's slot-patch channel.
let rowCollector: { row: any; bodies: any[]; unbinds: (() => void)[] } | null = null;

// Longest-increasing-subsequence over row-ops sources: positions whose rows
// are already in relative order (they stay put; everything else moves).
// Standard patience-sort with predecessor links; -1 sources (new rows) are
// not part of the sequence.
const lisPositions = (sources: number[]) => {
  const n = sources.length;
  const tails: number[] = [];
  const tailsIdx: number[] = [];
  const prev = new Array(n).fill(-1);
  for (let j = 0; j < n; j++) {
    const v = sources[j];
    if (v === -1) continue;
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[j] = tailsIdx[lo - 1];
    tails[lo] = v;
    tailsIdx[lo] = j;
  }
  const stable = new Set<number>();
  let k = tailsIdx.length ? tailsIdx[tails.length - 1] : -1;
  while (k >= 0) {
    stable.add(k);
    k = prev[k];
  }
  return stable;
};

// Patch-mode list driver (DESIGN-PATCH-CHANNEL §3b): drives a keyed store
// array structurally through registerRowOps — create/bind at op-apply, LIS
// moves, node removal — bypassing mapArray and the second (DOM-side) diff.
// Called by the runtime's insert when a `<For>` accessor carries `$ll`
// metadata; returns false to decline (unproven row function, non-store
// subject, hydration mismatch), in which case insert falls through to the
// classic mapArray path by simply calling the accessor.
//
// Row purity is proven at COMPILE time (§3c): the driver engages only for
// row functions carrying the compiler's `rowProof` stamp — one compiled
// template, no reactive or owned work, patches only on the row parameter.
// Rows therefore need no per-row owners: value updates ride each record's
// registered patch, structure rides the array's row-ops channel, and a
// removed row's registrations die with its record. There is no speculative
// build and no runtime probe; `lateClassic` only serves ENGAGED lists whose
// subject later leaves the contract (identity swap to a derived array, a
// shallow<->deep kind switch).
export const driveList = (parent: Node, listFn: any, marker?: Node, lateClassic?: () => void) => {
  const meta = listFn.$ll;
  // Compile-time admission: unstamped row functions never engage.
  if (meta.row?.[PURE_ROW] !== true) return false;
  // `keyed={fn}` rows receive ACCESSORS (the classic contract) — the driver
  // binds rows with raw records, so engaging would hand user code the wrong
  // shape. Decline until the accessor-row binding + compiler grammar for
  // `param().member` bodies lands (identity-ruling follow-up); these rows
  // cannot currently stamp anyway, this is a defensive contract pin.
  if (typeof meta.keyed === "function") return false;
  // The decision read is id-ISOLATED: evaluating `each` can mint compiler
  // memos lazily inside the prop getter (wrapConditionals), and minting them
  // on the ambient chain here would consume a child id the classic path
  // expects to consume later — shifting every subsequent hydration key on
  // decline. A throwaway explicit-id owner absorbs (and disposal discards)
  // anything the read creates.
  const evalOwner = createOwner({ id: "&each" });
  let subject: any = runWithOwner(evalOwner, () => untrack(meta.each));
  (evalOwner as any).dispose();
  let raw = subject != null ? patchableRaw(subject) : undefined;
  if (raw === undefined || !Array.isArray(raw)) return false;
  // OPTIMISTIC families engage (family increment 2): their structural
  // writes emit lane-timed row ops from the override channel, and reverts
  // emit an identity RESYNC (ops === null). The committed backing lags the
  // visible state while optimism is in flight, so the initial bind reads
  // the OPTIMISTIC VIEW through the proxy — classic mapArray reads the same
  // view, and the equivalence matrix holds across writes/reverts/landings.
  const optimistic = storeHasOptimisticFamily(subject);
  if (optimistic) raw = untrack(() => Array.from(subject as any));

  // Hydration precheck (claim + register only — §5): rows are the region's
  // server-rendered elements, claimed positionally through each element's
  // own `_hk` key. V1 supports the whole-parent region (no marker) and
  // requires an exact row count and a clean key on every row; anything else
  // declines to classic hydration. Keys end in the row scope's FIRST child
  // id ("0" — pure rows consume no ids before the root claim), so the row
  // owner's id is the key minus that suffix.
  const hydrating = !!sharedConfig.hydrating;
  // Empty-initial lists have nothing to claim — classic hydration owns them.
  if (hydrating && raw.length === 0) return false;
  let domRows: Element[] | undefined;
  let rowIds: string[] | undefined;
  if (hydrating) {
    if (marker !== undefined) return false;
    domRows = Array.from((parent as Element).children);
    if (domRows.length !== raw.length) return false;
    rowIds = new Array(raw.length);
    for (let i = 0; i < domRows.length; i++) {
      const key = domRows[i].getAttribute("_hk");
      if (key === null || !key.endsWith("0") || key.length < 2) return false;
      rowIds[i] = key.slice(0, -1);
    }
  }

  const rowFn = meta.row;
  const endAnchor = marker ?? null;

  // Shallow store lists: rows are RAW, so compiled bodies are COLLECTED at
  // bind (patchDriver's rowCollector branch) and dispatched from the array's
  // slot-patch channel; `lastBodies` carries each bind's collection to its
  // bookkeeping site.
  const shallow = storeIsShallow(subject);
  let lastBodies: any[] | null = null;
  let lastUnbinds: (() => void)[] | null = null;
  const collectBind = (rec: any, build: () => Node): Node => {
    const prevC = rowCollector;
    rowCollector = { row: shallow ? rec : undefined, bodies: [], unbinds: [] };
    try {
      return build();
    } finally {
      lastBodies = rowCollector.bodies;
      lastUnbinds = rowCollector.unbinds;
      rowCollector = prevC;
    }
  };

  // Engaged. The list owner consumes exactly one child id, mirroring the
  // owner mapArray would have created — subsequent siblings' hydration ids
  // stay aligned on both the engage and (pre-owner) decline paths.
  const listOwner = createOwner();
  let declined = false;
  // Rows bind THEIR OPERATION'S captured record (re-audit 8, P1-2): queued
  // structural work must not index the live subject — a second operation
  // queued before the drain shifts it, binding the wrong record and
  // corrupting every later operation's baseline. Captured raws resolve to
  // their proxies through the list's family lookup.
  const bindRow = (rec: any, claimId?: string): Node => {
    if ("_SOLID_DEV_") {
      // Ownership assertion: a stamped row must attach NOTHING to the list
      // owner — the compiler proved the template, but handler/attribute
      // VALUE expressions are arbitrary user code, and owned work created
      // there (a handler factory calling onCleanup/createEffect) would
      // outlive the row. Snapshot the owner's slots around the real build.
      const o = listOwner as any;
      const prevChild = o._firstChild;
      const prevDisposal = o._disposal;
      const node = collectBind(rec, () =>
        runWithOwner(listOwner, () =>
          claimId !== undefined
            ? (runWithOwner(createOwner({ id: claimId }) as any, () =>
                untrack(() => rowFn(rec))
              ) as Node)
            : (untrack(() => rowFn(rec)) as Node)
        )
      ) as Node;
      if (o._firstChild !== prevChild || o._disposal !== prevDisposal) {
        console.warn(
          "A patch-mode list row created reactive computations or cleanups " +
            "during build (likely a handler/attribute value expression calling " +
            "createEffect/onCleanup). This work attaches to the LIST, not the " +
            "row, and will not dispose when the row is removed. Move owned " +
            "work into effects/refs (which opt the row out of patch mode)."
        );
      }
      return node;
    }
    return collectBind(rec, () =>
      runWithOwner(listOwner, () =>
        claimId !== undefined
          ? (runWithOwner(createOwner({ id: claimId }) as any, () =>
              untrack(() => rowFn(rec))
            ) as Node)
          : (untrack(() => rowFn(rec)) as Node)
      )
    ) as Node;
  };

  let entries: Node[] = new Array(raw.length);
  let rowBodies: any[][] | null = shallow ? new Array(raw.length) : null;
  // Per-row patch unbind handles (deep rows register on their record): run
  // on row removal, contract-leave, and list disposal, so a record the app
  // retains beyond the row cannot keep patching detached DOM.
  let rowUnbinds: (() => void)[][] = new Array(raw.length);
  const runUnbinds = (list: (() => void)[] | undefined) => {
    if (list !== undefined) for (let u = 0; u < list.length; u++) list[u]();
  };
  const unbindAllRows = () => {
    for (let j = 0; j < rowUnbinds.length; j++) runUnbinds(rowUnbinds[j]);
    rowUnbinds = [];
  };
  let prevRaws: any[] = raw.slice();
  // Initial construction severs on throw like update-time builds (re-audit
  // 5, P1-4): without this, rows registered before a throwing row leak
  // their registrations under the never-mounted list — keeping patchCount
  // elevated GLOBALLY (every store's setter-site gate stays hot) long after
  // an error boundary recovers the region.
  let initIdx = 0;
  try {
    if (hydrating) {
      // Claim pass: each bind claims its server row through the row-scoped
      // id (getNextElement resolves the `_hk` registry entry); patchDriver
      // skips the initial apply.
      for (; initIdx < raw.length; initIdx++) {
        entries[initIdx] = bindRow(patchProxyFor(subject, raw[initIdx], initIdx), rowIds![initIdx]);
        if (rowBodies !== null) rowBodies[initIdx] = lastBodies!;
        rowUnbinds[initIdx] = lastUnbinds!;
      }
    } else {
      for (; initIdx < raw.length; initIdx++) {
        const node = bindRow(patchProxyFor(subject, raw[initIdx], initIdx));
        entries[initIdx] = node;
        if (rowBodies !== null) rowBodies[initIdx] = lastBodies!;
        rowUnbinds[initIdx] = lastUnbinds!;
        parent.insertBefore(node, endAnchor);
      }
    }
  } catch (err) {
    unbindAllRows();
    runUnbinds(lastUnbinds ?? undefined);
    for (let j = 0; j < entries.length; j++) {
      const n = entries[j] as ChildNode | undefined;
      if (n !== undefined && n.parentNode === parent) n.remove();
    }
    // Surrender the list's ENTIRE server region (re-audit 7, P2-2): the
    // throwing row's claimed element AND every trailing unclaimed server
    // row belong to this list — a boundary fallback rendering into the
    // region must not sit beside stale server rows.
    if (hydrating && domRows !== undefined) {
      for (let j = initIdx; j < domRows.length; j++) {
        const server = domRows[j] as ChildNode;
        if (server.parentNode === parent) server.remove();
      }
    }
    (listOwner as any).dispose();
    throw err;
  }

  // Synthetic full-window ops by ROW IDENTITY against the retained raws:
  // used by identity swaps (`s.rows = newArr`) and by the optimistic revert
  // RESYNC (ops === null — overrides are gone, the live view is truth, and
  // retention must be rebuilt by identity). RAW identity on both sides:
  // draft-authored permutations produce arrays of row PROXIES and deep
  // ingest stores them verbatim — matching without unwrapping rebuilds
  // every row (JFB keyed-reorder identity gate).
  const identityOps = (nextArr: any[]): { prefix: number; sources: number[] } => {
    const keyOf = (r: any) => {
      const w = r != null ? patchableRaw(r) : undefined;
      return w !== undefined ? w : r;
    };
    // Occurrence-aware (re-audit): duplicate references queue their old
    // indices, each consumed once — first-wins reuse would map ONE retained
    // DOM node to multiple next positions (the later insert steals it).
    const oldIndex = new Map<any, number | number[]>();
    for (let j = 0; j < prevRaws.length; j++) {
      const k = keyOf(prevRaws[j]);
      const existing = oldIndex.get(k);
      if (existing === undefined) oldIndex.set(k, j);
      else if (Array.isArray(existing)) existing.push(j);
      else oldIndex.set(k, [existing, j]);
    }
    const sources = new Array(nextArr.length);
    for (let k = 0; k < nextArr.length; k++) {
      const m = oldIndex.get(keyOf(nextArr[k]));
      if (m === undefined) sources[k] = -1;
      else if (Array.isArray(m)) {
        sources[k] = m.shift()!;
        if (m.length === 1) oldIndex.set(keyOf(nextArr[k]), m[0]);
      } else {
        sources[k] = m;
        oldIndex.delete(keyOf(nextArr[k]));
      }
    }
    return { prefix: 0, sources };
  };
  // Failed-apply baseline flag (re-audit 3, P1-4): a throwing row factory
  // leaves DOM/bookkeeping on the OLD arrangement while the STORE committed
  // the new topology — subsequent positional ops would index against the
  // store's baseline and corrupt retention. Until a full apply succeeds,
  // ops are discarded in favor of an identity resync against prevRaws, and
  // slot ticks are suppressed (the resync rebuild covers their values).
  let resyncNeeded = false;
  const applyOps = (next: any[], ops: { prefix: number; sources: number[] } | null) => {
    if (declined) return;
    if (resyncNeeded) ops = null;
    if (ops === null) ops = identityOps(next);
    const { prefix, sources } = ops;
    // EXCEPTION SAFETY (re-audit 2, P1-3): build every NEW row before any
    // destructive step. A throwing row factory (user template code, a
    // custom-element setter in the initial apply) must leave the DOM and
    // the driver's bookkeeping exactly as they were — staged rows sever
    // their own registrations on the way out, and the throw surfaces to
    // the drain's per-entry isolation like any patch error.
    const built: (Node | undefined)[] = new Array(sources.length);
    const builtBodies: (any[] | undefined)[] | null =
      rowBodies !== null ? new Array(sources.length) : null;
    const builtUnbinds: ((() => void)[] | undefined)[] = new Array(sources.length);
    let j = 0;
    try {
      for (; j < sources.length; j++) {
        const abs = prefix + j;
        const src = sources[j];
        if (src === -1 || (refRebuild && src >= 0 && next[abs] !== prevRaws[src])) {
          built[j] = bindRow(patchProxyFor(subject, next[abs], abs));
          if (builtBodies !== null) builtBodies[j] = lastBodies!;
          builtUnbinds[j] = lastUnbinds!;
        }
      }
    } catch (err) {
      // Sever completed staged rows AND the throwing row's own partial
      // registrations (re-audit 3, P2-5): collectBind's finally published
      // the partial collector before the throw propagated here.
      for (let k = 0; k < j; k++) runUnbinds(builtUnbinds[k]);
      runUnbinds(lastUnbinds ?? undefined);
      resyncNeeded = true;
      throw err;
    }
    // Destructive phase — nothing below throws on healthy nodes.
    const retained = new Set<number>();
    for (let k = 0; k < sources.length; k++) {
      // A refRebuild replacement's old row is NOT retained (rebuilt above).
      if (sources[k] >= 0 && built[k] === undefined) retained.add(sources[k]);
    }
    for (let k = prefix; k < entries.length; k++) {
      if (!retained.has(k)) {
        (entries[k] as ChildNode).remove();
        runUnbinds(rowUnbinds[k]);
      }
    }
    const newEntries: Node[] = new Array(prefix + sources.length);
    const newBodies: any[][] | null =
      rowBodies !== null ? new Array(prefix + sources.length) : null;
    const newUnbinds: (() => void)[][] = new Array(prefix + sources.length);
    for (let i = 0; i < prefix; i++) {
      newEntries[i] = entries[i];
      if (newBodies !== null) newBodies[i] = rowBodies![i];
      newUnbinds[i] = rowUnbinds[i];
    }
    const stable = lisPositions(sources);
    let anchor: Node | null = endAnchor;
    for (let k = sources.length - 1; k >= 0; k--) {
      const abs = prefix + k;
      const src = sources[k];
      let node: Node;
      if (built[k] !== undefined) {
        node = built[k]!;
        if (newBodies !== null) newBodies[abs] = builtBodies![k]!;
        newUnbinds[abs] = builtUnbinds[k]!;
        parent.insertBefore(node, anchor);
      } else {
        node = entries[src];
        if (newBodies !== null) newBodies[abs] = rowBodies![src];
        newUnbinds[abs] = rowUnbinds[src];
        if (!stable.has(k)) parent.insertBefore(node, anchor);
      }
      newEntries[abs] = node;
      anchor = node;
    }
    entries = newEntries;
    if (newBodies !== null) rowBodies = newBodies;
    rowUnbinds = newUnbinds;
    prevRaws = next.slice();
    resyncNeeded = false; // a full successful apply restores the baseline
  };

  let unbindOps = runWithOwner(listOwner, () => registerRowOps(subject, applyOps)) as () => void;

  // IDENTITY SEMANTICS RULING: the driver implements whatever identity the
  // VIEW declared, never the reconcile key's (that would make patch mode a
  // semantic change, not an optimization — the compiler is default-on).
  //   - deep lists: adoption preserves proxy identity per key, so key ops
  //     and reference semantics coincide by construction — nothing to do.
  //   - shallow + reference-keyed (`keyed` absent/true): the records ARE the
  //     identity. A key-aligned slot whose record was REPLACED must rebuild
  //     its row, exactly as classic mapArray does.
  //   - shallow + `keyed={fn}`: replacement under a matching key is a value
  //     tick — patch the row in place (the declared semantics).
  const refRebuild = shallow && typeof meta.keyed !== "function";
  // BUILD BEFORE DESTROY (re-audit 7, P1-6): the old row must stay mounted
  // AND registered until the replacement exists — unbinding first left a
  // throwing factory's slot severed-but-visible (silent staleness, the
  // worst failure shape) plus the partial build's registrations leaked.
  const rebuildSlot = (i: number, rec: any): void => {
    const old = entries[i] as ChildNode;
    let node: Node;
    try {
      node = bindRow(rec);
    } catch (err) {
      // Sever the failed build's own partial registrations (collectBind's
      // finally published them); the old row keeps patching. The armed
      // resync retries through the next event, same as applyOps.
      runUnbinds(lastUnbinds ?? undefined);
      resyncNeeded = true;
      throw err;
    }
    runUnbinds(rowUnbinds[i]);
    rowBodies![i] = lastBodies!;
    rowUnbinds[i] = lastUnbinds!;
    parent.insertBefore(node, old);
    old.remove();
    entries[i] = node;
  };
  // Shallow value channel: a key-aligned slot replaced by reference. Under
  // declared-key semantics this is a value tick — run the row's collected
  // bodies against (next, prev) and adopt the new raw as that slot's
  // identity. Under reference semantics it is a REPLACE — rebuild the row.
  // Structure never lands here (the walk emits misaligned slots as row ops
  // only).
  const applySlot = (i: number, next: any, prev: any) => {
    if (declined) return;
    if (resyncNeeded) {
      // ACTIVE recovery (re-audit 5, P2-5): a value-only fix after a failed
      // apply emits slot ticks but no row ops — suppressing alone would
      // leave the old DOM indefinitely. Resync now; a successful rebuild
      // clears the flag (a repeat throw keeps it for the next event).
      const live = subject != null ? patchableRaw(subject) : undefined;
      if (live !== undefined && Array.isArray(live)) applyOps(live as any[], null);
      return;
    }
    if (refRebuild) {
      rebuildSlot(i, next);
      prevRaws[i] = next;
      return;
    }
    const bodies = rowBodies![i];
    if (bodies !== undefined) {
      for (let b = 0; b < bodies.length; b++) bodies[b](next, prev, false);
    }
    prevRaws[i] = next;
  };
  let unbindSlots = shallow
    ? (runWithOwner(listOwner, () => registerSlotPatch(subject, applySlot)) as () => void)
    : null;

  // Identity swaps (`s.rows = newArr` without reconcile) keep mapArray's
  // keyed semantics: rows matched by RAW IDENTITY retain their DOM; the rest
  // bind/remove through the same LIS apply, as a synthetic full-window op.
  // Created under the list owner: every tracked `each` read can mint getter
  // memos, and the list owner's id counter is private (id-chain neutral).
  runWithOwner(listOwner, () =>
    effect(
      () => meta.each(),
      (value: any) => {
        if (declined || value === subject) return;
        const nextRaw = value != null ? patchableRaw(value) : undefined;
        unbindOps();
        unbindSlots?.();
        // A swap that changes the store KIND (shallow <-> deep) leaves this
        // engagement's channel wiring invalid — treat it like leaving the
        // contract and hand off to classic.
        if (nextRaw !== undefined && Array.isArray(nextRaw) && storeIsShallow(value) !== shallow) {
          for (let j = 0; j < entries.length; j++) (entries[j] as ChildNode).remove();
          entries = [];
          prevRaws = [];
          unbindAllRows();
          subject = value;
          declined = true;
          (listOwner as any).dispose();
          lateClassic?.();
          return;
        }
        if (nextRaw === undefined || !Array.isArray(nextRaw)) {
          // Subject left the driver's contract (e.g. `each` switched from
          // the store array to a DERIVED array — a filtered view). Clear the
          // region and hand the list to the classic path, which renders the
          // current subject and owns it from here on.
          for (let j = 0; j < entries.length; j++) (entries[j] as ChildNode).remove();
          entries = [];
          prevRaws = [];
          unbindAllRows();
          subject = value;
          declined = true;
          (listOwner as any).dispose();
          lateClassic?.();
          return;
        }
        const swapOps = identityOps(nextRaw);
        subject = value;
        // Register the NEW subject's channels BEFORE applying (re-audit 5,
        // P2-6): a throwing row build mid-swap must leave the list
        // recoverable — with channels connected, the next emission triggers
        // the failed-apply resync instead of stranding a dead list.
        unbindOps = runWithOwner(listOwner, () => registerRowOps(subject, applyOps)) as () => void;
        if (shallow)
          unbindSlots = runWithOwner(listOwner, () =>
            registerSlotPatch(subject, applySlot)
          ) as () => void;
        applyOps(nextRaw, swapOps);
      }
    )
  );
  onCleanup(() => {
    unbindOps();
    unbindSlots?.();
    // Sever every row's patch registration, not just the channels: the
    // channel skips disposed-owner entries but never removes them, so a
    // record the app retains past the list would otherwise carry dead
    // entries for its lifetime.
    unbindAllRows();
    (listOwner as any).dispose();
  });
  return true;
};

// Patch-mode dual driver: compiled template scopes whose bindings are pure
// member reads of ONE subject hand a single compiled body
// `(next, prev, force) => { compares + writes }` here.
// - Patchable record (core provides the seams): the initial force-apply
//   reads the raw backing, then the core's own visibility transitions
//   dispatch the body through its patch channel. Under hydration the
//   registration alone arms the record — server HTML already carries
//   current values, so the initial apply is skipped.
// - Anything else (props, derived objects, unaware cores): a dual-phase
//   effect runs the same body — the compute pass calls it with
//   next === prev so every compare fails and it becomes a pure tracked
//   read; the commit pass force-applies, keeping DOM writes in the effect
//   phase where transitions and batching expect them.
export const patchDriver = (subject, body, keys?: string[]) => {
  const raw = patchableRaw(subject, keys);
  if (raw !== undefined) {
    // Hydration is claim + register ONLY (DESIGN-PATCH-CHANNEL §5): the
    // server HTML already carries current values, so the initial force-apply
    // is skipped — no writes, no graph edges.
    let unbind: () => void;
    if (keys !== undefined) {
      // COMPILER MANIFEST (re-audit 7, P1-1): the static read envelope —
      // complete across ternary/logical branches and nested chains, which
      // runtime recording can never guarantee (untaken branches read
      // nothing). No recording proxy; hydration registrations get the
      // envelope up front instead of waiting for a first drain apply.
      //
      // Initial applies read the VISIBLE view (re-audit 9, P1-2): for
      // optimistic-family records the committed raw lags live overrides —
      // a mount after the lane drain must match its siblings, so it reads
      // through the PROXY (untracked; the raw fast path stays for plain
      // records).
      if (!sharedConfig.hydrating) {
        const src = storeHasOptimisticFamily(subject) ? subject : raw;
        untrack(() => body(src, undefined, true));
      }
      unbind = registerPatch(subject, body, keys);
    } else if (!sharedConfig.hydrating) {
      // Manifest-less callers (hand-written registrations): record the
      // EXECUTED read set through the initial force-apply. Incomplete for
      // branch-reading bodies by construction — compiled output always
      // ships the manifest.
      const rkeys = new Set();
      const rec = new Proxy(raw, {
        get(o, k, r) {
          rkeys.add(k);
          return Reflect.get(o, k, r);
        }
      });
      body(rec, undefined, true);
      unbind = registerPatch(subject, body, rkeys);
    } else {
      unbind = registerPatch(subject, body);
    }
    if (rowCollector !== null) rowCollector.unbinds.push(unbind);
    // Ordinary (non-list-row) templates: the registration dies with the
    // registering owner. Drains only SKIP disposed owners — without this,
    // every unmounted patched component leaks its entry on the record (and
    // patchCount never returns to baseline, keeping the setter-site
    // hasPatches() gate on forever). Re-audit blocker 1.
    else onCleanup(unbind);
  } else if (rowCollector !== null && subject === rowCollector.row) {
    rowCollector.bodies.push(body);
    if (!sharedConfig.hydrating) body(subject, undefined, true);
  } else if (keys !== undefined) {
    // Effect fallback, MANIFEST form (re-audit 9, P1-3): the compute pass
    // reads the declared envelope directly — running the body with
    // next === prev is NOT reliably read-only (NaN fields and unstable
    // getters make compares true, firing DOM/custom setters inside a
    // tracked computation and again at commit). The manifest IS the read
    // set, so the compute is exact and pure by construction.
    const paths = keys.map(k => (k.indexOf(".") === -1 ? k : k.split(".")));
    effect(
      () => {
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          if (typeof p === "string") {
            subject?.[p];
          } else {
            let o: any = subject;
            for (let d = 0; d < p.length && o != null; d++) o = o[p[d]];
          }
        }
      },
      () => untrack(() => body(subject, undefined, true))
    );
  } else {
    // Manifest-less fallback (hand-written callers): dual-run compute.
    // Bodies with NaN/unstable reads should pass a manifest instead.
    effect(
      () => body(subject, subject, false),
      // untrack: the commit pass re-evaluates binding expressions by design
      // (force short-circuits compares, not reads) — without it, dev-mode
      // strict-read flags every re-read as an untracked effect-callback read
      // (false positive: the compute pass tracked the same expressions).
      () => untrack(() => body(subject, undefined, true))
    );
  }
};
