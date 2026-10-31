import { describe, expect, test } from "vitest";
import { children, createRoot } from "solid-js";
import { ErrorBoundary, Match, renderToString, Switch } from "solid-js/web";
import {
  children as clientChildren,
  createRoot as clientCreateRoot,
  Match as ClientMatch,
  Switch as ClientSwitch
} from "../../src/index.js";

describe.each([
  { name: "server", children, createRoot, Match, Switch },
  {
    name: "client",
    children: clientChildren,
    createRoot: clientCreateRoot,
    Match: ClientMatch,
    Switch: ClientSwitch
  }
])("Switch children on the $name", ({ children, createRoot, Match, Switch }) => {
  function evaluate(props: Parameters<typeof Switch>[0]) {
    return createRoot(dispose => {
      try {
        return children(() => Switch(props))();
      } finally {
        dispose();
      }
    });
  }

  test("finds matches in nested arrays", () => {
    expect(
      evaluate({
        fallback: "fallback",
        children: [
          Match({ when: false, children: "first" }),
          [Match({ when: true, children: "nested" })]
        ]
      })
    ).toBe("nested");
  });

  test("resolves accessors returning matches", () => {
    expect(
      evaluate({
        fallback: "fallback",
        children: () => [
          Match({ when: false, children: "first" }),
          () => Match({ when: true, children: "accessor" })
        ]
      })
    ).toBe("accessor");
  });

  test("uses the first matching branch without reading later conditions", () => {
    expect(
      evaluate({
        children: [
          [Match({ when: true, children: "first" })],
          Match({
            get when() {
              throw new Error("later condition");
            },
            children: "later"
          })
        ]
      })
    ).toBe("first");
  });

  test("preserves the fallback for empty nested arrays", () => {
    expect(evaluate({ fallback: "fallback", children: [[], [[]]] })).toBe("fallback");
  });

  test("passes a keyed match's value to its child", () => {
    expect(
      evaluate({
        children: [[Match({ when: "value", keyed: true, children: value => value })]]
      })
    ).toBe("value");
  });

  test("passes an accessor to an unkeyed match's child", () => {
    expect(
      evaluate({
        children: [[Match({ when: "value", children: value => value() })]]
      })
    ).toBe("value");
  });
});

describe("Switch child errors on the server", () => {
  test.each(["getter", "accessor", "nested accessor"])(
    "preserves an error thrown by a children %s",
    kind => {
      const error = new Error("child failure");
      const fail = () => {
        throw error;
      };
      let received: unknown;
      let fallbackReads = 0;
      const html = renderToString(() =>
        ErrorBoundary({
          fallback: err => {
            received = err;
            return err.message;
          },
          get children() {
            return Switch({
              get children() {
                if (kind === "getter") return fail();
                return kind === "accessor" ? fail : [[fail]];
              },
              get fallback() {
                fallbackReads++;
                return "fallback";
              }
            });
          }
        })
      );
      expect(received).toBe(error);
      expect(fallbackReads).toBe(0);
      expect(html.split("<script>")[0]).toBe("child failure");
    }
  );
});
