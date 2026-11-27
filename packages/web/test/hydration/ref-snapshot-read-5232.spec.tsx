/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #5232: a ref callback that reads a signal whose value differs from the
 * hydration snapshot. The ref is served the snapshot and runs once on the
 * served element; the creating pass is not replayed, so the served element
 * stays in the page. Reads in bindings still catch up after the claim.
 *
 * Server markup captured from renderToString of the identical components
 * (ssr generate, hydratable); a lowered `<Show>` numbers its keys differently.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal, enableHydration, Errored, flush, Loading, Show } from "solid-js";
import { Dynamic, hydrate, render } from "@solidjs/web";

enableHydration();

const lowered = process.env.LOWER_SHOW === "1";
const SHOW_HK = lowered ? "20" : "30";

type Call = [el: Element, value: unknown];
// Some components return an accessor, which is not a JSX component's return type.
type App = (props: { calls: Call[] }) => any;

function Minimal(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return () => (
    <p
      ref={el => {
        setN(1);
        props.calls.push([el, n()]);
      }}
    >
      target
    </p>
  );
}
const MINIMAL_HTML = "<p _hk=0>target</p>";

function AnchorShow(props: { calls: Call[] }) {
  const [anchor, setAnchor] = createSignal<HTMLButtonElement | null>(null);
  const [open] = createSignal(true);
  return (
    <main>
      <button ref={setAnchor}>anchor</button>
      <Show when={open()}>
        <div ref={el => props.calls.push([el, anchor()])}>popover</div>
      </Show>
    </main>
  );
}
const ANCHOR_SHOW_HTML = `<main _hk=0><button>anchor</button><!--$--><div _hk=${SHOW_HK}>popover</div><!--/--></main>`;

function SiblingWrite(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <i ref={() => setN(1)} />
      {() => <p ref={el => props.calls.push([el, n()])}>target</p>}
    </main>
  );
}
const SIBLING_WRITE_HTML = "<main _hk=0><i></i><!--$--><p _hk=10>target</p><!--/--></main>";

// The same sibling write, read by a ref reached through each way a ref is
// applied or each boundary an element is created under.
function ArrayRef(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <i ref={() => setN(1)} />
      {() => <p ref={[el => props.calls.push([el, n()]), () => {}]}>target</p>}
    </main>
  );
}

function Target(props: { ref: (el: HTMLParagraphElement) => void }) {
  return <p ref={props.ref}>target</p>;
}
function ForwardedRef(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <i ref={() => setN(1)} />
      {() => <Target ref={el => props.calls.push([el, n()])} />}
    </main>
  );
}

function SpreadRef(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  const attrs = () => ({ class: n() ? "set" : "unset" });
  return (
    <main>
      <i ref={() => setN(1)} />
      {() => (
        <p {...attrs()} ref={el => props.calls.push([el, n()])}>
          target
        </p>
      )}
    </main>
  );
}
const SPREAD_REF_HTML =
  '<main _hk=0><i></i><!--$--><p _hk=10 class="unset">target</p><!--/--></main>';

function InLoading(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <i ref={() => setN(1)} />
      <Loading fallback={<s>wait</s>}>
        <p ref={el => props.calls.push([el, n()])}>target</p>
      </Loading>
    </main>
  );
}
const IN_LOADING_HTML = "<main _hk=0><i></i><!--$--><p _hk=1000>target</p><!--/--></main>";

function InErrored(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <i ref={() => setN(1)} />
      <Errored fallback={<s>failed</s>}>
        <p ref={el => props.calls.push([el, n()])}>target</p>
      </Errored>
    </main>
  );
}
const IN_ERRORED_HTML = "<main _hk=0><i></i><!--$--><p _hk=100>target</p><!--/--></main>";

function InDynamic(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <i ref={() => setN(1)} />
      <Dynamic component="p" ref={(el: Element) => props.calls.push([el, n()])}>
        target
      </Dynamic>
    </main>
  );
}
const IN_DYNAMIC_HTML = "<main _hk=0><i></i><!--$--><p _hk=30>target</p><!--/--></main>";

function BodyWrite(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0, { ownedWrite: true });
  setN(1);
  return () => <p ref={el => props.calls.push([el, n()])}>target</p>;
}
const BODY_WRITE_HTML = "<p _hk=0>target</p>";

function ShowTrue(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <Show when={true}>
        <p
          ref={el => {
            setN(1);
            props.calls.push([el, n()]);
          }}
        >
          target
        </p>
      </Show>
    </main>
  );
}
const SHOW_TRUE_HTML = `<main _hk=0><p _hk=${lowered ? "1" : "30"}>target</p></main>`;

function ReadOnly(props: { calls: Call[] }) {
  const [n] = createSignal(0);
  return () => <p ref={el => props.calls.push([el, n()])}>target</p>;
}
const READ_ONLY_HTML = "<p _hk=0>target</p>";

