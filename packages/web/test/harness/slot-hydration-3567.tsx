/**
 * @jsxImportSource @solidjs/web
 *
 * Shared fixture for the #3567 pair: JSX handed to a layout through a prop
 * other than `children` (a slot, an object of slots, a context getter, a
 * render prop) and inserted through a hole the compiler used to leave
 * unscoped. Compiled twice — ssr generate by
 * test/server/slot-hydration-3567.spec.tsx (writes the markup artifacts),
 * dom generate by test/hydration/slot-hydration-3567.spec.tsx (hydrates
 * them).
 *
 * Every layout is driven by the same App: a `<button id="hdr">` slot whose
 * click increments the counter, a `<p id="body">` child, plus footer / title /
 * render props the layout may or may not read. The hydrate half clicks the
 * SERVER-rendered button, so a handler bound to a detached client copy (the
 * issue's symptom) fails the liveness assertion rather than only the key
 * check.
 */
import {
  createSignal,
  children,
  omit,
  createContext,
  useContext,
  For,
  Show,
  Errored
} from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";

export type Scenario = {
  name: string;
  App: () => any;
  /** container textContent once hydration settles */
  expectedText: string;
  /** textContent after clicking the server-rendered `#hdr` button (if any) */
  expectedTextAfterClick: string;
  /**
   * Documents a shape the compiler does not align, by ruling: the hydrate
   * half asserts the keys still permute (so a fix is noticed) and that the
   * dev diagnostic named in `diagnostic` fires on both sides.
   */
  knownGap?: string;
  /** The dev diagnostic code the shape must raise on server render and client hydrate. */
  diagnostic?: "UNSCOPED_HOLE_ALLOCATED_IDS";
  /**
   * The scenario renders an `<Errored>` fallback that cannot see the error
   * (a value or a zero-arity thunk): dev logs the caught error through
   * `console.error` on both sides, by design. The specs silence and pin it.
   */
  logsCaughtError?: true;
};

function makeApp(Layout: (props: any) => any) {
  return function App() {
    const [n, setN] = createSignal(0);
    return (
      <Layout
        header={
          <button id="hdr" onClick={() => setN(n() + 1)}>
            clicks {n()}
          </button>
        }
        footer={<i id="ftr">footer {n()}</i>}
        title={`t${n()}`}
        render={() => (
          <button id="hdr" onClick={() => setN(n() + 1)}>
            clicks {n()}
          </button>
        )}
      >
        <p id="body">body {n()}</p>
      </Layout>
    );
  };
}

// The issue's shape: a member-read slot hole followed by the children hole.
const SlotThenChildren = (props: any) => (
  <div>
    <header>{props.header}</header>
    <main>{props.children}</main>
  </div>
);

// Nothing scoped follows the slot — always aligned; pins that scoping the
// slot itself does not break the trivial case.
const SlotAlone = (props: any) => (
  <div>
    <header>{props.header}</header>
  </div>
);

// Two slot holes, both formerly unscoped, so their walk order matched.
const TwoSlots = (props: any) => (
  <div>
    <header>{props.header}</header>
    <footer>{props.footer}</footer>
  </div>
);

// The same slot getter read twice; each read builds fresh elements.
const SlotTwice = (props: any) => (
  <div>
    <header>{props.header}</header>
    <aside>{props.header}</aside>
  </div>
);

const SlotTwiceThenChildren = (props: any) => (
  <div>
    <header>{props.header}</header>
    <aside>{props.header}</aside>
    <main>{props.children}</main>
  </div>
);

// A slot prop the layout never reads must not cost anything on either side.
const SlotUnused = (props: any) => (
  <div>
    <main>{props.children}</main>
  </div>
);

// Reservation precedes the member hole on both sides — always aligned.
const ChildrenThenSlot = (props: any) => (
  <div>
    <main>{props.children}</main>
    <footer>{props.footer}</footer>
  </div>
);

