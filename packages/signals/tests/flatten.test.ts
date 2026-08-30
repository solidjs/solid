import { createMemo, createRoot, flatten } from "../src/index.js";

describe("flatten", () => {
  it("preserves deferred unwrapping when a nested array follows an accessor", () => {
    createRoot(() => {
      const accessor = createMemo(() => "from memo");
      const result = flatten([accessor, ["fragment"]], {
        skipNonRendered: true,
        doNotUnwrap: true
      });

      expect(result).toBeTypeOf("function");
      expect(result()).toEqual(["from memo", "fragment"]);
    });
  });

  it("preserves deferred unwrapping from nested children", () => {
    createRoot(() => {
      const accessor = createMemo(() => "from memo");
      const result = flatten([[accessor, "nested sibling"], ["trailing fragment"]], {
        skipNonRendered: true,
        doNotUnwrap: true
      });

      expect(result).toBeTypeOf("function");
      expect(result()).toEqual(["from memo", "nested sibling", "trailing fragment"]);
    });
  });
});
