// The copy paths of merge() and omit(): what a platform without `Proxy`
// gets. `SUPPORTS_PROXY` is read once at module load, so it is mocked to
// false for this file and every result here is a plain object.
//
// The contract pinned: the same shadowing, hiding, getter liveness and
// descriptor KINDS as the views — the truths `spread` and a component read —
// with the one documented difference that a data property is a snapshot
// taken at merge()/omit() time rather than a live read. What has always
// needed Proxy still does: a store cannot exist without one, and a function
// source (merge's memo) degrades — pinned as a limitation, not a promise.
import { describe, expect, test, vi } from "vitest";

vi.mock("../../src/core/constants.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../../src/core/constants.js")>()),
  SUPPORTS_PROXY: false
}));

import {
  $PROXY,
  createRoot,
  createSignal,
  flush,
  hasStaticKeys,
  merge,
  mergeSources,
  omit,
  omitView,
  resolvedTable,
  SUPPORTS_PROXY
} from "../../src/index.js";

describe("merge/omit without Proxy", () => {
  test("the flag is off and nothing wears the proxy mark", () => {
    expect(SUPPORTS_PROXY).toBe(false);
    const merged = merge({ a: 1 }, { b: 2 });
    const rest = omit({ a: 1, b: 2 }, "a");
    expect($PROXY in merged).toBe(false);
    expect($PROXY in rest).toBe(false);
    // and every view helper reads them as the plain objects they are
    for (const o of [merged, rest]) {
      expect(hasStaticKeys(o)).toBe(true);
      expect(resolvedTable(o)).toBeUndefined();
      expect(mergeSources(o)).toBeUndefined();
      expect(omitView(o)).toBeUndefined();
    }
  });

  test("merge: later sources win, getters stay live, data properties are snapshots", () => {
    const [sig, setSig] = createSignal("x");
    const a = { shadowed: "lower", data: 1 };
    const b = {
      shadowed: "upper",
      get live() {
        return sig();
      }
    };
    const props = merge(a, b);
    expect(props.shadowed).toBe("upper");
    expect(props.live).toBe("x");
    setSig("y");
    flush();
    expect(props.live).toBe("y");
    expect(Object.keys(props).sort()).toEqual(["data", "live", "shadowed"]);
    // the copy-path difference: a source mutated afterwards is not seen
    a.data = 2;
    expect(props.data).toBe(1);
  });

  test("merge: descriptor kinds are the leaves' — data stays data, getter stays getter", () => {
    const props = merge(
      { a: 1 },
      {
        get b() {
          return 2;
        }
      }
    );
    const a = Object.getOwnPropertyDescriptor(props, "a")!;
    expect(a.get).toBeUndefined();
    expect(a.value).toBe(1);
    expect(typeof Object.getOwnPropertyDescriptor(props, "b")!.get).toBe("function");
  });

  test("merge: a single non-function source is returned as is; falsy sources are skipped", () => {
    const only = { a: 1 };
    expect(merge(only)).toBe(only);
    expect(merge(null, only, undefined, false)).toBe(only);
    expect(merge({ a: 1 }, null, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("merge: a copy of a merge is a plain source; writes land on the copy", () => {
    const inner = merge({ type: "button" }, { label: "a" }) as Record<string, unknown>;
    inner.label = "b";
    expect(inner.label).toBe("b");
    const outer = merge({ size: "m" }, inner);
    expect(outer.type).toBe("button");
    expect(outer.label).toBe("b");
    expect(outer.size).toBe("m");
  });

  test("omit: hides by key list or predicate, keeps getters live", () => {
    const [sig, setSig] = createSignal(1);
    const props = {
      $internal: true,
      as: "a",
      class: "btn",
      get count() {
        return sig();
      }
    };
    const byKeys = omit(props, "as");
    expect("as" in byKeys).toBe(false);
    expect(byKeys.class).toBe("btn");
    expect(byKeys.count).toBe(1);
    setSig(2);
    flush();
    expect(byKeys.count).toBe(2);
    expect(typeof Object.getOwnPropertyDescriptor(byKeys, "count")!.get).toBe("function");
    expect(Object.getOwnPropertyDescriptor(byKeys, "class")!.value).toBe("btn");

    const byRule = omit(props, k => (k as string)[0] === "$");
    expect(Object.keys(byRule).sort()).toEqual(["as", "class", "count"]);
  });

  test("the component chain resolves the same way it does through views", () => {
    const [label, setLabel] = createSignal("l");
    const user = {
      as: "a",
      class: "btn",
      get label() {
        return label();
      },
      type: "reset"
    };
    const l1 = merge({ type: "button", role: "button" }, user);
    const l2 = omit(l1, "type");
    const l3 = merge({ as: "button" }, l2);
    const l4 = omit(l3, "as");
    expect(Object.keys(l4).sort()).toEqual(["class", "label", "role"]);
    expect("type" in l4).toBe(false);
    expect("as" in l4).toBe(false);
    expect(l4.role).toBe("button");
    expect(l4.label).toBe("l");
    setLabel("m");
    flush();
    expect(l4.label).toBe("m");
    expect(Object.getOwnPropertyDescriptor(l4, "class")!.value).toBe("btn");
    expect(typeof Object.getOwnPropertyDescriptor(l4, "label")!.get).toBe("function");
  });

  test("LIMITATION: a function source needs Proxy — the copy path does not read through it", () => {
    // merge wraps the function in a memo and the copy walks the memo's own
    // keys, not the object it returns. Unchanged from before the views; a
    // platform without Proxy has never had reactive merge sources.
    createRoot(() => {
      const props = merge({ a: 1 }, () => ({ b: 2 })) as Record<string, unknown>;
      expect(props.a).toBe(1);
      expect(props.b).toBeUndefined();
    });
  });
});