// Slot followed by a call hole (`count()` was always scoped).
function makeSlotThenSignal() {
  const [count] = createSignal(3);
  return (props: any) => (
    <div>
      <header>{props.header}</header>
      <span>{count()}</span>
    </div>
  );
}

// Slot followed by a text-valued member hole: both scoped now, one id each.
const SlotThenTitle = (props: any) => (
  <div>
    <header>{props.header}</header>
    <span>{props.title}</span>
  </div>
);

// `children` passed as an explicit attribute compiles like nested children.
function ExplicitChildrenApp() {
  const [n, setN] = createSignal(0);
  return (
    <SlotThenChildren
      header={
        <button id="hdr" onClick={() => setN(n() + 1)}>
          clicks {n()}
        </button>
      }
      children={<p id="body">body {n()}</p>}
    />
  );
}

function ExplicitChildrenOnlyApp() {
  const [n, setN] = createSignal(0);
  return (
    <SlotUnused
      children={
        <button id="hdr" onClick={() => setN(n() + 1)}>
          clicks {n()}
        </button>
      }
    />
  );
}

// The left operand of `||` builds the JSX; the predicate used to look only at
// the right operand.
const LogicalOrThenChildren = (props: any) => (
  <div>
    <header>{props.header || "none"}</header>
    <main>{props.children}</main>
  </div>
);

// `children()` resolves the slot eagerly into a memo at the call, before the
// template; the accessor hole is a call and was always scoped.
const ChildrenHelperThenChildren = (props: any) => {
  const c = children(() => props.header);
  return (
    <div>
      <header>{c()}</header>
      <main>{props.children}</main>
    </div>
  );
};

// Array-literal branch carrying the slot.
function makeArrayBranchThenChildren() {
  const [cond] = createSignal(true);
  return (props: any) => (
    <div>
      <header>{cond() ? [props.header, " x"] : null}</header>
      <main>{props.children}</main>
    </div>
  );
}

// A props helper hands the slot back through a local: the member root is not
// the component's parameter, which a param-rooted predicate would have missed.
const OmitLocal = (props: any) => {
  const local = omit(props, "title");
  return (
    <div>
      <header>{local.header}</header>
      <main>{props.children}</main>
    </div>
  );
};

// Slot reached through context: a member read on a value with no lexical
// relation to props at all.
const SlotCtx = createContext<any>();
const CtxLayout = (props: any) => {
  const ctx = useContext(SlotCtx);
  return (
    <div>
      <header>{ctx.header}</header>
      <main>{props.children}</main>
    </div>
  );
};
function CtxApp() {
  const [n, setN] = createSignal(0);
  const slots = {
    get header() {
      return (
        <button id="hdr" onClick={() => setN(n() + 1)}>
          clicks {n()}
        </button>
      );
    }
  };
  return (
    <SlotCtx value={slots}>
      <CtxLayout>
        <p id="body">body {n()}</p>
      </CtxLayout>
    </SlotCtx>
  );
}

// Destructured props: the getters run at destructure time, before the
// template, so both holes hold already-built values.
const Destructured = ({ header, children }: any) => (
  <div>
    <header>{header}</header>
    <main>{children}</main>
  </div>
);

// Optional call of a render prop (Babel's isCallExpression is false for it).
const OptionalCall = (props: any) => (
  <div>
    <header>{props.render?.()}</header>
    <main>{props.children}</main>
  </div>
);

// KNOWN GAP, BY RULING: a bare identifier bound to a FUNCTION that returns
// JSX. The hole never classifies as `dynamic`, so neither generate scopes it;
// the client inserts it as a transparent effect at the statement while the
// server resolves the function late inside the `ssr()` walk, after the
// children scope has reserved its slot — the keys permute. 2.0's
// `JSX.Element` excludes functions, so type-checked code reaches this shape
// only through a cast (or from JS), and it is NOT scoped (no production
// cost). Instead both runtimes raise `UNSCOPED_HOLE_ALLOCATED_IDS` in dev
// when the hole takes ids from the enclosing counter at a position the other
// side does not share (the server: registered vs. evaluated; the client: the
// content it built in place missed its keys) — pinned here, with the
// permutation, so a change to either is noticed.
const FunctionIdentifier = (props: any) => {
  const renderHead = () => props.header;
  return (
    <div>
      <header>{renderHead as unknown as JSX.Element}</header>
      <main>{props.children}</main>
    </div>
  );
};

