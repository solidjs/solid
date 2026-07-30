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
import { createSignal, createMemo, createStore, Show, For, Loading, Errored } from "solid-js";
import { Portal, httpStatus, httpHeader, clientOnly } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type Scenario = {
  name: string;
  App: () => any;
  /** textContent of the container once hydration fully settles */
  expectedText: string;
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
  const access = createMemo(() => connect(), { ssrSource: "client" });
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
  }
];
