/**
 * @jsxImportSource @solidjs/web
 *
 * Shared hydration-parity scenarios (#2801).
 *
 * This file is imported by BOTH vitest projects:
 *   - test/server/hydration-harness.spec.tsx  (ssr generate)   — renders each
 *     scenario with renderToStream and writes chunk artifacts to
 *     test/harness/__artifacts__/.
 *   - test/hydration/parity-harness.spec.tsx  (dom generate)   — replays the
 *     artifact chunks into jsdom and hydrates the identically-sourced
 *     component, asserting generic invariants (no hydration warnings, no
 *     client-created nodes, node identity, post-hydration update pass).
 *
 * Because the two projects compile this same source with their respective
 * generates, the harness verifies actual compiler output on both sides —
 * there are no hand-maintained mirrors that could drift.
 *
 * Scenario rules:
 * - Components rebind their update handles (module-level `let`) on every
 *   instantiation, so the hydrate spec can drive post-hydration updates.
 * - Keep async delays short (5-15ms) — the specs own the settle waits.
 */
import {
  createSignal,
  createMemo,
  createProjection,
  createStore,
  Show,
  Switch,
  Match,
  For,
  Loading,
  Errored,
  Repeat
} from "solid-js";
import { Portal, httpStatus, httpHeader, clientOnly, isServer } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type Scenario = {
  name: string;
  App: () => any;
  /** textContent of the container once hydration fully settles */
  expectedText: string;
  /**
   * Override for the "streamed" replay mode. Needed where the two modes
   * legitimately settle to different text — e.g. a live $df swap of a
   * REJECTED fragment splices in the rejection template's single-space
   * text node (dom-expressions' rejection channel), which full-page-loaded
   * hydration never renders.
   */
  expectedTextStreamed?: string;
  /**
   * Tokens the server-rendered HTML must contain. Defaults to expectedText —
   * override for scenarios with client-only content (e.g. Portal), where the
   * settled client DOM legitimately contains text the server never rendered.
   */
  serverText?: string;
  /** client-side update trigger (rebound on every App instantiation) */
  update?: () => void;
  expectedTextAfterUpdate?: string;
  /**
   * CSS selector for elements that sit outside the updated hole and therefore
   * must keep DOM identity across the update pass (recreation = insert
   * bookkeeping drift, #2801 bug 1).
   */
  stableSelector?: string;
  /**
   * scenario involves async/streaming — the hydrate spec replays it in two
   * modes: "loaded" (all chunks applied before hydrate — the full-page
   * refresh case, boundary state settled) and "streamed" (shell, hydrate,
   * then late chunks — live streaming with $df swaps).
   */
  async?: boolean;
  /** known-broken on main; hydrate spec wraps in test.fails */
  knownFailure?: string;
  /** known-broken only in the streamed replay mode */
  knownFailureStreamed?: string;
};

// ---------------------------------------------------------------------------
// 1. Text hole between static text (allocates no ids)
let setCount!: (v: number) => void;
function TextHole() {
  const [count, set] = createSignal(5);
  setCount = set;
  return <div>Count: {count()} end</div>;
}

