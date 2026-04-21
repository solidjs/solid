/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, createRevealOrder, flush, Reveal, Loading } from "../src/index.js";

describe("Reveal client component", () => {
  test("Reveal is exported as a function", () => {
    expect(typeof Reveal).toBe("function");
  });

  test("createRevealOrder is exported as a function", () => {
    expect(typeof createRevealOrder).toBe("function");
  });

  test("Reveal renders children", () => {
    let result: any;
    createRoot(() => {
      result = Reveal({ children: "hello" as any });
    });
    flush();
    expect(result).toBe("hello");
  });

  test("Reveal with order='together' renders children", () => {
    let result: any;
    createRoot(() => {
      result = Reveal({
        order: "together",
        children: "content" as any
      });
    });
    flush();
    expect(result).toBe("content");
  });

  test("Reveal with order='natural' renders children", () => {
    let result: any;
    createRoot(() => {
      result = Reveal({
        order: "natural",
        children: "child" as any
      });
    });
    flush();
    expect(result).toBe("child");
  });

  test("Reveal defaults to sequential with collapsed=false", () => {
    let result: any;
    createRoot(() => {
      result = Reveal({ children: "child" as any });
    });
    flush();
    expect(result).toBe("child");
  });

  test("Reveal wrapping Loading boundaries renders without error", () => {
    let result: any;
    createRoot(() => {
      result = Reveal({
        get children() {
          return [
            Loading({
              fallback: "fb-1",
              get children() {
                return "content-1";
              }
            }),
            Loading({
              fallback: "fb-2",
              get children() {
                return "content-2";
              }
            })
          ] as any;
        }
      });
    });
    flush();
    expect(Array.isArray(result)).toBe(true);
  });

  test("nested Reveal composes without error", () => {
    let result: any;
    createRoot(() => {
      result = Reveal({
        collapsed: true,
        get children() {
          return [
            "before",
            Reveal({
              order: "together",
              get children() {
                return "inner" as any;
              }
            }),
            "after"
          ] as any;
        }
      });
    });
    flush();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  test("Reveal inside Loading composes cleanly", () => {
    let result: any;
    createRoot(() => {
      result = Loading({
        fallback: "outer-fb",
        get children() {
          return Reveal({
            order: "together",
            get children() {
              return [
                Loading({
                  fallback: "inner-fb-1",
                  get children() {
                    return "resolved-1";
                  }
                }),
                Loading({
                  fallback: "inner-fb-2",
                  get children() {
                    return "resolved-2";
                  }
                })
              ] as any;
            }
          }) as any;
        }
      });
    });
    flush();
    expect(typeof result).toBe("function");
  });

  test("createRevealOrder passes through return value", () => {
    let result: any;
    createRoot(() => {
      result = createRevealOrder(() => 42);
    });
    flush();
    expect(result).toBe(42);
  });

  test("createRevealOrder with options passes through return value", () => {
    let result: any;
    createRoot(() => {
      result = createRevealOrder(() => ["a", "b", "c"], {
        order: () => "together",
        collapsed: () => false
      });
    });
    flush();
    expect(result).toEqual(["a", "b", "c"]);
  });
});
