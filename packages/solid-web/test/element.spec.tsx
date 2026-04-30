/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import {
  createRoot,
  createSignal,
  createUniqueId,
  children,
  Show,
  flush,
  createMemo,
  getOwner,
  onCleanup,
  DEV
} from "solid-js";
import type { JSX } from "../src/index.js";

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
      d = createRoot(() => <div {...props} />) as unknown as HTMLDivElement & { $$click: any };
    expect(div!).toBe(d);
    expect(d.id).toBe("main");
    expect(d.title).toBe("main");
    expect(d.$$click).toBeDefined();
    expect(d.innerHTML).toBe("<p>Hi</p>");
  });

  test("class", () => {
    const classes = { first: true, second: false, "third fourth": true },
      d = (<div class={classes} />) as unknown as HTMLDivElement;
    expect(d.className).toBe("first third fourth");
  });

  test("ternary expression triggered", () => {
    const [s, setS] = createSignal(0);
    const div = createRoot(() => {
      return (<div>{s() > 5 ? "Large" : "Small"}</div>) as unknown as HTMLDivElement;
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
      <div>
        {s() > 5 && ((div1 = (<div />) as unknown as HTMLDivElement) as unknown as JSX.Element)}
      </div>;
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

  test("signal setter ref does not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [el, setEl] = createSignal<HTMLDivElement>();
    createRoot(() => {
      <div ref={setEl} />;
    });
    flush();
    expect(el()).toBeInstanceOf(HTMLDivElement);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("callback ref is ownerless", () => {
    let owner;
    createRoot(() => {
      <div ref={() => (owner = getOwner())} />;
    });
    expect(owner).toBe(null);
  });

  test("conditional callback prop read does not linger outside owner", () => {
    let owner;
    let callback!: () => number | false;
    let setEnabled!: (value: boolean) => boolean;

    const Child = (props: { onHit: false | (() => number) }) => {
      callback = () => props.onHit && props.onHit();
      return null;
    };

    createRoot(() => {
      owner = getOwner();
      const [enabled, _setEnabled] = createSignal(true);
      setEnabled = _setEnabled;
      <Child onHit={enabled() && (() => 1)} />;
    });

    const signal = DEV!.getSignals(owner!)[0];

    expect(DEV!.getObservers(signal)).toHaveLength(0);
    expect(callback()).toBe(1);
    expect(DEV!.getObservers(signal)).toHaveLength(0);

    setEnabled(false);
    flush();
    expect(callback()).toBe(false);
    expect(DEV!.getObservers(signal)).toHaveLength(0);

    setEnabled(true);
    flush();
    expect(callback()).toBe(1);
    expect(DEV!.getObservers(signal)).toHaveLength(0);
  });

  test("onCleanup warns in callback ref", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createRoot(() => {
      <div
        ref={() => {
          onCleanup(() => {});
        }}
      />;
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("onCleanup warns for callback ref inside Show", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [toggle, setToggle] = createSignal(0);

    createRoot(() => {
      return (
        <Show when={toggle()}>
          <div
            ref={() => {
              onCleanup(() => {});
            }}
          >
            TEXT
          </div>
        </Show>
      );
    });

    expect(warn).not.toHaveBeenCalled();
    setToggle(v => v ^ 1);
    flush();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
      ) as unknown as HTMLDivElement;
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
      ) as unknown as HTMLDivElement;
    });
    expect(res.innerHTML).toBe(
      "<div><span>Hello</span></div><div><span>Hello</span></div><div><span>Jake</span></div>"
    );
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
      ) as unknown as HTMLDivElement;
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
      ) as unknown as HTMLDivElement;
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

describe("Spread children caching", () => {
  test("spread children preserve isolated slots", () => {
    let div!: HTMLDivElement;
    let setShow!: (value: boolean | ((prev: boolean) => boolean)) => boolean;
    const rendered = vi.fn(() => undefined);
    let props!: JSX.HTMLAttributes<HTMLDivElement>;

    createRoot(() => {
      const [show, _setShow] = createSignal(true);
      setShow = _setShow;
      const stableRendered = createMemo(() => rendered(), { lazy: true });
      props = {
        get children() {
          return [
            <button />,
            stableRendered,
            <Show when={show()}>{show() ? "hide" : "show"}</Show>
          ] as unknown as JSX.Element;
        },
        ref(el: HTMLDivElement) {
          div = el;
        }
      };
      <div {...props} />;
    });
    flush();

    expect(rendered).toHaveBeenCalledTimes(1);
    expect(div.innerHTML).toBe("<button></button>hide");

    setShow(false);
    flush();
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(div.innerHTML).toBe("<button></button>");
  });

  test("spread children keep reactive arrays live", () => {
    let div!: HTMLDivElement;
    let setList!: (value: string[] | ((prev: string[]) => string[])) => string[];
    let props!: JSX.HTMLAttributes<HTMLDivElement>;

    createRoot(() => {
      const [list, _setList] = createSignal(["a", "b"]);
      setList = _setList;
      props = {
        get children() {
          return list();
        },
        ref(el: HTMLDivElement) {
          div = el;
        }
      };
      <div {...props} />;
    });
    flush();

    expect(div.innerHTML).toBe("ab");

    setList(["x"]);
    flush();
    expect(div.innerHTML).toBe("x");
  });
});
