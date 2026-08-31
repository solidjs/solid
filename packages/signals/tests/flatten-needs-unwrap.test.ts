/**
 * #3133: `flattenArray` must OR its `needsUnwrap` flag with a nested call's
 * result, not overwrite it. Under `doNotUnwrap`, a function child (a
 * `<For>`/`<Repeat>`/memo accessor) followed at the same level by an array
 * child containing no functions (a fragment) reset the flag, so `flatten`
 * returned the plain results array with the raw accessor still inside it
 * instead of the resolving wrapper. `@solidjs/web` masked this with its
 * insertExpression function branch; universal renderers passed the raw memo
 * to the host's insertNode and crashed.
 */
import { describe, expect, it } from "vitest";
import { createMemo, createRoot, flatten } from "../src/index.js";

const OPTS = { skipNonRendered: true, doNotUnwrap: true };

describe("#3133: flatten needsUnwrap under doNotUnwrap", () => {
  it("keeps the wrapper when a function-free fragment follows an accessor", () => {
    createRoot(() => {
      const accessor = createMemo(() => "from memo");
      const out = flatten([accessor, ["a", "b"]], OPTS);
      expect(typeof out).toBe("function");
      expect(out()).toEqual(["from memo", "a", "b"]);
    });
  });

  it("keeps the wrapper when the accessor is inside an earlier fragment", () => {
    createRoot(() => {
      const accessor = createMemo(() => "nested");
      const out = flatten([[accessor], ["plain"]], OPTS);
      expect(typeof out).toBe("function");
      expect(out()).toEqual(["nested", "plain"]);
    });
  });

  it("still returns a plain array when nothing needs unwrapping", () => {
    const out = flatten(["a", ["b", "c"]], OPTS);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual(["a", "b", "c"]);
  });
});
