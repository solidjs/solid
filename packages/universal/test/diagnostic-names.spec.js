// #3063: renderer-owned effects carry diagnostic names so dev attribution
// can correlate signal write → application computation → renderer effect →
// output mutation. Callers label renderer output via the trailing
// RendererEffectOptions argument on effect/insert/spread; without one, each
// renderer-owned effect gets a stable "renderer ..." fallback (dev only —
// the "_SOLID_DEV_" constant folds the fallbacks out of production builds).
import * as r from "./custom.js";
import { DEV, createRoot, createSignal, flush } from "solid-js";

/** Enable attribution quietly and collect every rerun event. */
function collect() {
  DEV.attribution.enable({ log: false });
  const events = [];
  DEV.attribution.subscribe(e => events.push(e));
  return events;
}

afterEach(() => {
  DEV.attribution.disable();
  flush();
});

describe("renderer effect diagnostic names (#3063)", () => {
  it("insert forwards a caller-supplied name to its render effect", () => {
    const parent = document.createElement("div");
    const [value, setValue] = createSignal("a");

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => value(), undefined, undefined, { name: "counter.output" });
    });
    flush();

    const events = collect();
    setValue("b");
    flush();

    expect(parent.innerHTML).toBe("b");
    const names = events.map(e => e.nodeName);
    expect(names).toContain("counter.output");
    dispose();
  });

  it("insert falls back to a stable renderer-owned name", () => {
    const parent = document.createElement("div");
    const [value, setValue] = createSignal("a");

    let dispose;
    createRoot(d => {
      dispose = d;
      r.insert(parent, () => value());
    });
    flush();

    const events = collect();
    setValue("b");
    flush();

    expect(events.map(e => e.nodeName)).toContain("renderer insert");
    dispose();
  });

  it("effect accepts options and names the created render effect", () => {
    const [value, setValue] = createSignal(1);
    let applied;

    let dispose;
    createRoot(d => {
      dispose = d;
      r.effect(
        () => value(),
        v => {
          applied = v;
        },
        { name: "counter.effect" }
      );
    });
    flush();

    const events = collect();
    setValue(2);
    flush();

    expect(applied).toBe(2);
    expect(events.map(e => e.nodeName)).toContain("counter.effect");
    dispose();
  });

  it("spread forwards one shared name to its props effect and child insertion", () => {
    const node = document.createElement("div");
    const [title, setTitle] = createSignal("first");
    const [child, setChild] = createSignal("hello");

    let dispose;
    createRoot(d => {
      dispose = d;
      r.spread(
        node,
        {
          get title() {
            return title();
          },
          get children() {
            return child();
          }
        },
        false,
        { name: "widget.output" }
      );
    });
    flush();
    expect(node.getAttribute("title")).toBe("first");
    expect(node.textContent).toBe("hello");

    const events = collect();
    setTitle("second");
    setChild("goodbye");
    flush();

    expect(node.getAttribute("title")).toBe("second");
    expect(node.textContent).toBe("goodbye");
    // Both the internal props effect and the children insertion re-ran under
    // the caller's shared name (#3063 open question 2: one name for all of
    // spread's internals).
    const named = events.filter(e => e.nodeName === "widget.output");
    expect(named.length).toBeGreaterThanOrEqual(2);
    expect(events.filter(e => e.nodeName.startsWith("renderer "))).toHaveLength(0);
    dispose();
  });

  it("spread falls back to distinct renderer-owned names", () => {
    const node = document.createElement("div");
    const [title, setTitle] = createSignal("first");
    const [child, setChild] = createSignal("hello");

    let dispose;
    createRoot(d => {
      dispose = d;
      r.spread(node, {
        get title() {
          return title();
        },
        get children() {
          return child();
        }
      });
    });
    flush();

    const events = collect();
    setTitle("second");
    setChild("goodbye");
    flush();

    const names = events.map(e => e.nodeName);
    expect(names).toContain("renderer spread props");
    expect(names).toContain("renderer spread children");
    dispose();
  });

  it("render names its mount insertion", () => {
    const container = document.createElement("div");
    const [value, setValue] = createSignal("a");

    // render evaluates `code()` once; a function tree keeps the leaf live.
    const dispose = r.render(() => () => value(), container);
    expect(container.textContent).toBe("a");

    const events = collect();
    setValue("b");
    flush();

    expect(container.textContent).toBe("b");
    expect(events.map(e => e.nodeName)).toContain("renderer render");
    dispose();
  });
});