// The fix the diagnostic prescribes: CALL the function at the hole. A call
// hole is scoped on both sides, so nothing escapes to the enclosing counter.
const FunctionIdentifierCalled = (props: any) => {
  const renderHead = () => props.header;
  return (
    <div>
      <header>{renderHead()}</header>
      <main>{props.children}</main>
    </div>
  );
};

// Controls for the diagnostic: function-valued holes that own their ids.
// A component whose result is an accessor (`<Show>` returns a memo) is a
// function at the hole, but the memo allocated its owner at creation and
// its content nests there; the enclosing counter does not move.
const ShowHead = (props: any) => <Show when={true}>{props.header}</Show>;
const ComponentHoleThenChildren = (props: any) => (
  <div>
    <header>
      <ShowHead header={props.header} />
    </header>
    <main>{props.children}</main>
  </div>
);

// `<For>` is a `mapArray` accessor at the hole: rows live under its owner.
// Each row's template-literal hole is unscoped too (provably primitive) and
// must stay silent — it allocates nothing.
const ForRowsThenChildren = (props: any) => (
  <div>
    <ul>
      <For each={["a", "b"]}>{i => <li>{`${props.title}-${i}`}</li>}</For>
    </ul>
    <main>{props.children}</main>
  </div>
);

// A bare identifier holding an already-built JSX value is passed eagerly on
// both sides (`insert(el, h)` / `escape(h)`), so it is safe unscoped.
const ValueIdentifier = (props: any) => {
  const h = props.header;
  return (
    <div>
      <header>{h}</header>
      <main>{props.children}</main>
    </div>
  );
};

// Slot passed as children of a Dynamic component, then a scoped call hole.
function makeDynamicThenSignal() {
  const [count] = createSignal(3);
  const Btn = (p: any) => p.children;
  return (props: any) => (
    <div>
      <Dynamic component={Btn}>{props.header}</Dynamic>
      <span>{count()}</span>
    </div>
  );
}

// Spread on the template root routes its children through the spread path,
// which shares the scope gate.
const SpreadThenSlot = (props: any) => (
  <div {...props.rest}>
    <header>{props.header}</header>
    <main>{props.children}</main>
  </div>
);

// A boundary's ZERO-ARITY fallback thunk (`fallback={() => <F />}` — type-
// reachable, since `() => X` is assignable to `(err, reset) => X`) followed
// by a scoped hole in the same element. `<Errored>` used to hand a zero-arity
// fallback back unresolved (`f.length == 0` read as a value thunk), so the
// CONSUMING hole built it on the enclosing counter: the client at the
// statement, the server inside the `ssr()` walk after `{props.title}` had
// reserved its slot — the keys permuted (surfaced by #3620, which pinned it
// as reported by `UNSCOPED_HOLE_ALLOCATED_IDS`). By ruling, `<Errored>`
// resolves a function-valued fallback like `<Show>` resolves a function
// child: inside its own scope, the same one the `(err, reset) => X` form
// already runs under — so the zero-arity and two-arity forms allocate
// identically and nothing escapes to the enclosing counter.
const ThrowsSync = (): never => {
  throw new Error("sync render failure");
};
function ErroredThunkFallbackThenScopedHoleApp() {
  const [n, setN] = createSignal(0);
  const Fallback = () => (
    <button id="hdr" onClick={() => setN(n() + 1)}>
      clicks {n()}
    </button>
  );
  const Inner = () => (
    <Errored fallback={() => <Fallback />}>
      <ThrowsSync />
    </Errored>
  );
  const Layout = (props: any) => (
    <section>
      <Inner />
      <span>{props.title}</span>
    </section>
  );
  return <Layout title={`t${n()}`} />;
}