// ---------------------------------------------------------------------------
// 2. Ternary element child before a static sibling (condition memo, statement form)
let setTern!: (v: boolean) => void;
function TernaryChild() {
  const [on, set] = createSignal(true);
  setTern = set;
  return (
    <div>
      {on() ? <b>yes</b> : <i>no</i>}
      <span>sib</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Logical && element child before a static sibling
let setShown!: (v: boolean) => void;
function LogicalAnd() {
  const [shown, set] = createSignal(true);
  setShown = set;
  return (
    <div>
      {shown() && <h4>title</h4>}
      <span>after</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Nested ternary (inline condition memos in branches)
let setNestedA!: (v: boolean) => void;
function NestedTernary() {
  const [a, setA] = createSignal(true);
  const [b] = createSignal(true);
  setNestedA = setA;
  return (
    <div>
      {a() ? b() ? <b>ab</b> : <i>a-only</i> : <u>none</u>}
      <span>tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Top-level fragment with a dynamic entry (memo hole on both sides)
let setMid!: (v: string) => void;
function FragmentEntries() {
  const [mid, set] = createSignal("mid");
  setMid = set;
  return (
    <>
      <div>first</div>
      {mid()}
      <div>last</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. Component children hole before a component sibling (props.children)
function CCParent(props: { children: any }) {
  return (
    <section>
      {props.children}
      <CCSibling />
    </section>
  );
}
function CCChild() {
  return <span>child</span>;
}
function CCSibling() {
  return <span>sibling</span>;
}
function ComponentChildren() {
  return (
    <CCParent>
      <CCChild />
    </CCParent>
  );
}

// ---------------------------------------------------------------------------
// 7. Show flow control with fallback
let setVisible!: (v: boolean) => void;
function ShowFlow() {
  const [visible, set] = createSignal(true);
  setVisible = set;
  return (
    <div>
      <Show when={visible()} fallback={<p>hidden</p>}>
        <p>shown</p>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. For list with post-hydration append
let setItems!: (v: string[]) => void;
function ForList() {
  const [items, set] = createSignal(["a", "b", "c"]);
  setItems = set;
  return (
    <ul>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 9. Spread with children in the spread object
function SpreadChildren() {
  const props = { class: "sp", children: <em>spread</em> };
  return <div {...props} />;
}

// ---------------------------------------------------------------------------
// 10. Async memo under Loading, element-wrapped content (settled by shell)
let refreshAsyncDiv!: () => void;
function AsyncSettledDiv() {
  const [version, setVersion] = createSignal(0);
  refreshAsyncDiv = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    const v = version();
    await sleep(5);
    return 42 + v;
  });
  return (
    <Loading fallback={<p>loading</p>}>
      <div>Value: {data()}</div>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// 10b. Async memo under Loading that settles BEFORE the shell flush. Every
// other async scenario sleeps, so the boundary always takes the streaming
// path: placeholder in the shell, content in a late <template>, swapped in by
// $df. A memo that resolves on a microtask (a cache hit, a preloaded query)
// never gets a placeholder — the renderer has the value in hand at flush time
// and inlines the content in the shell. That inline shape is the one the
// client has to claim from the document itself rather than adopt from a swap.
let refreshInline!: () => void;
function AsyncInlineSettled() {
  const [version, setVersion] = createSignal(0);
  refreshInline = () => setVersion(v => v + 1);
  const data = createMemo(async () => 42 + version());
  return (
    <Loading fallback={<p>loading</p>}>
      <div>Value: {data()}</div>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// 11. Async memo at fragment root beside loose text (#2801 bug 1, settled case)
let refreshAsyncFrag!: () => void;
function AsyncSettledFragment() {
  const [version, setVersion] = createSignal(0);
  refreshAsyncFrag = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    const v = version();
    await sleep(5);
    return 42 + v;
  });
  return (
    <Loading fallback={<p>loading</p>}>
      Count: {data()} <span>after</span>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// 12. Deferred id-allocating hole before eager id-allocating siblings
// (#2801 bug 2 shape): the async hole defers on the server and retries after
// the eager conditional already advanced the shared parent id counter, so its
// content renders with different _hk than the client allocates in source order.
let refreshBug2!: () => void;
function DeferredBeforeSiblings() {
  const [version, setVersion] = createSignal(0);
  refreshBug2 = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    version();
    await sleep(10);
    return ["x", "y"];
  });
  const [cond] = createSignal(true);
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        {data() ? <strong>{data().length}</strong> : <em>none</em>}
        {cond() && <h4>Title</h4>}
        <span>tail</span>
      </div>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// 13. Bare signal-call text hole before id-allocating siblings. The dom
// generate simplifies `{label()}` to the bare getter `label`, so the scope()
// wrap decision must key off dynamism, not the transformed expression shape —
// otherwise the ssr side scope-wraps while the dom side doesn't and every
// sibling id after the hole shifts (caught live by the rendering example).
let setLabel!: (v: string) => void;
function SignalHoleBeforeSiblings() {
  const [label, set] = createSignal("one");
  setLabel = set;
  const [flag] = createSignal(true);
  return (
    <div>
      <p>Label: {label()}</p>
      {flag() && <h4>Head</h4>}
      <span>tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 13b. Async && condition before a <For> (#2801 bug 2 / PR #2827 shape): the
// compiler-emitted condition memo reads a pending async memo, so the server
// pulls it multiple times (eager create → discovery → resolved) before the
// successful render. Failed pulls must not skew hydration ids — neither the
// h4's own nor the For rows' — relative to the client's single compute.
let setForRows!: (v: string[]) => void;
function AsyncCondBeforeFor() {
  const data = createMemo(async () => {
    await sleep(10);
    return { value: "shown" };
  });
  const [rows, set] = createSignal(["a", "b"]);
  setForRows = set;
  return (
    <Loading fallback={<div>loading</div>}>
      {data().value && <h4>{data().value}</h4>}
      <For each={rows()}>{x => <div>{x}</div>}</For>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// 13c. Sync && condition before a <For> — control for 13b (PR #2827): the
// condition memo resolves on its first pull, so no retry-leak is possible.
// Guards that the single-pull path claims the server h4 in place and the For
// rows' ids stay aligned.
let setSyncForRows!: (v: string[]) => void;
function SyncCondBeforeFor() {
  const [show] = createSignal(true);
  const [rows, set] = createSignal(["a", "b"]);
  setSyncForRows = set;
  return (
    <div>
      {show() && <h4>shown</h4>}
      <For each={rows()}>{x => <div>{x}</div>}</For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 14. Streamed boundary with loose text, marker-bounded between siblings.
// Exercises insert's swapped-region re-claim on the `<!--$-->…<!--/-->` walk:
// the Loading hole shares its parent with static siblings, so after the $df
// swap the re-claimed region must stop at the matching start marker instead
// of swallowing the whole parent.
let refreshBounded!: () => void;
function BoundedStreamedText() {
  const [version, setVersion] = createSignal(0);
  refreshBounded = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    const v = version();
    await sleep(10);
    return 42 + v;
  });
  return (
    <div>
      <span>before </span>
      <Loading fallback={<p>loading</p>}>
        Count: {data()} <span>after</span>
      </Loading>
      <span> tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 15. Falsy `&&` child hole (dom-expressions #532 family). `{count() && <b/>}`
// with count 0 must render "0" on BOTH sides — the server evaluates the raw
// JS expression, so the client's condition-memo wrap has to preserve value
// semantics (`memo(!!left)() ? right : left`, not `memo(!!left)() && right`
// which collapses the falsy left to `false`). The falsy→falsy update is the
// detector: the old collapse never re-renders (memo swallows it, DOM keeps
// the stale adopted "0"), the value-preserving form tracks the raw left in
// the alternate and rewrites the text.
let setZero!: (v: number | string) => void;
function ZeroAndChild() {
  const [count, set] = createSignal<number | string>(0);
  setZero = set;
  return (
    <div>
      {count() && <b>pos</b>}
      <span>tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 16. Falsy `&&` in a component prop (dom-expressions #532 repro shape). The
// consumer branches STRUCTURALLY on `props.value == null`: with the old
// boolean collapse the client sees `false` (not null!), takes the element
// branch, and tries to claim a <p> the server never rendered — client-created
// DOM during hydration. Value-preserving wrap hands through the real
// `undefined` and both sides render the text branch.
function ValueCard(props: { value: any }) {
  return <div>{props.value == null ? "none" : <p>set:{props.value}</p>}</div>;
}
let setVal!: (v: string | undefined) => void;
function FalsyAndProp() {
  const [val, set] = createSignal<string | undefined>(undefined);
  setVal = set;
  return <ValueCard value={val() && val()!.toUpperCase()} />;
}

// ---------------------------------------------------------------------------
// Streamed boundary whose FALLBACK contains dynamic text holes (#2877,
// dom-expressions#542). The fallback serializes with <!--!$--> separator
// comments inside the swap range, so $df's removal walk must stop only at its
// own matching <!--pl-X--> end marker — a scan that halts at the first comment
// of any kind deletes just the pre-separator slice and leaves the rest of the
// fallback in the DOM as permanent debris ("ready42% done").
let refreshDynamicFallback!: () => void;
function DynamicFallbackStream() {
  const [version, setVersion] = createSignal(0);
  refreshDynamicFallback = () => setVersion(v => v + 1);
  const [progress] = createSignal(42);
  const report = createMemo(async () => {
    const v = version();
    await sleep(10);
    return v ? `ready-${v}` : "ready";
  });
  return (
    <div>
      <span>status </span>
      <Loading fallback={<>preparing {progress()}% done</>}>
        <strong>{report()}</strong>
      </Loading>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Streamed boundary whose fallback keeps UPDATING while pending (#2936): the
// fallback's reactive text hole must claim the server-rendered text between
// the placeholder <template> and its <!--pl-X--> end marker and replace it in
// place on every signal update — not append fresh text nodes after the
// claimed one, piling up "012…" debris until the boundary resolves.
export let bumpPendingFallback!: () => void;
function LoadingFallbackReactiveText() {
  const [count, setCount] = createSignal(0);
  bumpPendingFallback = () => setCount(c => c + 1);
  const data = createMemo(async () => {
    await sleep(10);
    return "done";
  });
  return (
    <div>
      <h1>head </h1>
      <Loading fallback={<>{count()}</>}>{data()}</Loading>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal: client-only island (#2876). Server renders nothing for the portal;
// the client renders its children fresh once hydration settles. Mounting into
// a host inside the container lets the harness textContent assertion cover
// the portal content. The host is a signal so the `mount` prop compiles as a
// getter — a bare identifier would be captured (undefined) at creation time,
// before the ref assigns.
//
// The host <section> sits OUTSIDE the <article> that owns the click handler,
// so the update's synthetic click on the portal content can only reach the
// handler through `_$host` logical retargeting — which requires the portal's
// tree anchor to actually connect during hydration. (A dead anchor still
// mounts visible content; this is the assertion that catches it, since real
// DOM bubbling from the host would never touch the <article>.)
let setPortalMsg!: (v: string) => void;
let clickPortalContent!: () => void;
function PortalClientIsland() {
  const [msg, set] = createSignal("modal");
  const [clicks, setClicks] = createSignal(0);
  const [host, setHost] = createSignal<HTMLElement>();
  setPortalMsg = set;
  let b!: HTMLElement;
  clickPortalContent = () => b.click();
  return (
    <div>
      <article onClick={() => setClicks(c => c + 1)}>
        <span>page </span>
        <span>clicks:{clicks()} </span>
        <Portal mount={host()}>
          <b ref={b}>{msg()}</b>
        </Portal>
      </article>
      <section ref={setHost} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal with async children under a settled Loading boundary. The async is
// discovered only after hydration settles (the portal gate defers children);
// the initialized boundary must forward the pending status without regressing
// the page to its fallback, and the portal content pops in when it resolves.
let refreshPortalAsync!: () => void;
function PortalAsyncContent() {
  const [version, setVersion] = createSignal(0);
  const [host, setHost] = createSignal<HTMLElement>();
  refreshPortalAsync = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    const v = version();
    await sleep(10);
    return v ? `late-${v}` : "late";
  });
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <span>body </span>
        <Portal mount={host()}>
          <em>{data()}</em>
        </Portal>
        <section ref={setHost} />
      </div>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// Portal BEFORE id-allocating siblings. The portal's client-side primitives
// allocate hydration ids that the server (which renders nothing) never did —
// unless both sides advance the parent counter identically, every id after
// the portal drifts: the sibling condition's <h4> _hk no longer matches and
// the async memo looks up (or worse, adopts) a serialized value that belongs
// to a different primitive.
let refreshPortalSibling!: () => void;
function PortalBeforeSiblings() {
  const [version, setVersion] = createSignal(0);
  const [host, setHost] = createSignal<HTMLElement>();
  refreshPortalSibling = () => setVersion(v => v + 1);
  const [shown] = createSignal(true);
  const data = createMemo(async () => {
    const v = version();
    await sleep(5);
    return v ? `srv-${v}` : "srv";
  });
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <span>lead </span>
        <Portal mount={host()}>pop</Portal>
        {shown() && <h4>head </h4>}
        <span>{data()}</span>
        <section ref={setHost} />
      </div>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// Portal under Errored — the exact #2876 report shape. The old server throw
// was caught by the boundary and baked the error fallback into the stream;
// the no-op server Portal must render the real content around it.
function PortalUnderErrored() {
  const [host, setHost] = createSignal<HTMLElement>();
  return (
    <Errored fallback={<p>err-fallback</p>}>
      <div>
        <span>safe </span>
        <Portal mount={host()}>tip</Portal>
        <section ref={setHost} />
      </div>
    </Errored>
  );
}

// ---------------------------------------------------------------------------
// Client-sourced async memo feeding a derived store WITHOUT ssrSource (the
// midival Discord report shape): the server never runs the memo (reads
// undefined → guard → seed), serializes the seed as the store's settled
// truth, and the client must still re-derive once the client-only source
// settles post-hydration. `connect` deliberately constructs its promise via
// the GLOBAL Promise binding at call time — transpiled libraries (midival's
// __async helper) do exactly this, so if the memo's first compute lands
// inside subFetch's mocked-Promise window it latches a never-settling
// MockPromise and the store stays frozen at the seed.
function ClientSourceDerivedStore() {
  const connect = () =>
    new Promise<{ inputs: string[] }>(r => setTimeout(() => r({ inputs: ["piano"] }), 10));
  // `loadingValue: undefined` is the declared commit #0 (required for
  // "client" sources, #2981) — the "declare the undefined in the type and
  // branch" pattern; the store derive below guards it.
  const access = createMemo<{ inputs: string[] } | undefined>(() => connect(), {
    ssrSource: "client",
    loadingValue: undefined
  });
  const [store] = createStore<{ inputs: string[] }>(
    () => {
      const a = access();
      if (!a) return { inputs: [] };
      return { inputs: [...a.inputs] };
    },
    { inputs: [] }
  );
  return <div>Inputs: {store.inputs.join(",") || "none"}</div>;
}

// ---------------------------------------------------------------------------
// HTTP response primitives among id-bearing siblings. `httpStatus`/`httpHeader`
// are bare scope-tied calls: the ssr compile of this file resolves them to the
// server implementations (writing to the request event's response head — the
// harness server spec provides one), the dom compile to the client no-ops.
// Neither side may allocate anything reactive: a no-op that consumed a
// hydration id would shift every sibling key after the call site — the bug
// class that bit client-only reactive work twice recently (Portal, clientOnly).
let setHttpLabel!: (v: string) => void;
function HttpPrimitivesSiblings() {
  const [label, set] = createSignal("ok");
  setHttpLabel = set;
  httpStatus(404, "Not Found");
  httpHeader("cache-control", "no-store");
  return (
    <div>
      <span>before </span>
      <b>{label()}</b>
      <span> after</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Same primitives called INSIDE a streamed <Loading> boundary's content — the
// region where hydration-id drift historically surfaces (placeholder shell,
// late <template> + $df swap, claims racing the reveal).
let refreshHttpStream!: () => void;
function HttpPrimitivesStreamed() {
  const [version, setVersion] = createSignal(0);
  refreshHttpStream = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    const v = version();
    await sleep(10);
    return 42 + v;
  });
  const Inner = () => {
    httpStatus(404, "Not Found");
    httpHeader("x-streamed", "yes");
    return (
      <div>
        <span>head</span> Value: {data()} <span>tail</span>
      </div>
    );
  };
  return (
    <Loading fallback={<p>loading</p>}>
      <Inner />
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// clientOnly with an ELEMENT fallback between id-bearing siblings. The server
// renders only the fallback (never invokes the importer); the import never
// resolves on the client, so the fallback is the settled state — the
// server-rendered <button> must be ADOPTED by the hydration pass (same node,
// claimed, no fresh client DOM), not orphaned and replaced by a client copy.
// This is the load-bearing property of clientOnly's hydration gate: the
// fallback renders DURING the walk so its compiled template claims server DOM.
const NeverWidget = clientOnly(() => new Promise<{ default: (props: {}) => any }>(() => {}));
function ClientOnlyElementFallback() {
  return (
    <div>
      <span>lead </span>
      <NeverWidget fallback={<button>fb</button>} />
      <span> tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// clientOnly whose module RESOLVES, followed by a reactive element hole. The
// post-settle swap (fallback → widget) must not desync insert bookkeeping for
// siblings AFTER the clientOnly: when the sibling's hole later flips its
// element, insert must REPLACE the old element (single node), not leave it
// orphaned in place and append a fresh copy beside it. Found via a refresh
// hot-swap of a component following a hydrated clientOnly (the duplicated
// node surfaced there first), but any signal-driven element swap hits it.
const ResolvingWidget = clientOnly(() =>
  Promise.resolve({ default: (_props: {}) => <b>widget</b> })
);
let setSiblingSwap: (v: boolean) => void;
function ClientOnlySiblingUpdate() {
  const [sw, setSw] = createSignal(true);
  setSiblingSwap = setSw;
  return (
    <div>
      <span>lead </span>
      <ResolvingWidget fallback={<button>fb</button>} />
      {sw() ? <em>one</em> : <q>two</q>}
      <span> tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// #3010's shape on the 2.0 runtime: a TOP-LEVEL FRAGMENT whose first entry is
// a clientOnly component and whose next sibling is a suspending boundary. On
// 1.x this desynced hydration keys (the clientOnly rendered nothing on the
// server while the client walked past it differently) and the suspending
// sibling's DOM could not be found — the app was replaced by the error
// boundary. 2.0's id namespaces must keep the boundary claimable regardless
// of the client-only hole before it.
const FragmentWidget = clientOnly(() =>
  Promise.resolve({ default: (_props: {}) => <b>widget </b> })
);
function ClientOnlyBeforeSuspending() {
  const data = createMemo(async () => {
    await sleep(10);
    return "loaded";
  });
  return (
    <>
      <FragmentWidget />
      <Loading fallback={<i>wait</i>}>
        <p>{data()}</p>
      </Loading>
    </>
  );
}

// ---------------------------------------------------------------------------
// A <Loading> whose fragment settles AFTER hydration completes (#2964). The
// boundary renders behind an async gate with NO boundary above it — the
// frames-slot / lazy-route shape: the root pass suspends on the gate without
// registering a pending boundary, so global hydration reads "done" while the
// inner boundary (and its still-pending `_fr` fragment) only materialize on
// a later microtask. $df used to discard the late fragment's content once
// done; the hydration runtime's reveal policy (`_$HY.f`: claimed or in-
// progress swaps proceed, unclaimed post-done arrivals are held and replayed
// when their boundary registers) keeps it claimable. Without it, this
// scenario settles blank where the boundary was.
function LateBoundaryAfterDone() {
  const gate = createMemo(async () => {
    await sleep(5);
    return 1;
  });
  const inner = createMemo(async () => {
    await sleep(15);
    return "late content";
  });
  return (
    <div>
      <span>lead </span>
      {gate() && (
        <Loading fallback={<p>waiting</p>}>
          <section>{inner()}</section>
        </Loading>
      )}
      <span> tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Derived store with ssrSource:"client" (#2972): the server must never run
// the source — it renders the seed and serializes nothing — and the client
// re-derives after hydration. The source is async, so a server-side run would
// also hold the stream; the serverText probe catches both failure modes.
// `seedLoadingValue: true` is required for "client" stores (#2981): the seed
// IS what the pre-compute window renders, declared as commit #0.
function StoreSsrSourceClient() {
  const [store] = createStore<{ v: string }>(
    async () => {
      await sleep(10);
      return { v: "computed" };
    },
    { v: "seed" },
    { ssrSource: "client", seedLoadingValue: true }
  );
  return <div>V: {store.v}</div>;
}

// ---------------------------------------------------------------------------
// Derived async store with ssrSource:"server" (#2971): the server awaits the
// source and serializes the settled state; the client adopts it and never
// re-runs the source (the isServer probe would flip the text if it did).
function StoreSsrSourceServer() {
  const [store] = createStore<{ v: string }>(
    async () => {
      await sleep(10);
      return { v: isServer ? "fromServer" : "fromClient" };
    },
    { v: "seed" },
    { ssrSource: "server" }
  );
  return <div>V: {store.v}</div>;
}

// ---------------------------------------------------------------------------
// SYNC source with ssrSource:"server" (the default spelled out): serialization
// is async-only — the code itself is the value transport for sync computes, so
// the client re-runs the source during hydration rather than paying payload
// bytes for a reproducible value. The isServer branch here deliberately breaks
// the purity contract sync computes live under, to make the re-run observable:
// the claimed DOM keeps the server text while the in-memory store holds the
// client value (the probe surfaces it). A deterministic source converges.
let probeSyncStore!: () => void;
function StoreSsrSourceServerSync() {
  const [label, setLabel] = createSignal("?");
  const [store] = createStore<{ v: string }>(
    () => ({ v: isServer ? "fromServer" : "fromClient" }),
    { v: "seed" },
    { ssrSource: "server" }
  );
  probeSyncStore = () => setLabel(store.v);
  return (
    <div>
      V: {store.v} P: {label()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conditional component prop whose branch content consumes hydration ids
// (#2959 sibling case). Both generates now wrap `cond() ? <A/> : <B/>`
// component-prop conditionals in a condition memo, so the memo consumes the
// same child id from the reading scope on server and client. Harmless for
// primitive props, but observable when the branch itself allocates ids —
// here an async memo whose serialized value must be found by id.
let toggleCondProp!: () => void;
function AsyncBadge(props: { tag: string }) {
  const label = createMemo(async () => {
    await sleep(10);
    return `badge-${props.tag}`;
  });
  return <em>{label()}</em>;
}
function CondPropCard(props: { content: any }) {
  return <section>{props.content}</section>;
}
function CondComponentProp() {
  const [cond, setCond] = createSignal(true);
  toggleCondProp = () => setCond(c => !c);
  return (
    <div>
      <Loading fallback={<span>wait</span>}>
        <CondPropCard content={cond() ? <AsyncBadge tag="a" /> : <AsyncBadge tag="b" />} />
      </Loading>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nested ternary in a component prop with function children (#2976): the
// compiled `when` getter allocates a condition memo (`_$memo(() => !!cond)`)
// on EVERY read, and consumers legitimately read a prop getter a different
// number of times on each runtime (Show reads `when` for its condition memo
// and again through the narrowed child accessor; the server reads it once).
// The condition memo must therefore be hydration-id neutral (transparent) —
// if it consumed a child id, every id allocated after the Badge would drift.
// Async sibling content after the badge makes a drift observable (serialized
// lookup by id + claims); the static variant catches the direct claim miss
// (the server span is left unclaimed, the client creates a fresh one).
let toggleBadge!: () => void;
function Badge(props: { required?: boolean; optional?: boolean }) {
  return (
    <Show when={props.required ? "Required" : props.optional ? "Optional" : null}>
      {text => <span>{text()}</span>}
    </Show>
  );
}
function ShowNestedTernary() {
  const [req, setReq] = createSignal(true);
  toggleBadge = () => setReq(r => !r);
  const data = createMemo(async () => {
    await sleep(10);
    return "loaded";
  });
  return (
    <div>
      <Badge required={req()} optional={!req()} />
      <p>Data: {data()}</p>
    </div>
  );
}
function ShowNestedTernaryStatic() {
  return (
    <div>
      <Badge optional />
      <p>tail</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Same class for Switch: each Match's `when` getter is evaluated inside a
// per-match conditionValue memo on the client (children of switchFunc), so
// the server must evaluate them inside real memos at the same slots — a bare
// id burn for switchFunc leaves the getters allocating inside the value memo
// instead, drifting the content ids after them.
let toggleRoute!: () => void;
function SwitchNestedTernary() {
  const [route, setRoute] = createSignal("a");
  toggleRoute = () => setRoute(r => (r === "a" ? "b" : "a"));
  const data = createMemo(async () => {
    await sleep(10);
    return "sdata";
  });
  // Both branches nest a ternary so the compiler memo-wraps the evaluated
  // `when` (static-branch conditionals compile bare and never allocate).
  return (
    <div>
      <Switch fallback={<span>none</span>}>
        <Match when={route() === "a" ? "Alpha" : route() === "z" ? "Zed" : null}>
          {t => <span>{t()}</span>}
        </Match>
        <Match when={route() === "b" ? "Beta" : route() === "c" ? "Gamma" : null}>
          {t => <span>{t()}</span>}
        </Match>
      </Switch>
      <p>D: {data()}</p>
    </div>
  );
}

// Loading: the `fallback` getter is evaluated by boundary internals on both
// runtimes — pins that an allocation-capable fallback getter doesn't drift
// the ids of the boundary content or anything after it.
function LoadingFallbackTernary() {
  const [note] = createSignal("a");
  const data = createMemo(async () => {
    await sleep(30);
    return "ldata";
  });
  return (
    <div>
      <Loading fallback={note() === "a" ? "wait-a" : note() === "b" ? "wait-b" : "wait"}>
        <p>L: {data()}</p>
      </Loading>
      <p>tail</p>
    </div>
  );
}

// For: the `each` getter goes straight into mapArray on both runtimes — this
// pins that both implementations evaluate it under id-matched owners when the
// getter allocates (nested ternary → compiled condition memo).
let toggleList!: () => void;
function ForNestedTernary() {
  const [mode, setMode] = createSignal("a");
  toggleList = () => setMode(m => (m === "a" ? "b" : "a"));
  const data = createMemo(async () => {
    await sleep(10);
    return "fdata";
  });
  return (
    <div>
      <For each={mode() === "a" ? ["x", "y"] : mode() === "b" ? ["z"] : []}>
        {item => <span>{item}</span>}
      </For>
      <p>D: {data()}</p>
    </div>
  );
}

// Store-shaped async iterable (createProjection over an async generator)
// rendered via Repeat. The server serializes the first yield as the full
// snapshot (the one row the fragment's HTML shows) and every later yield as
// index patches on the projection's data stream. In the "loaded" replay every
// patch is buffered before hydrate() — the delayed-client-script case — and
// the buffered replay must not run ahead of Repeat's hydration-time claim of
// the snapshot row.
function ProjectionRepeatStream() {
  const items = createProjection<{ id: number; text: string }[]>(async function* (state) {
    const data = [
      { id: 1, text: "one" },
      { id: 2, text: "two" },
      { id: 3, text: "three" },
      { id: 4, text: "four" },
      { id: 5, text: "five" }
    ];
    for (const item of data) {
      await sleep(5);
      state.push(item);
      yield;
    }
  }, []);
  return (
    <Loading fallback={<p>loading</p>}>
      <ul>
        <Repeat count={items.length}>
          {i => (
            <li>
              {items[i].id}:{items[i].text}
            </li>
          )}
        </Repeat>
      </ul>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// loadingValue under SSR: the server serves commit #0 — markup flushes with
// the loading value (the boundary never trips), the landing streams as data,
// and the hydrating client is born committed with the same loading value, so
// the claim matches by construction; the serialized landing then closes the
// window on both sides. The placeholder here deliberately flips the Show
// branch so any server/client disagreement about the window corrupts the
// walk instead of just mismatching text.
let refreshLoadingValue!: () => void;
function LoadingValueMemo() {
  const [version, setVersion] = createSignal(0);
  refreshLoadingValue = () => setVersion(v => v + 1);
  const data = createMemo<{ skeleton: boolean; label: string }>(
    async () => {
      const v = version();
      await sleep(5);
      return { skeleton: false, label: `item-${v}` };
    },
    { loadingValue: { skeleton: true, label: "" } }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={!data().skeleton} fallback={<i>skel</i>}>
          <b>{data().label}</b>
        </Show>
        <span>tail</span>
      </div>
    </Loading>
  );
}

// Store form: seedLoadingValue promotes the seed to commit #0 on both sides —
// server markup flushes with the seed (ready: false renders the empty branch),
// the landing streams as snapshot/patch data, and the client store is born
// committed with the same seed before reconciling the landing in.
let refreshLoadingSeedStore!: () => void;
function LoadingSeedStore() {
  const [version, setVersion] = createSignal(0);
  refreshLoadingSeedStore = () => setVersion(v => v + 1);
  const [state] = createStore<{ items: string[]; ready: boolean }>(
    async draft => {
      const v = version();
      await sleep(5);
      draft.items = [`row-${v}`];
      draft.ready = true;
    },
    { items: [], ready: false },
    { seedLoadingValue: true }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={state.ready} fallback={<i>empty</i>}>
          <For each={state.items}>{item => <span>{item}</span>}</For>
        </Show>
        <p>end</p>
      </div>
    </Loading>
  );
}

// Iterator form: the async-generator memo streams yields; with loadingValue
// the shell locks at commit #0 (the placeholder — HTML never advances to V1,
// the first-value lock generalized) while every yield rides the serialized
// stream. The client replay is born committed with the placeholder, claims
// against it, and conflates the buffered yields to the latest.
function LoadingValueIterator() {
  const data = createMemo<{ skeleton: boolean; label: string }>(
    async function* () {
      await sleep(5);
      yield { skeleton: false, label: "iter-first" };
      await sleep(5);
      yield { skeleton: false, label: "iter-final" };
    } as any,
    { loadingValue: { skeleton: true, label: "" } }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={!data().skeleton} fallback={<i>skel</i>}>
          <b>{data().label}</b>
        </Show>
        <span>tail</span>
      </div>
    </Loading>
  );
}

// ssrSource "client" + loadingValue: the server skips the compute but still
// flushes commit #0 (previously the value stayed undefined), and the
// hydrating client's prev-serving wrapper returns the same placeholder while
// hydration is in flight — claim matches — then runs the compute fresh.
let refreshLoadingClientValue!: () => void;
function LoadingValueClientMemo() {
  const [version, setVersion] = createSignal(0);
  refreshLoadingClientValue = () => setVersion(v => v + 1);
  const data = createMemo<{ skeleton: boolean; label: string }>(
    async () => {
      const v = version();
      await sleep(5);
      return { skeleton: false, label: `client-${v}` };
    },
    // No cast: the loadingValue overload types this accessor as never-undefined
    // even for ssrSource "client" — commit #0 covers the pre-compute window.
    { ssrSource: "client", loadingValue: { skeleton: true, label: "" } }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={!data().skeleton} fallback={<i>skel</i>}>
          <b>{data().label}</b>
        </Show>
        <span>tail</span>
      </div>
    </Loading>
  );
}

// ssrSource "hybrid" + loadingValue on an async generator: the server locks
// the shell at commit #0 and serializes ONLY the first yield (hybrid closes
// the iterator server-side); the client claims against the placeholder,
// adopts the first yield as its serialized value, then the takeover re-runs
// the generator client-side (#2993) — its first yield reproduces the server
// value and the rest continue, settling at the final yield without a refetch.
let refreshLoadingHybridIterator!: () => void;
function LoadingValueHybridIterator() {
  const [version, setVersion] = createSignal(0);
  refreshLoadingHybridIterator = () => setVersion(v => v + 1);
  const data = createMemo<{ skeleton: boolean; label: string }>(
    async function* () {
      const v = version();
      await sleep(5);
      yield { skeleton: false, label: `first-${v}` };
      await sleep(5);
      yield { skeleton: false, label: `final-${v}` };
    } as any,
    { ssrSource: "hybrid", loadingValue: { skeleton: true, label: "" } }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={!data().skeleton} fallback={<i>skel</i>}>
          <b>{data().label}</b>
        </Show>
        <span>tail</span>
      </div>
    </Loading>
  );
}

// Generator projection + seedLoadingValue: the shell locks at the seed
// (commit #0) while the tapped stream serializes the V1 snapshot and patch
// batches; the client store is born committed with the seed and reconciles
// the stream in after the claim.
function LoadingSeedIteratorStore() {
  const [state] = createStore<{ items: string[]; ready: boolean }>(
    async function* () {
      await sleep(5);
      yield { items: ["iter-a"], ready: true };
      await sleep(5);
      yield { items: ["iter-a", "iter-b"], ready: true };
    } as any,
    { items: [], ready: false },
    { seedLoadingValue: true }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={state.ready} fallback={<i>empty</i>}>
          <For each={state.items}>{item => <span>{item}</span>}</For>
        </Show>
        <p>end</p>
      </div>
    </Loading>
  );
}

// ssrSource "client" + seedLoadingValue: the server never runs the derive and
// serves the raw seed (shell shows it); the client's gated derive leaves the
// seed in place through hydration — claim matches — then runs fresh.
let refreshLoadingSeedClient!: () => void;
function LoadingSeedClientStore() {
  const [version, setVersion] = createSignal(0);
  refreshLoadingSeedClient = () => setVersion(v => v + 1);
  const [state] = createStore<{ items: string[]; ready: boolean }>(
    async draft => {
      const v = version();
      await sleep(5);
      draft.items = [`cli-${v}`];
      draft.ready = true;
    },
    { items: [], ready: false },
    { ssrSource: "client", seedLoadingValue: true }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={state.ready} fallback={<i>empty</i>}>
          <For each={state.items}>{item => <span>{item}</span>}</For>
        </Show>
        <p>end</p>
      </div>
    </Loading>
  );
}

// ssrSource "hybrid" + seedLoadingValue: shell locks at the seed, the landed
// state serializes as the hybrid handoff value; the hydrating client serves
// the seed through the claim (the settled ref must stay a thenable), and the
// hybrid takeover re-run — which supersedes the deferred adoption — lands the
// same data itself. RETURN-style derive: hybrid's promise-shaped takeover
// hands values back by returning them (draft mutations on the takeover run go
// to the discarded shadow draft — a pre-existing hybrid constraint).
let refreshLoadingSeedHybrid!: () => void;
function LoadingSeedHybridStore() {
  const [version, setVersion] = createSignal(0);
  refreshLoadingSeedHybrid = () => setVersion(v => v + 1);
  const [state] = createStore<{ items: string[]; ready: boolean }>(
    async () => {
      const v = version();
      await sleep(5);
      return { items: [`hyb-${v}`], ready: true };
    },
    { items: [], ready: false },
    { ssrSource: "hybrid", seedLoadingValue: true }
  );
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        <Show when={state.ready} fallback={<i>empty</i>}>
          <For each={state.items}>{item => <span>{item}</span>}</For>
        </Show>
        <p>end</p>
      </div>
    </Loading>
  );
}

// BARE ssrSource "client" (no loadingValue): the structural form. The source
// suspends server-side as a FINAL hole — the boundary flushes its plain
// fallback with the "$$f" client-continue marker (no fragment, no swap) and
// the client renders the content fresh after hydration, computing the memo
// as a first mount.
let refreshBareClient!: () => void;
function BareClientMemo() {
  const [version, setVersion] = createSignal(0);
  refreshBareClient = () => setVersion(v => v + 1);
  const data = createMemo(
    async () => {
      const v = version();
      await sleep(5);
      return `bare-${v}`;
    },
    { ssrSource: "client" }
  );
  return (
    <Loading fallback={<p>wait</p>}>
      <div>
        <b>{data()}</b>
        <span>tail</span>
      </div>
    </Loading>
  );
}

// Store form of the bare client hole: the pending proxy suspends the boundary
// on the server; the client's gated derive leaves the seed through hydration
// and runs fresh once the gate flips (inside the client-continue render).
function BareClientStore() {
  const [state] = createStore<{ items: string[]; ready: boolean }>(
    async draft => {
      await sleep(5);
      draft.items = ["bare-row"];
      draft.ready = true;
    },
    { items: [], ready: false },
    { ssrSource: "client" }
  );
  return (
    <Loading fallback={<p>wait</p>}>
      <div>
        <Show when={state.ready} fallback={<i>empty</i>}>
          <For each={state.items}>{item => <span>{item}</span>}</For>
        </Show>
        <p>end</p>
      </div>
    </Loading>
  );
}

// A final hole masked by an earlier real async read: the hole suspends on the
// real source first (fragment registers, placeholder streams), and the client
// hole only surfaces on the post-settle re-pull — too late for "$$f", so the
// fragment REJECTS and the client renders the boundary's content fresh after
// hydration (both sources compute client-side).
function BareClientLateFinal() {
  const real = createMemo(async () => {
    await sleep(5);
    return "real";
  });
  const widget = createMemo(
    async () => {
      await sleep(5);
      return "widget";
    },
    { ssrSource: "client" }
  );
  return (
    <Loading fallback={<p>wait</p>}>
      <div>
        <b>{real() && widget()}</b>
        <span>tail</span>
      </div>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// #2997: an async rejection that lands BEFORE the shell flushes, with the
// boundary order Errored > Loading > read. The fragment channel owns the
// error: the server inlines the placeholder away and rejects `<key>_fr`; the
// client re-renders the boundary's subtree as fresh DOM (the memo adopts the
// serialized rejection) and the client-side Errored catches it. The server
// must NOT serialize the error at the Errored id — its async-time fallback
// render has no consumer, and the record would make the hydrating client
// expect fallback DOM that was never emitted (the blank-forever regression).
function PreflushRejection() {
  const data = createMemo(async (): Promise<string> => {
    throw new Error("boom");
  });
  return (
    <div>
      <Errored fallback={<p>caught</p>}>
        <Loading fallback={<i>loading</i>}>
          <span>value:{data()}</span>
        </Loading>
      </Errored>
      <span>tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// #3013: SSR resolves <select value> into `selected` on the matching option
// and strips the invalid attribute at flush. Hydration must claim the select
// cleanly (the stripped attribute and injected `selected` are invisible to
// the client template) and the value effect's microtask assignment must
// agree with the parsed selection; a post-hydration write moves it.
let setLang!: (v: string) => void;
function SelectValue() {
  const [lang, set] = createSignal("fr");
  setLang = set;
  return (
    <div>
      <select value={lang()}>
        <option value="en">English</option>
        <option value="fr">French</option>
      </select>
      <span>{lang()}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// solidjs/solid#3015: a call-shaped innerHTML value must not reserve a
// hydration child id on the server — the client applies innerHTML as a plain
// prop effect with no owner. Pre-fix the server's `_$scope` reservation
// shifted every hydratable sibling after the innerHTML hole by one id, so the
// second icon (and everything after) went unclaimed and updates targeted
// detached DOM.
const makeBadge = (r: number) => `<b>r${r}</b>`;
function InnerHTMLIcon(props: { radius: number }) {
  return <div innerHTML={makeBadge(props.radius)} />;
}
let setInnerHTMLToggle!: (v: boolean) => void;
function InnerHTMLCallSiblings() {
  const [on, set] = createSignal(false);
  setInnerHTMLToggle = set;
  return (
    <div>
      <InnerHTMLIcon radius={1} />
      <InnerHTMLIcon radius={2} />
      <label>{on() ? "on" : "off"}</label>
    </div>
  );
}

export const scenarios: Scenario[] = [
  {
    name: "text-hole",
    App: TextHole,
    expectedText: "Count: 5 end",
    update: () => setCount(6),
    expectedTextAfterUpdate: "Count: 6 end",
    stableSelector: "div"
  },
  {
    name: "ternary-element-child",
    App: TernaryChild,
    expectedText: "yessib",
    update: () => setTern(false),
    expectedTextAfterUpdate: "nosib",
    stableSelector: "div, span"
  },
  {
    name: "logical-and-before-sibling",
    App: LogicalAnd,
    expectedText: "titleafter",
    update: () => setShown(false),
    expectedTextAfterUpdate: "after",
    stableSelector: "div, span"
  },
  {
    name: "nested-ternary",
    App: NestedTernary,
    expectedText: "abtail",
    update: () => setNestedA(false),
    expectedTextAfterUpdate: "nonetail",
    stableSelector: "div, span"
  },
  {
    name: "fragment-dynamic-entry",
    App: FragmentEntries,
    expectedText: "firstmidlast",
    update: () => setMid("MID"),
    expectedTextAfterUpdate: "firstMIDlast",
    stableSelector: "div"
  },
  {
    name: "component-children-before-sibling",
    App: ComponentChildren,
    expectedText: "childsibling"
  },
  {
    name: "show-flow",
    App: ShowFlow,
    expectedText: "shown",
    update: () => setVisible(false),
    expectedTextAfterUpdate: "hidden",
    stableSelector: "div"
  },
  {
    name: "for-list",
    App: ForList,
    expectedText: "abc",
    update: () => setItems(["a", "b", "c", "d"]),
    expectedTextAfterUpdate: "abcd",
    stableSelector: "ul"
  },
  {
    name: "spread-children",
    App: SpreadChildren,
    expectedText: "spread"
  },
  {
    name: "async-settled-element",
    App: AsyncSettledDiv,
    async: true,
    expectedText: "Value: 42",
    update: () => refreshAsyncDiv(),
    expectedTextAfterUpdate: "Value: 43",
    stableSelector: "div"
  },
  {
    name: "async-inline-settled",
    App: AsyncInlineSettled,
    async: true,
    expectedText: "Value: 42",
    update: () => refreshInline(),
    expectedTextAfterUpdate: "Value: 43",
    stableSelector: "div"
  },
  {
    name: "async-settled-fragment-root",
    App: AsyncSettledFragment,
    async: true,
    expectedText: "Count: 42 after",
    update: () => refreshAsyncFrag(),
    expectedTextAfterUpdate: "Count: 43 after",
    stableSelector: "span"
  },
  {
    name: "deferred-hole-before-siblings",
    App: DeferredBeforeSiblings,
    async: true,
    expectedText: "2Titletail",
    update: () => refreshBug2(),
    expectedTextAfterUpdate: "2Titletail",
    stableSelector: "span"
  },
  {
    name: "signal-hole-before-siblings",
    App: SignalHoleBeforeSiblings,
    expectedText: "Label: oneHeadtail",
    update: () => setLabel("two"),
    expectedTextAfterUpdate: "Label: twoHeadtail",
    stableSelector: "div, span, h4"
  },
  {
    name: "async-cond-before-for",
    App: AsyncCondBeforeFor,
    async: true,
    expectedText: "shownab",
    update: () => setForRows(["a", "b", "c"]),
    expectedTextAfterUpdate: "shownabc",
    stableSelector: "h4"
  },
  {
    name: "sync-cond-before-for",
    App: SyncCondBeforeFor,
    expectedText: "shownab",
    update: () => setSyncForRows(["a", "b", "c"]),
    expectedTextAfterUpdate: "shownabc",
    stableSelector: "h4"
  },
  {
    name: "bounded-streamed-text",
    App: BoundedStreamedText,
    async: true,
    expectedText: "before Count: 42 after tail",
    update: () => refreshBounded(),
    expectedTextAfterUpdate: "before Count: 43 after tail",
    stableSelector: "div, span"
  },
  {
    name: "zero-and-child-hole",
    App: ZeroAndChild,
    expectedText: "0tail",
    // falsy→falsy: truthiness doesn't change, the VALUE must still update
    update: () => setZero(""),
    expectedTextAfterUpdate: "tail",
    stableSelector: "div, span"
  },
  {
    name: "falsy-and-prop",
    App: FalsyAndProp,
    expectedText: "none",
    update: () => setVal("hi"),
    expectedTextAfterUpdate: "set:HI",
    stableSelector: "div"
  },
  {
    name: "dynamic-fallback-stream",
    App: DynamicFallbackStream,
    async: true,
    expectedText: "status ready",
    serverText: "status preparing 42% done",
    update: () => refreshDynamicFallback(),
    expectedTextAfterUpdate: "status ready-1",
    stableSelector: "div, span"
  },
  {
    name: "loading-fallback-reactive-text",
    App: LoadingFallbackReactiveText,
    async: true,
    expectedText: "head done",
    serverText: "head 0",
    stableSelector: "div, h1"
  },
  {
    name: "portal-client-island",
    App: PortalClientIsland,
    expectedText: "page clicks:0 modal",
    serverText: "page clicks:0",
    update: () => {
      setPortalMsg("MODAL");
      clickPortalContent();
    },
    expectedTextAfterUpdate: "page clicks:1 MODAL",
    stableSelector: "div, span, section"
  },
  {
    name: "portal-async-content",
    App: PortalAsyncContent,
    async: true,
    expectedText: "body late",
    serverText: "body",
    update: () => refreshPortalAsync(),
    expectedTextAfterUpdate: "body late-1",
    stableSelector: "span, section"
  },
  {
    name: "portal-before-siblings",
    App: PortalBeforeSiblings,
    async: true,
    expectedText: "lead head srvpop",
    serverText: "lead head srv",
    update: () => refreshPortalSibling(),
    expectedTextAfterUpdate: "lead head srv-1pop",
    stableSelector: "h4, section"
  },
  {
    name: "portal-under-errored",
    App: PortalUnderErrored,
    expectedText: "safe tip",
    serverText: "safe",
    stableSelector: "div, span, section"
  },
  {
    name: "client-source-derived-store",
    App: ClientSourceDerivedStore,
    async: true,
    expectedText: "Inputs: piano",
    serverText: "Inputs: none",
    stableSelector: "div"
  },
  {
    name: "http-primitives-siblings",
    App: HttpPrimitivesSiblings,
    expectedText: "before ok after",
    update: () => setHttpLabel("done"),
    expectedTextAfterUpdate: "before done after",
    stableSelector: "div, span, b"
  },
  {
    name: "http-primitives-streamed-loading",
    App: HttpPrimitivesStreamed,
    async: true,
    expectedText: "head Value: 42 tail",
    update: () => refreshHttpStream(),
    expectedTextAfterUpdate: "head Value: 43 tail",
    stableSelector: "div, span"
  },
  {
    name: "client-only-element-fallback",
    App: ClientOnlyElementFallback,
    expectedText: "lead fb tail",
    stableSelector: "div, span, button"
  },
  {
    name: "client-only-sibling-update",
    App: ClientOnlySiblingUpdate,
    async: true,
    expectedText: "lead widgetone tail",
    serverText: "lead fbone tail",
    update: () => setSiblingSwap(false),
    expectedTextAfterUpdate: "lead widgettwo tail",
    stableSelector: "div, span"
  },
  {
    name: "late-boundary-after-done",
    App: LateBoundaryAfterDone,
    async: true,
    expectedText: "lead late content tail",
    serverText: "waiting",
    stableSelector: "div, span"
  },
  {
    name: "store-ssr-source-client",
    App: StoreSsrSourceClient,
    async: true,
    expectedText: "V: computed",
    serverText: "V: seed",
    stableSelector: "div"
  },
  {
    name: "store-ssr-source-server",
    App: StoreSsrSourceServer,
    async: true,
    expectedText: "V: fromServer",
    serverText: "V: fromServer",
    stableSelector: "div"
  },
  {
    name: "store-ssr-source-server-sync",
    App: StoreSsrSourceServerSync,
    expectedText: "V: fromServer P: ?",
    serverText: "V: fromServer P: ?",
    update: () => probeSyncStore(),
    expectedTextAfterUpdate: "V: fromServer P: fromClient",
    stableSelector: "div"
  },
  {
    name: "cond-component-prop",
    App: CondComponentProp,
    async: true,
    expectedText: "badge-a",
    update: () => toggleCondProp(),
    expectedTextAfterUpdate: "badge-b",
    stableSelector: "div, section"
  },
  {
    name: "show-nested-ternary",
    App: ShowNestedTernary,
    async: true,
    expectedText: "RequiredData: loaded",
    update: () => toggleBadge(),
    expectedTextAfterUpdate: "OptionalData: loaded",
    stableSelector: "div, p"
  },
  {
    name: "show-nested-ternary-static",
    App: ShowNestedTernaryStatic,
    expectedText: "Optionaltail",
    stableSelector: "div, span, p"
  },
  {
    name: "loading-fallback-ternary",
    App: LoadingFallbackTernary,
    async: true,
    expectedText: "L: ldatatail",
    serverText: "wait-a tail",
    stableSelector: "div, p"
  },
  {
    name: "for-nested-ternary",
    App: ForNestedTernary,
    async: true,
    expectedText: "xyD: fdata",
    update: () => toggleList(),
    expectedTextAfterUpdate: "zD: fdata",
    stableSelector: "div, p"
  },
  {
    name: "switch-nested-ternary",
    App: SwitchNestedTernary,
    async: true,
    expectedText: "AlphaD: sdata",
    update: () => toggleRoute(),
    expectedTextAfterUpdate: "BetaD: sdata",
    stableSelector: "div, p"
  },
  {
    name: "projection-repeat-stream",
    App: ProjectionRepeatStream,
    async: true,
    expectedText: "1:one2:two3:three4:four5:five",
    serverText: "1:one"
  },
  {
    name: "loading-value-memo",
    App: LoadingValueMemo,
    async: true,
    expectedText: "item-0tail",
    serverText: "skeltail",
    update: () => refreshLoadingValue(),
    expectedTextAfterUpdate: "item-1tail",
    stableSelector: "div, span, b"
  },
  {
    name: "loading-seed-store",
    App: LoadingSeedStore,
    async: true,
    expectedText: "row-0end",
    serverText: "emptyend",
    update: () => refreshLoadingSeedStore(),
    expectedTextAfterUpdate: "row-1end",
    stableSelector: "div, p"
  },
  {
    name: "loading-value-iterator",
    App: LoadingValueIterator,
    async: true,
    expectedText: "iter-finaltail",
    serverText: "skeltail"
  },
  {
    name: "loading-value-client",
    App: LoadingValueClientMemo,
    async: true,
    expectedText: "client-0tail",
    serverText: "skeltail",
    update: () => refreshLoadingClientValue(),
    expectedTextAfterUpdate: "client-1tail",
    stableSelector: "div, span, b"
  },
  {
    name: "loading-value-hybrid-iterator",
    App: LoadingValueHybridIterator,
    async: true,
    expectedText: "final-0tail",
    serverText: "skeltail",
    update: () => refreshLoadingHybridIterator(),
    expectedTextAfterUpdate: "final-1tail",
    stableSelector: "div, span, b"
  },
  {
    name: "loading-seed-iterator-store",
    App: LoadingSeedIteratorStore,
    async: true,
    expectedText: "iter-aiter-bend",
    serverText: "emptyend"
  },
  {
    name: "loading-seed-client-store",
    App: LoadingSeedClientStore,
    async: true,
    expectedText: "cli-0end",
    serverText: "emptyend",
    update: () => refreshLoadingSeedClient(),
    expectedTextAfterUpdate: "cli-1end",
    stableSelector: "div, p"
  },
  {
    name: "loading-seed-hybrid-store",
    App: LoadingSeedHybridStore,
    async: true,
    expectedText: "hyb-0end",
    serverText: "emptyend",
    update: () => refreshLoadingSeedHybrid(),
    expectedTextAfterUpdate: "hyb-1end",
    stableSelector: "div, p"
  },
  {
    name: "bare-client-memo",
    App: BareClientMemo,
    async: true,
    expectedText: "bare-0tail",
    serverText: "wait",
    update: () => refreshBareClient(),
    expectedTextAfterUpdate: "bare-1tail",
    stableSelector: "div, span"
  },
  {
    name: "bare-client-store",
    App: BareClientStore,
    async: true,
    expectedText: "bare-rowend",
    serverText: "wait"
  },
  {
    name: "bare-client-late-final",
    App: BareClientLateFinal,
    async: true,
    expectedText: "widgettail",
    // The live rejected swap splices the rejection template's single-space
    // text node into the range (see expectedTextStreamed).
    expectedTextStreamed: " widgettail",
    serverText: "wait"
  },
  {
    name: "errored-loading-preflush-rejection",
    App: PreflushRejection,
    async: true,
    expectedText: "caughttail",
    // Pre-flush the rejected boundary inlines to an empty region: neither
    // fallback reaches the server HTML — only the static sibling.
    serverText: "tail"
  },
  {
    name: "client-only-before-suspending-fragment",
    App: ClientOnlyBeforeSuspending,
    async: true,
    expectedText: "widget loaded",
    // The widget is client-only: the server renders only the boundary's side.
    serverText: "loaded"
  },
  {
    name: "select-value-selected",
    App: SelectValue,
    expectedText: "EnglishFrenchfr",
    // Raw-markup `selected` assertions live in test/server/select-value.spec.tsx;
    // this scenario pins clean claiming + post-hydration updates (#3013).
    serverText: "English French fr",
    update: () => setLang("en"),
    expectedTextAfterUpdate: "EnglishFrenchen",
    stableSelector: "div, select, option, span"
  },
  {
    name: "innerhtml-call-id-parity",
    App: InnerHTMLCallSiblings,
    expectedText: "r1r2off",
    serverText: "r1r2off",
    update: () => setInnerHTMLToggle(true),
    expectedTextAfterUpdate: "r1r2on",
    stableSelector: "div, label"
  }
];