function TrackedText(props: { calls: Call[] }) {
  const [n, setN] = createSignal(0);
  return () => (
    <p
      ref={el => {
        setN(1);
        props.calls.push([el, n()]);
      }}
    >
      {n()}
    </p>
  );
}
const TRACKED_TEXT_HTML = "<p _hk=0>0</p>";

describe("#5232: a ref's snapshot read does not replay the creating pass", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    await new Promise(r => setTimeout(r, 0));
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  function hydrateServed(App: App, html: string, selector: string) {
    container.innerHTML = html;
    const served = container.querySelector(selector)!;
    const calls: Call[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      dispose = hydrate(() => <App calls={calls} />, container);
      flush();
      return { served, calls, warnings: warn.mock.calls.map(a => String(a[0])) };
    } finally {
      warn.mockRestore();
    }
  }

  test.each([
    ["the ref writes then reads (minimal)", Minimal, MINIMAL_HTML, 0],
    ["the component body writes before returning the accessor", BodyWrite, BODY_WRITE_HTML, 0],
    ["the ref writes then reads inside <Show when={true}>", ShowTrue, SHOW_TRUE_HTML, 0]
  ] as const)("%s: one call on the served node, which stays", (_, App, html, seen) => {
    const { served, calls, warnings } = hydrateServed(App, html, "p");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(served);
    expect(calls[0][1]).toBe(seen);
    expect(served.isConnected).toBe(true);
    expect(container.querySelector("p")).toBe(served);
    expect(warnings).toEqual([]);
  });

  test("an earlier sibling's ref={setAnchor} read in a <Show> ref: the served popover stays", () => {
    const { served, calls, warnings } = hydrateServed(AnchorShow, ANCHOR_SHOW_HTML, "div");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(served);
    expect(calls[0][1]).toBe(null);
    expect(served.isConnected).toBe(true);
    expect(container.querySelector("div")).toBe(served);
    expect(container.querySelector("button")).toBeTruthy();
    expect(warnings).toEqual([]);
  });

  test("an earlier sibling's ref writes the signal read in an accessor's ref: the served node stays", () => {
    const { served, calls, warnings } = hydrateServed(SiblingWrite, SIBLING_WRITE_HTML, "p");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(served);
    expect(calls[0][1]).toBe(0);
    expect(served.isConnected).toBe(true);
    expect(container.querySelector("p")).toBe(served);
    expect(warnings).toEqual([]);
  });

  test.each([
    ["a ref array", ArrayRef, SIBLING_WRITE_HTML, ""],
    ["a ref forwarded through a component's props", ForwardedRef, SIBLING_WRITE_HTML, ""],
    ["a ref beside a reactive spread", SpreadRef, SPREAD_REF_HTML, "set"],
    ["a ref inside <Loading>", InLoading, IN_LOADING_HTML, ""],
    ["a ref inside <Errored>", InErrored, IN_ERRORED_HTML, ""],
    ["a ref on <Dynamic>", InDynamic, IN_DYNAMIC_HTML, ""]
  ] as const)(
    "an earlier sibling's write read by %s: the served node stays",
    (_, App, html, className) => {
      const { served, calls, warnings } = hydrateServed(App, html, "p");
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe(served);
      expect(calls[0][1]).toBe(0);
      expect(served.isConnected).toBe(true);
      expect(container.querySelector("p")).toBe(served);
      expect(warnings).toEqual([]);
      // A binding on the served node still catches up after the claim.
      expect(served.className).toBe(className);
    }
  );

  test("control: a ref that only reads is called once on the served node", () => {
    const { served, calls } = hydrateServed(ReadOnly, READ_ONLY_HTML, "p");
    expect(calls).toEqual([[served, 0]]);
    expect(served.isConnected).toBe(true);
  });

  test("a tracked binding of the written signal still updates on the served node after the claim", () => {
    const { served, calls } = hydrateServed(TrackedText, TRACKED_TEXT_HTML, "p");
    expect(calls).toEqual([[served, 0]]);
    expect(container.querySelector("p")).toBe(served);
    expect(served.textContent).toBe("1");
  });

  test("control: a client render calls each ref once with the current value", () => {
    const minimal: Call[] = [];
    const Client: App = Minimal;
    dispose = render(() => <Client calls={minimal} />, container);
    flush();
    expect(minimal).toHaveLength(1);
    expect(minimal[0][0]).toBe(container.querySelector("p"));
    expect(minimal[0][1]).toBe(1);
    dispose();
    container.innerHTML = "";

    const anchored: Call[] = [];
    dispose = render(() => <AnchorShow calls={anchored} />, container);
    flush();
    expect(anchored).toHaveLength(1);
    expect(anchored[0][0]).toBe(container.querySelector("div"));
    expect(anchored[0][1]).toBe(container.querySelector("button"));
  });
});