const T = (expectedText: string, expectedTextAfterClick: string) => ({
  expectedText,
  expectedTextAfterClick
});

export const scenarios: Scenario[] = [
  {
    name: "slot-then-children",
    App: makeApp(SlotThenChildren),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  { name: "slot-alone", App: makeApp(SlotAlone), ...T("clicks 0", "clicks 1") },
  { name: "two-slots", App: makeApp(TwoSlots), ...T("clicks 0footer 0", "clicks 1footer 1") },
  { name: "slot-twice", App: makeApp(SlotTwice), ...T("clicks 0clicks 0", "clicks 1clicks 1") },
  {
    name: "slot-twice-then-children",
    App: makeApp(SlotTwiceThenChildren),
    ...T("clicks 0clicks 0body 0", "clicks 1clicks 1body 1")
  },
  { name: "slot-unused", App: makeApp(SlotUnused), ...T("body 0", "body 0") },
  {
    name: "children-then-slot",
    App: makeApp(ChildrenThenSlot),
    ...T("body 0footer 0", "body 0footer 0")
  },
  { name: "slot-then-signal", App: makeApp(makeSlotThenSignal()), ...T("clicks 03", "clicks 13") },
  { name: "slot-then-title", App: makeApp(SlotThenTitle), ...T("clicks 0t0", "clicks 1t1") },
  {
    name: "explicit-children-attr-with-slot",
    App: ExplicitChildrenApp,
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "explicit-children-attr-only",
    App: ExplicitChildrenOnlyApp,
    ...T("clicks 0", "clicks 1")
  },
  {
    name: "logical-or-then-children",
    App: makeApp(LogicalOrThenChildren),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "children-helper-then-children",
    App: makeApp(ChildrenHelperThenChildren),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "array-branch-then-children",
    App: makeApp(makeArrayBranchThenChildren()),
    ...T("clicks 0 xbody 0", "clicks 1 xbody 1")
  },
  { name: "omit-local", App: makeApp(OmitLocal), ...T("clicks 0body 0", "clicks 1body 1") },
  { name: "context-slot", App: CtxApp, ...T("clicks 0body 0", "clicks 1body 1") },
  {
    name: "destructured-props",
    App: makeApp(Destructured),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "optional-call-render",
    App: makeApp(OptionalCall),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "function-identifier",
    App: makeApp(FunctionIdentifier),
    ...T("clicks 0body 0", "clicks 1body 1"),
    knownGap:
      "a bare identifier hole never classifies as dynamic, so a function-valued one is deferred " +
      "unscoped on both sides and the server resolves it after the children scope reserved its slot; " +
      "TS-unreachable, not scoped by ruling — UNSCOPED_HOLE_ALLOCATED_IDS fires instead",
    diagnostic: "UNSCOPED_HOLE_ALLOCATED_IDS"
  },
  {
    name: "function-identifier-called",
    App: makeApp(FunctionIdentifierCalled),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "component-hole-then-children",
    App: makeApp(ComponentHoleThenChildren),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "for-rows-then-children",
    App: makeApp(ForRowsThenChildren),
    ...T("t0-at0-bbody 0", "t0-at0-bbody 0")
  },
  {
    name: "value-identifier",
    App: makeApp(ValueIdentifier),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "dynamic-then-signal",
    App: makeApp(makeDynamicThenSignal()),
    ...T("clicks 03", "clicks 13")
  },
  {
    name: "spread-then-slot",
    App: makeApp(SpreadThenSlot),
    ...T("clicks 0body 0", "clicks 1body 1")
  },
  {
    name: "errored-thunk-fallback-followed-by-scoped-hole",
    App: ErroredThunkFallbackThenScopedHoleApp,
    ...T("clicks 0t0", "clicks 1t1"),
    logsCaughtError: true
  }
];
