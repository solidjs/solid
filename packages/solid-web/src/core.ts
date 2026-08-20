//@ts-nocheck
import {
  createMemo,
  createOwner,
  createRenderEffect,
  onCleanup,
  ownerIsBlank,
  patchableRaw,
  registerPatch,
  registerRowOps,
  runWithOwner,
  untrack
} from "solid-js";
export {
  getOwner,
  runWithOwner,
  createComponent,
  createRoot as root,
  sharedConfig,
  untrack,
  merge as mergeProps,
  flatten,
  ssrHandleError,
  ssrScope,
  // Hydration-zone components: the frame sink renders server-owned content
  // under NoHydration (no `_hk` keys, no async-value hydration records — the
  // HTML is the data) and re-enters via Hydration for client positions.
  NoHydration,
  Hydration,
  // Context barrier for server-component render roots: user context does not
  // cross (a refetch renders standalone, so t=0 must agree), while boundary
  // plumbing (Loading/Errored/reveal coordination) still does.
  runInServerComponentScope,
  // Reactive-scope creation stamp: the live-hole engine diffs it around a
  // hole evaluation to detect render-once work (owner allocations — memos,
  // boundaries, providers) and latch instead of binding. Stubbed to 0 on the
  // client entry, where the engine never runs.
  creationStamp,
  // Barrier membership read: the document face arms one live-hole engine
  // for the whole render, and this gates minting to holes inside a server
  // component's scope. Stubbed to false on the client entry.
  inServerComponentScope
} from "solid-js";

const transparentOptions = { transparent: true, sync: true };
const syncOptions = { sync: true };
// List-driver purity probe state (see driveList). While a probe is active,
// reactive work is not performed, only RECORDED: any effect or function-
// valued insert disqualifies the row (probeDirty), and its construction is
// skipped outright. Skipping is safe precisely because it disqualifies —
// a dirty probe's DOM is always discarded. This is what keeps probing O(row
// surface): a container row (nested component/For) costs one shallow clone
// instead of recursively building — and re-probing — its entire subtree.
let probing = false;
let probeDirty = false;

// Runtime seam for insert: during a probe, a function accessor (reactive
// hole, component output, nested list) disqualifies and skips; static values
// insert normally so a KEPT (pure) probe row has complete DOM.
export const probeGate = (accessor: unknown) => {
  if (!probing || typeof accessor !== "function") return false;
  probeDirty = true;
  return true;
};

// `scope: true` (set by insert for compiler-tagged hole accessors) makes the
// render effect non-transparent so the hole gets its own id scope, mirroring
// the server's ssrScope owner.
export const effect = (fn, effectFn, options?) => {
  if (probing) {
    probeDirty = true;
    return;
  }
  return createRenderEffect(
    fn,
    effectFn,
    options ? { sync: true, ...options, transparent: !options.scope } : transparentOptions
  );
};

