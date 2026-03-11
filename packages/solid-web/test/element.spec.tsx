/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, createUniqueId, JSX, children, Show, flush } from "solid-js";
import { memo, effect } from "../src/core.js";

describe("Basic element attributes", () => {
  test("spread", () => {
    let div: HTMLDivElement;
    const props: JSX.HTMLAttributes<HTMLDivElement> = {
        id: "main",
        title: "main",
        children: <p>Hi</p>,
        ref: (ref: HTMLDivElement) => {
          div = ref;
        },
        onClick: () => console.log("clicked")
      },
      d = createRoot(() => <div {...props} />) as HTMLDivElement & { $$click: any };
    expect(div!).toBe(d);
    expect(d.id).toBe("main");
    expect(d.title).toBe("main");
    expect(d.$$click).toBeDefined();
    expect(d.innerHTML).toBe("<p>Hi</p>");
  });

  test("class", () => {
    const classes = { first: true, second: false, "third fourth": true },
      d = (<div class={classes} />) as HTMLDivElement;
    expect(d.className).toBe("first third fourth");
  });

  test("ternary expression triggered", () => {
    const [s, setS] = createSignal(0);
    const div = createRoot(() => {
      return (<div>{s() > 5 ? "Large" : "Small"}</div>) as HTMLDivElement;
    });
    expect(div.innerHTML).toBe("Small");
    setS(7);
    flush();
    expect(div.innerHTML).toBe("Large");
  });

  test("boolean expression triggered once", () => {
    let div1: HTMLDivElement, div2: HTMLDivElement;
    const [s, setS] = createSignal(6);
    createRoot(() => {
      <div>{s() > 5 && (div1 = (<div />) as HTMLDivElement)}</div>;
      div2 = div1;
    });
    setS(7);
    flush();
    expect(div1!).toBe(div2!);
  });

  test("ref assigns element", () => {
    let el!: HTMLDivElement;
    let ref: HTMLDivElement;
    function getRef() {
      return (el: HTMLDivElement) => (ref = el);
    }
    createRoot(() => {
      <div ref={[getRef, (r: HTMLDivElement) => (el = r)]} />;
    });
    expect(el).toBeInstanceOf(HTMLDivElement);
  });

  test("uniqueId", () => {
    let div: HTMLDivElement;
    createRoot(() => {
      const id = createUniqueId();
      div = (
        <div>
          <label for={id}>Hi</label>
          <input type="text" id={id} />
        </div>
      ) as HTMLDivElement;
    });
    expect((div!.firstChild as HTMLLabelElement).htmlFor).toBe(
      (div!.firstChild!.nextSibling as HTMLInputElement).id
    );
  });

  test("children", () => {
    const Comp = (props: { children?: JSX.Element }) => {
      const c = children(() => props.children);
      return (
        <>
          {c.toArray().map(i => (
            <div>{i}</div>
          ))}
        </>
      );
    };
    const res: HTMLDivElement = createRoot(() => {
      return (
        <div>
          <Comp>
            <span>Hello</span>
          </Comp>
          <Comp>
            <span>Hello</span>
            <span>Jake</span>
          </Comp>
          <Comp />
        </div>
      ) as HTMLDivElement;
    });
    expect(res.innerHTML).toBe(
      "<div><span>Hello</span></div><div><span>Hello</span></div><div><span>Jake</span></div>"
    );
  });
});

describe("Transparent memo reactivity", () => {
  test("memo with transparent flag propagates signal updates through effect", () => {
    const [count, setCount] = createSignal(0);
    let effectRuns = 0;
    let lastValue: number | undefined;

    createRoot(() => {
      // This simulates what insert() does internally:
      // 1. Wrap the accessor in memo(fn, true) — a transparent memo
      // 2. Pass the result into effect() — a transparent render effect
      // If memo uses a transparent computed node, the chain of two transparent
      // nodes fails to propagate updates to the DOM.
      const m = memo(() => count(), true);
      effect(
        () => m(),
        (value: number) => {
          effectRuns++;
          lastValue = value;
        },
        undefined
      );
    });
    flush();

    expect(effectRuns).toBe(1);
    expect(lastValue).toBe(0);

    setCount(1);
    flush();

    // This is the critical assertion: the effect must re-run when the
    // signal updates. With the bug (using coreMemo + { transparent: true }),
    // effectRuns stays at 1 because the transparent memo doesn't propagate
    // to the downstream transparent render effect.
    expect(effectRuns).toBe(2);
    expect(lastValue).toBe(1);
  });

  test("dynamic text in JSX updates when signal changes", () => {
    const [count, setCount] = createSignal(0);
    const div = createRoot(() => {
      return (<div>Count: {count()}</div>) as HTMLDivElement;
    });

    expect(div.innerHTML).toBe("Count: 0");

    setCount(42);
    flush();

    expect(div.innerHTML).toBe("Count: 42");
  });
});

describe("Insert caching (issue #2610)", () => {
  test("Show component does not cause sibling to re-render", () => {
    let siblingRenderCount = 0;
    const Sibling = () => {
      siblingRenderCount++;
      return <span>sibling</span>;
    };

    const [show, setShow] = createSignal(true);
    let div!: HTMLDivElement;

    createRoot(() => {
      div = (
        <div>
          <Show when={show()}>visible</Show>
          <Sibling />
        </div>
      ) as HTMLDivElement;
    });
    flush();

    expect(siblingRenderCount).toBe(1);
    expect(div.innerHTML).toBe("visible<span>sibling</span>");

    setShow(false);
    flush();

    expect(siblingRenderCount).toBe(1);
    expect(div.innerHTML).toBe("<span>sibling</span>");

    setShow(true);
    flush();

    expect(siblingRenderCount).toBe(1);
    expect(div.innerHTML).toBe("visible<span>sibling</span>");
  });

  test("multiple Show toggles do not re-render siblings", () => {
    let siblingRenderCount = 0;
    const Sibling = () => {
      siblingRenderCount++;
      return <span>sibling</span>;
    };

    const [show, setShow] = createSignal(false);
    let div!: HTMLDivElement;

    createRoot(() => {
      div = (
        <div>
          <Show when={show()}>
            <span>content</span>
          </Show>
          <Sibling />
        </div>
      ) as HTMLDivElement;
    });
    flush();

    expect(siblingRenderCount).toBe(1);
    expect(div.innerHTML).toBe("<span>sibling</span>");

    for (let i = 0; i < 5; i++) {
      setShow(true);
      flush();
      expect(siblingRenderCount).toBe(1);
      expect(div.innerHTML).toBe("<span>content</span><span>sibling</span>");

      setShow(false);
      flush();
      expect(siblingRenderCount).toBe(1);
      expect(div.innerHTML).toBe("<span>sibling</span>");
    }
  });
});
