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
  sharedConfig,
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

export const memo = fn => {
  // A memo during a list probe is reactive work (a per-row computation) —
  // disqualify and skip creation; the raw accessor stands in for the
  // guaranteed-discarded probe build.
  if (probing) {
    probeDirty = true;
    return fn;
  }
  return createMemo(() => fn(), syncOptions);
};

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
    // Hydration is claim + register ONLY (DESIGN-PATCH-CHANNEL §5): the
    // server HTML already carries current values, so the initial force-apply
    // is skipped — no writes, no graph edges. The registration alone arms
    // the record for post-hydration transitions.
    if (!sharedConfig.hydrating) body(raw, undefined, true);
    registerPatch(subject, body);
  } else {
    // Effect fallback with correct WRITE TIMING: the compute pass calls the
    // body with next === prev, so every compare fails and it becomes a pure
    // TRACKED READ of each binding expression (eligible expressions are pure
    // member chains — double evaluation is free of side effects); the commit
    // pass force-applies, putting DOM writes in the effect phase where
    // transitions and batching expect them — same split as classic compiled
    // effects, same single compiled body.
    effect(
      () => body(subject, subject, false),
      () => body(subject, undefined, true)
    );
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
export const driveList = (parent: Node, listFn: any, marker?: Node, lateClassic?: () => void) => {
  const meta = listFn.$ll;
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

  // Hydration precheck (claim + register only — §5): rows are the region's
  // server-rendered elements, claimed positionally through each element's
  // own `_hk` key. V1 supports the whole-parent region (no marker) and
  // requires an exact row count and a clean key on every row; anything else
  // declines to classic hydration. Keys end in the row scope's FIRST child
  // id ("0" — pure rows consume no ids before the root claim), so the row
  // owner's id is the key minus that suffix.
  const hydrating = !!sharedConfig.hydrating;
  // Empty-initial lists cannot probe under hydration (nothing to claim,
  // nothing to probe) — classic hydration owns them.
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

  // Purity probe: a dirty or non-blank probe means the template needs
  // reactive work (insert holes, nested components, onCleanup) that would
  // leak without per-row disposal — decline and let mapArray own the list.
  // While probing, that work is recorded-and-skipped rather than performed
  // (see probeGate/effect above), so a declining probe costs one shallow
  // clone even for rows nesting whole component subtrees. Disposing the
  // probe owner neutralizes any patch the bind registered (the channel
  // skips disposed-owner entries).
  //
  // The probe owner carries its OWN detached id scope: an explicit id
  // consumes nothing from the ambient chain, and anything created inside
  // (memos for row ternaries, effects) draws ids from the probe's counter
  // instead of shifting the ambient one — a decline must leave the id chain
  // and claim registry exactly as classic hydration expects them. The probe
  // also runs with hydration suspended (fresh clone, no claims).
  //
  // EMPTY-INITIAL lists engage TENTATIVELY: there is no row to probe, so
  // the probe defers to the first created row (inside the first structural
  // op). A late decline tears the driver down and hands the region to the
  // classic path through `lateClassic`.
  let probed = false;
  const runProbe = (abs: number): Node | undefined => {
    const probe = createOwner({ id: "&probe" });
    const wasProbing = probing;
    probing = true;
    probeDirty = false;
    let node: Node;
    let dirty: boolean;
    const wasHydrating = !!sharedConfig.hydrating;
    if (wasHydrating) sharedConfig.hydrating = false;
    try {
      node = runWithOwner(probe, () => untrack(() => rowFn(subject[abs]))) as Node;
    } finally {
      dirty = probeDirty;
      probing = wasProbing;
      probeDirty = false;
      if (wasHydrating) sharedConfig.hydrating = true;
    }
    if (dirty || !ownerIsBlank(probe as any) || !(node! instanceof Node)) {
      (probe as any).dispose();
      return undefined;
    }
    probed = true;
    // Hydration keeps nothing from the probe (the claim pass rebinds); its
    // clone and registration are discarded with the owner.
    if (wasHydrating) {
      (probe as any).dispose();
      return node!;
    }
    return node!;
  };

  let firstNode: Node | undefined;
  if (raw.length > 0) {
    firstNode = runProbe(0);
    if (firstNode === undefined) return false;
  }

  // Engaged (or tentatively engaged when empty). The list owner consumes
  // exactly one child id, mirroring the owner mapArray would have created —
  // subsequent siblings' hydration ids stay aligned on both the engage and
  // (pre-owner) decline paths.
  const listOwner = createOwner();
  let declined = false;
  const bindRow = (abs: number, claimId?: string): Node =>
    runWithOwner(listOwner, () =>
      claimId !== undefined
        ? (runWithOwner(createOwner({ id: claimId }) as any, () =>
            untrack(() => rowFn(subject[abs]))
          ) as Node)
        : (untrack(() => rowFn(subject[abs])) as Node)
    ) as Node;

  // Late decline (tentative engagement only): the first REAL row proved
  // impure. Nothing driver-owned is in the DOM yet (the empty list rendered
  // nothing; the probe clone was discarded), so teardown is registration-
  // only, and the classic path re-enters with the region clean.
  const lateDecline = () => {
    declined = true;
    unbindOps();
    (listOwner as any).dispose();
    lateClassic?.();
  };

  let entries: Node[] = new Array(raw.length);
  let prevRaws: any[] = raw.slice();
  if (hydrating) {
    // Claim pass: each bind claims its server row through the row-scoped id
    // (getNextElement resolves the `_hk` registry entry); patchDriver skips
    // the initial apply.
    for (let i = 0; i < raw.length; i++) entries[i] = bindRow(i, rowIds![i]);
  } else if (raw.length > 0) {
    entries[0] = firstNode!;
    parent.insertBefore(firstNode!, endAnchor);
    for (let i = 1; i < raw.length; i++) {
      const node = bindRow(i);
      entries[i] = node;
      parent.insertBefore(node, endAnchor);
    }
  }

  const applyOps = (next: any[], ops: { prefix: number; sources: number[] }) => {
    if (declined) return;
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
        if (!probed) {
          // Deferred probe (tentative empty engagement): the first REAL row
          // decides. Rows only ever arrive as pure creates here (the list
          // was empty), so a decline leaves no driver DOM to unwind.
          const probeNode = runWithOwner(listOwner, () => runProbe(abs)) as Node | undefined;
          if (probeNode === undefined) {
            lateDecline();
            return;
          }
          node = probeNode;
        } else node = bindRow(abs);
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
  // Created under the list owner: every tracked `each` read can mint getter
  // memos, and the list owner's id counter is private (id-chain neutral).
  runWithOwner(listOwner, () =>
    effect(
      () => meta.each(),
      (value: any) => {
        if (declined || value === subject) return;
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
    )
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
