/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * spread() creates at most two reactive nodes per element (#3388): the
 * children `insert` effect, which OWNS the child subtree and so must stay
 * separate, and one attribute effect that also carries `ref` (refs own
 * nothing — `ref()` applies them with no owner — so folding them in is safe).
 * Plain data `children` insert with no effect at all. The array form
 * `spread(el, [a, () => b, c], skipChildren, skip)` unions own keys with
 * later sources winning, reads only the winner, calls function sources
 * inline (no memo, no hydration id) and honors a `skip` predicate.
 */
import { describe, expect, test, vi } from "vitest";
import { render, spread } from "@solidjs/web";
import { createRoot, createSignal, createStore, flush, getOwner, merge, omit } from "solid-js";

const mount = (el: () => any) => {
  const container = document.createElement("div");
  const dispose = render(el, container);
  flush();
  return { container, dispose, el: () => container.firstElementChild as HTMLElement };
};

function ownerTotal(node: any): number {
  let count = 0;
  for (let s = node._firstChild; s; s = s._nextSibling) count += 1 + ownerTotal(s);
  return count;
}

/** Reactive nodes created under a root by building the source (a merge() memo
 * counts) and one `spread(...)` call over it. */
function spreadNodes(source: () => any, skipChildren?: boolean) {
  let count = -1;
  const dispose = createRoot(d => {
    const owner = getOwner();
    const el = document.createElement("div");
    spread(el, source(), skipChildren);
    flush();
    count = ownerTotal(owner);
    return d;
  });
  dispose();
  return count;
}

describe("reactive node count per element", () => {
  test("attributes + getter children: 2 nodes (children insert + attribute effect)", () => {
    const [title] = createSignal("t");
    const props = {
      get title() {
        return title();
      },
      get children() {
        return "text";
      }
    };
    expect(spreadNodes(() => props)).toBe(2);
    // Lone reactive spread: the accessor itself, no memo (#3105).
    expect(spreadNodes(() => () => props)).toBe(2);
  });

  test("attributes without children: 1 node", () => {
    const [title] = createSignal("t");
    const props = {
      get title() {
        return title();
      }
    };
    expect(spreadNodes(() => props)).toBe(1);
    expect(spreadNodes(() => props, true)).toBe(1);
    expect(spreadNodes(() => ({ ...props, children: "x" }), true)).toBe(1);
  });

  test("a ref adds no node", () => {
    const [title] = createSignal("t");
    const props = {
      ref: () => {},
      get title() {
        return title();
      }
    };
    expect(spreadNodes(() => props)).toBe(1);
  });

  test("plain data children insert with no effect", () => {
    expect(spreadNodes(() => ({ title: "a", children: "static" }))).toBe(1);
    expect(spreadNodes(() => ({ title: "a", children: document.createElement("b") }))).toBe(1);
  });

  test("…and so do data children behind merge/omit views over plain objects", () => {
    // The Kobalte shape: `<Tag {...omit(props, "as")}>` where the caller
    // wrote static children. The view's descriptor trap reports the leaf's
    // data property, so no children effect is created (#3388, #3448).
    const props = { as: "a", title: "a", children: "static" };
    expect(spreadNodes(() => omit(props, "as"))).toBe(1);
    expect(spreadNodes(() => merge({ role: "button" }, omit(props, "as")))).toBe(1);
    expect(spreadNodes(() => omit(merge({ role: "button" }, props), "as"))).toBe(1);
    // a getter behind the same layers still gets its effect
    const reactive = {
      as: "a",
      get children() {
        return "text";
      }
    };
    expect(spreadNodes(() => omit(merge({ role: "button" }, reactive), "as"))).toBe(2);
    // a store leaf can grow a `children` key later: reactive path
    const [store] = createStore<{ title: string; children?: string }>({ title: "a" });
    expect(spreadNodes(() => merge({ role: "button" }, store))).toBe(2);
  });

  test("compiled mergeProps source: 1 memo for the reactive part + 1 attribute effect", () => {
    const [rest] = createSignal({ "data-a": "1" });
    // `<div class="c" {...rest()} />` → spread(el, merge({class}, () => rest()))
    expect(spreadNodes(() => merge({ class: "c" }, () => rest()), true)).toBe(2);
    // ...and with getter children flowing through, the children insert too.
    expect(
      spreadNodes(() =>
        merge(
          {
            get children() {
              return "c";
            }
          },
          () => rest()
        )
      )
    ).toBe(3);
  });

  test("array form: no memo for a function source", () => {
    const [rest] = createSignal({ "data-a": "1" });
    expect(spreadNodes(() => [{ class: "c" }, () => rest()], true)).toBe(1);
    expect(spreadNodes(() => [{ class: "c", children: "x" }, () => rest()])).toBe(2);
  });
});

describe("ref folded into the attribute effect", () => {
  test("applied once on mount; not re-called when an unrelated attribute changes", () => {
    const [cls, setCls] = createSignal("a");
    const refFn = vi.fn();
    const m = mount(() => <div ref={refFn} class={cls()} data-x="x" {...{ title: "t" }} />);
    expect(refFn).toHaveBeenCalledTimes(1);
    expect(refFn).toHaveBeenCalledWith(m.el());
    setCls("b");
    flush();
    expect(m.el().className).toBe("b");
    expect(refFn).toHaveBeenCalledTimes(1);
    m.dispose();
  });

  test("lone reactive spread: ref applied once, survives attribute-only updates", () => {
    const refFn = vi.fn();
    const [props, setProps] = createSignal<any>({ ref: refFn, title: "a" });
    const m = mount(() => <div {...props()} />);
    expect(refFn).toHaveBeenCalledTimes(1);
    expect(refFn).toHaveBeenCalledWith(m.el());
    setProps({ ref: refFn, title: "b" });
    flush();
    expect(m.el().title).toBe("b");
    expect(refFn).toHaveBeenCalledTimes(1);
    m.dispose();
  });

  test("re-called with the element when the ref prop changes to a different function", () => {
    const first = vi.fn();
    const second = vi.fn();
    const [props, setProps] = createSignal<any>({ ref: first });
    const m = mount(() => <div {...props()} />);
    expect(first).toHaveBeenCalledTimes(1);
    setProps({ ref: second });
    flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(m.el());
    // Removing the ref and adding it back re-applies.
    setProps({});
    flush();
    setProps({ ref: second });
    flush();
    expect(second).toHaveBeenCalledTimes(2);
    m.dispose();
  });

  test("array refs are applied, once", () => {
    const a = vi.fn();
    const b = vi.fn();
    const [title, setTitle] = createSignal("t");
    const arr = [a, [b]];
    const m = mount(() => (
      <div
        {...{
          ref: arr,
          get title() {
            return title();
          }
        }}
      />
    ));
    expect(a).toHaveBeenCalledWith(m.el());
    expect(b).toHaveBeenCalledWith(m.el());
    setTitle("u");
    flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    m.dispose();
  });

  test("ref is never written as an attribute", () => {
    const m = mount(() => <div {...{ ref: () => {}, id: "i" }} />);
    expect(m.el().hasAttribute("ref")).toBe(false);
    expect(m.el().id).toBe("i");
    m.dispose();
  });
});

describe("children stay a separate effect", () => {
  test("children are NOT re-created when an attribute changes", () => {
    let instances = 0;
    function Child() {
      instances++;
      return <span>child</span>;
    }
    const [cls, setCls] = createSignal("a");
    const props = {
      get class() {
        return cls();
      },
      get children() {
        return <Child />;
      }
    };
    const m = mount(() => <div {...props} />);
    expect(instances).toBe(1);
    expect(m.el().innerHTML).toBe("<span>child</span>");
    setCls("b");
    flush();
    expect(m.el().className).toBe("b");
    expect(instances).toBe(1);
    m.dispose();
  });

  test("children DO update when the children getter's dependency changes", () => {
    const [count, setCount] = createSignal(0);
    const [cls, setCls] = createSignal("a");
    const spy = vi.fn();
    const props = {
      get class() {
        spy();
        return cls();
      },
      get children() {
        return `n=${count()}`;
      }
    };
    const m = mount(() => <div {...props} />);
    expect(m.el().textContent).toBe("n=0");
    expect(spy).toHaveBeenCalledTimes(1);
    setCount(1);
    flush();
    expect(m.el().textContent).toBe("n=1");
    // The attribute effect did not re-run for a children-only change.
    expect(spy).toHaveBeenCalledTimes(1);
    setCls("b");
    flush();
    expect(m.el().className).toBe("b");
    expect(m.el().textContent).toBe("n=1");
    m.dispose();
  });

  test("plain data children render; unrelated updates change nothing observable", () => {
    const [title, setTitle] = createSignal("t");
    const props = {
      children: "static text",
      get title() {
        return title();
      }
    };
    const m = mount(() => <div {...props} />);
    expect(m.el().textContent).toBe("static text");
    const textNode = m.el().firstChild;
    setTitle("u");
    flush();
    expect(m.el().title).toBe("u");
    expect(m.el().firstChild).toBe(textNode);
    expect(m.el().textContent).toBe("static text");
    m.dispose();
  });

  test("plain data children that are a function still resolve reactively", () => {
    const [count, setCount] = createSignal(0);
    // A function is not a JSX.Element type-wise, but insert() resolves it.
    const props = { children: () => `n=${count()}` } as any;
    const m = mount(() => <div {...props} />);
    expect(m.el().textContent).toBe("n=0");
    setCount(1);
    flush();
    expect(m.el().textContent).toBe("n=1");
    m.dispose();
  });

  test("skipChildren leaves children alone", () => {
    const host = document.createElement("div");
    const dispose = createRoot(d => {
      const el = document.createElement("div");
      host.appendChild(el);
      spread(el, { children: "nope", id: "x" }, true);
      return d;
    });
    flush();
    expect(host.innerHTML).toBe('<div id="x"></div>');
    dispose();
  });
});

describe("sources array", () => {
  const spreadInto = (
    sources: unknown[],
    skipChildren?: boolean,
    skip?: (key: string) => boolean
  ) => {
    const host = document.createElement("div");
    let el!: HTMLElement;
    const dispose = createRoot(d => {
      el = document.createElement("div");
      host.appendChild(el);
      spread(el, sources, skipChildren, skip);
      return d;
    });
    flush();
    return { el, host, dispose };
  };

  test("later sources win; shadowed getters are never invoked; the winner is read once per run", () => {
    const shadowed = vi.fn(() => "shadowed");
    const winner = vi.fn(() => "winner");
    const other = vi.fn(() => "o");
    const s = spreadInto([
      {
        get title() {
          return shadowed();
        },
        get "data-other"() {
          return other();
        }
      },
      {
        get title() {
          return winner();
        }
      }
    ]);
    expect(s.el.title).toBe("winner");
    expect(s.el.getAttribute("data-other")).toBe("o");
    expect(shadowed).not.toHaveBeenCalled();
    expect(winner).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  test("a later source's own `undefined` shadows an earlier value (Object.assign contract)", () => {
    const s = spreadInto([{ title: "a" }, { title: undefined }]);
    expect(s.el.hasAttribute("title")).toBe(false);
    s.dispose();
  });

  test("skip predicate: skipped keys are never read or applied", () => {
    const secret = vi.fn(() => "s");
    const s = spreadInto(
      [
        {
          id: "keep",
          get secret() {
            return secret();
          }
        },
        { "data-b": "b" }
      ],
      true,
      key => key === "secret" || key === "data-b"
    );
    expect(s.el.id).toBe("keep");
    expect(s.el.hasAttribute("secret")).toBe(false);
    expect(s.el.hasAttribute("data-b")).toBe(false);
    expect(secret).not.toHaveBeenCalled();
    s.dispose();
  });

  test("nullish sources are skipped", () => {
    const s = spreadInto([null, { id: "a" }, undefined, { title: "t" }]);
    expect(s.el.id).toBe("a");
    expect(s.el.title).toBe("t");
    s.dispose();
  });

  test("function sources are called inline and re-apply when their signal changes", () => {
    const [rest, setRest] = createSignal<Record<string, any> | null>({ title: "x", "data-a": "1" });
    const calls = vi.fn(() => rest());
    // skipChildren: the children insert is its own tracking scope and resolves
    // the sources itself; this pins the attribute effect's single call per run.
    const s = spreadInto([{ id: "i", title: "static" }, calls], true);
    expect(s.el.title).toBe("x");
    expect(s.el.getAttribute("data-a")).toBe("1");
    expect(calls).toHaveBeenCalledTimes(1);
    setRest({ "data-a": "2" });
    flush();
    expect(s.el.getAttribute("data-a")).toBe("2");
    expect(s.el.title).toBe("static"); // dropped from the function source → earlier value returns
    expect(calls).toHaveBeenCalledTimes(2);
    setRest(null); // a nullish resolution is an empty source
    flush();
    expect(s.el.hasAttribute("data-a")).toBe(false);
    expect(s.el.id).toBe("i");
    s.dispose();
  });

  test("children come from the last source that owns the key", () => {
    const [n, setN] = createSignal(0);
    const s = spreadInto([
      { children: "first", id: "a" },
      {
        get children() {
          return `second ${n()}`;
        }
      }
    ]);
    expect(s.el.textContent).toBe("second 0");
    setN(1);
    flush();
    expect(s.el.textContent).toBe("second 1");
    s.dispose();
  });

  test("ref in a sources array is applied once and diffed by identity", () => {
    const refFn = vi.fn();
    const [title, setTitle] = createSignal("t");
    const s = spreadInto([{ ref: refFn }, () => ({ title: title() })]);
    expect(refFn).toHaveBeenCalledTimes(1);
    expect(refFn).toHaveBeenCalledWith(s.el);
    setTitle("u");
    flush();
    expect(s.el.title).toBe("u");
    expect(refFn).toHaveBeenCalledTimes(1);
    s.dispose();
  });
});

describe("existing contracts", () => {
  test("reactive lone spread still works (#3105)", () => {
    const [props, setProps] = createSignal<any>({ id: "a", title: "t" });
    const m = mount(() => <div {...props()} />);
    expect(m.el().id).toBe("a");
    setProps({ id: "b" });
    flush();
    expect(m.el().id).toBe("b");
    expect(m.el().hasAttribute("title")).toBe(false);
    m.dispose();
  });

  test("nullish source removes attributes (#3297)", () => {
    const [props, setProps] = createSignal<any>({ id: "a" });
    const m = mount(() => <div {...props()} />);
    expect(m.el().id).toBe("a");
    setProps(null);
    flush();
    expect(m.el().hasAttribute("id")).toBe(false);
    setProps({ id: "c" });
    flush();
    expect(m.el().id).toBe("c");
    m.dispose();
  });
});
