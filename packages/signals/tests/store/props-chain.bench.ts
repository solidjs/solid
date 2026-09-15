// Tier-1 bench for the props-plumbing chain of a headless-UI component stack,
// at the signals layer (no renderer): the pure cost of composing `merge()`
// and `omit()` the way component libraries do.
//
// Every element such a library renders is reached through the same shape,
// repeated once per component layer:
//
//   props            ← compiled call-site object: data properties for static
//                      attributes, getters for reactive ones
//   merge(defaults, props)          ← component defaults
//   omit(merged, ...consumedKeys)   ← keys the component handles itself
//   merge({…staticAttrs}, rest)     ← the compiler's mergeProps for
//                                      `<Child a="x" b={y()} {...rest} />`
//
// and the element at the bottom enumerates the result and reads every key
// once (what `spread` / `ssrElement` do). The existing utilities bench
// measures one merge or one omit in isolation; each looks cheap. The chain
// is where the cost lives, because every layer re-processes every key of the
// layer below. Depth 3 is a Kobalte `Dialog.Trigger` → `Button.Root` →
// `Polymorphic` stack; depth 7 is a deeply composed app component on top.
//
// "build" is what a component instantiation costs; "build + consume" adds the
// element's single pass over the result. Both are reported so a change that
// moves cost between construction and read (eager copy vs lazy view) is
// visible rather than hidden in a total.

import { bench, describe } from "vitest";
import { createSignal, merge, omit } from "../../src/index.js";

const [label] = createSignal("row");
const [open] = createSignal(false);

/** A compiled `<Trigger as="a" class="btn" … aria-label={label()} …>` props object. */
function userProps(): Record<string, any> {
  return {
    as: "a",
    class: "btn",
    id: "t",
    href: "#row",
    "data-x": "1",
    tabIndex: 0,
    onClick() {},
    get "aria-label"() {
      return label();
    },
    get title() {
      return label();
    },
    get disabled() {
      return open();
    },
    get children() {
      return label();
    }
  };
}

/** One component layer: defaults in, two keys consumed, static + reactive attrs added at the call site. */
function layer(props: Record<string, any>, i: number): Record<string, any> {
  const merged = merge({ type: "button", [`default${i}`]: i }, props);
  const rest = omit(merged, "type", `default${i}`);
  return merge(
    {
      [`data-layer${i}`]: "",
      get [`aria-l${i}`]() {
        return open() ? "true" : "false";
      }
    },
    rest
  );
}

function chain(depth: number): Record<string, any> {
  let props = userProps();
  for (let i = 0; i < depth; i++) props = layer(props, i);
  // The polymorphic renderer at the bottom: hide `as`, read the rest.
  return omit(props, "as");
}

/** What the element does with the result: enumerate once, read each key once. */
function consume(props: Record<string, any>): number {
  let n = 0;
  for (const key in props) if (props[key] !== undefined) n++;
  return n;
}

// No owner needed: no function sources, so merge() creates no memos here.
for (const depth of [1, 3, 7]) {
  describe(`props chain depth ${depth}`, () => {
    let sink: any;
    bench("build", () => {
      sink = chain(depth);
    });
    bench("build + consume", () => {
      sink = consume(chain(depth));
    });
    void sink;
  });
}