export const memo = fn => createMemo(() => fn(), syncOptions);

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
export const patchDriver = (subject, body) => {
  const raw = patchableRaw(subject);
  if (raw !== undefined) {
    body(raw, undefined, true);
    registerPatch(subject, body);
  } else {
    effect(() => body(subject, undefined, true));
  }
};

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
// metadata; returns false to decline (non-store subject, empty initial list,
// impure row template), in which case insert falls through to the classic
// mapArray path by simply calling the accessor.
//
// Row purity is proven at bind time, not assumed: the first row is created
// under a throwaway owner, and only a BLANK probe (no computations, no
// cleanups — the row is pure compiled writes + patch registration) commits
// the driver. Rows therefore need no per-row owners: value updates ride each
// record's registered patch, structure rides the array's row-ops channel,
// and a removed row's registrations die with its record.
export const driveList = (parent: Node, listFn: any, marker?: Node) => {
  const meta = listFn.$ll;
  let subject: any = untrack(meta.each);
  let raw = subject != null ? patchableRaw(subject) : undefined;
  if (raw === undefined || !Array.isArray(raw) || raw.length === 0) return false;

  const listOwner = createOwner();
  const rowFn = meta.row;
  const endAnchor = marker ?? null;
  const bindRow = (abs: number): Node =>
    runWithOwner(listOwner, () => untrack(() => rowFn(subject[abs]))) as Node;

  // Purity probe on row 0. A dirty or non-blank probe means the template
  // needs reactive work (insert holes, nested components, onCleanup) that
  // would leak without per-row disposal — decline and let mapArray own the
  // list. While probing, that work is recorded-and-skipped rather than
  // performed (see probeGate/effect above), so a declining probe costs one
  // shallow clone even for rows nesting whole component subtrees. Disposing
  // the probe owner also neutralizes any patch the bind registered (the
  // channel skips disposed-owner entries).
  const probe = createOwner();
  const wasProbing = probing;
  probing = true;
  probeDirty = false;
  let firstNode: Node;
  let dirty: boolean;
  try {
    firstNode = runWithOwner(probe, () => untrack(() => rowFn(subject[0]))) as Node;
  } finally {
    dirty = probeDirty;
    probing = wasProbing;
    probeDirty = false;
  }
  if (dirty || !ownerIsBlank(probe as any) || !(firstNode! instanceof Node)) {
    (probe as any).dispose();
    (listOwner as any).dispose();
    return false;
  }

  let entries: Node[] = new Array(raw.length);
  let prevRaws: any[] = raw.slice();
  entries[0] = firstNode;
  parent.insertBefore(firstNode, endAnchor);
  for (let i = 1; i < raw.length; i++) {
    const node = bindRow(i);
    entries[i] = node;
    parent.insertBefore(node, endAnchor);
  }

  const applyOps = (next: any[], ops: { prefix: number; sources: number[] }) => {
    const { prefix, sources } = ops;
    const retained = new Set<number>();
    for (let j = 0; j < sources.length; j++) if (sources[j] >= 0) retained.add(sources[j]);
    for (let j = prefix; j < entries.length; j++) {
      if (!retained.has(j)) (entries[j] as ChildNode).remove();
    }
    const newEntries: Node[] = new Array(prefix + sources.length);
    for (let i = 0; i < prefix; i++) newEntries[i] = entries[i];
    const stable = lisPositions(sources);
    let anchor: Node | null = endAnchor;
    for (let j = sources.length - 1; j >= 0; j--) {
      const abs = prefix + j;
      const src = sources[j];
      let node: Node;
      if (src === -1) {
        node = bindRow(abs);
        parent.insertBefore(node, anchor);
      } else {
        node = entries[src];
        if (!stable.has(j)) parent.insertBefore(node, anchor);
      }
      newEntries[abs] = node;
      anchor = node;
    }
    entries = newEntries;
    prevRaws = next.slice();
  };

  let unbindOps = runWithOwner(listOwner, () => registerRowOps(subject, applyOps)) as () => void;

  // Identity swaps (`s.rows = newArr` without reconcile) keep mapArray's
  // keyed semantics: rows matched by RAW IDENTITY retain their DOM; the rest
  // bind/remove through the same LIS apply, as a synthetic full-window op.
  effect(
    () => meta.each(),
    (value: any) => {
      if (value === subject) return;
      const nextRaw = value != null ? patchableRaw(value) : undefined;
      unbindOps();
      if (nextRaw === undefined || !Array.isArray(nextRaw)) {
        // Subject left the driver's contract; clear the region — the store
        // array is gone, and with it every channel that fed these rows.
        for (let j = 0; j < entries.length; j++) (entries[j] as ChildNode).remove();
        entries = [];
        prevRaws = [];
        subject = value;
        return;
      }
      const oldIndex = new Map<any, number>();
      for (let j = 0; j < prevRaws.length; j++)
        if (!oldIndex.has(prevRaws[j])) oldIndex.set(prevRaws[j], j);
      const sources = new Array(nextRaw.length);
      for (let k = 0; k < nextRaw.length; k++) sources[k] = oldIndex.get(nextRaw[k]) ?? -1;
      subject = value;
      applyOps(nextRaw, { prefix: 0, sources });
      unbindOps = runWithOwner(listOwner, () => registerRowOps(subject, applyOps)) as () => void;
    }
  );
  onCleanup(() => {
    unbindOps();
    (listOwner as any).dispose();
  });
  return true;
};

// Runs `fn` under an owner whose hydration-id chain is rooted at `id`.
// Both builds compose child keys from the owner chain (getNextChildId), so
// the same call on the server (document render) and the client (adopting
// slot render) yields identical `_hk` keys — which is what lets frame slot
// claims match by key regardless of tree position.
export const runWithHydrationScope = (id, fn) => runWithOwner(createOwner({ id }), fn);

// DR-2 value tier, document face: an async slot arg's INLINE read (the fill
// rendering server-side into the document at t=0) must suspend like any
// server async read instead of handing the fill the raw promise. A full
// (async-aware) memo IS that contract: the read throws `NotReadyError` until
// the promise settles, then reads as the settled value — the engine's hole
// machinery catches and re-pulls, so the covering boundary holds exactly as
// it does for any pending server read. `serialize: false` keeps the memo out
// of the hydration payload: the arg already ships once, through the slot
// record (single-copy). The frame sink pre-taps async iterables down to a
// promise of their first yield (markup is the V1 snapshot), so this only
// ever sees thenables.
export const ssrAsyncValue = value => createMemo(() => value, { serialize: false });

// Client CSS reveal gate (dom-expressions docs/client-css-reveal-gating.md):
// reading an unsettled asset promise throws `NotReadyError` so tracked
// contexts (transitions, boundary reveals) hold and retry when it settles;
// no-op once settled. The runtime only calls this while the asset registry
// reports the promise pending, so a settled promise never re-enters the
// async machinery. One async node per promise, shared across readers and
// dropped with the promise (WeakMap). The node is created OUTSIDE the
// calling compute (`runWithOwner(null)`): waitAsset is called from compute
// phases, and a node owned by the computing owner would be disposed by the
// very retry it triggers. Detached creation also keeps it hydration-id
// neutral — it must never consume a child id from the calling owner chain.
const assetGates = new WeakMap();
export const waitAsset = promise => {
  let gate = assetGates.get(promise);
  if (!gate) {
    runWithOwner(null, () => {
      // NOT sync: the node must be async-aware (the promise is the value
      // being awaited; sync nodes reject thenable returns).
      gate = createMemo(() => promise);
    });
    assetGates.set(promise, gate);
  }
  gate();
};
