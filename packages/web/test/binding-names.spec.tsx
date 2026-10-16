/**
 * The runtime half of `sourceNames.bindings` (and its `locations` kind): the
 * compiled `{ name, loc }` options argument on `effect`/`insert` and the
 * trailing tag and site on `spread` land on the render effect nodes the
 * runtime creates, where the dev and observe tiers read them as the node's
 * label (`_name`) and source location (`_loc`).
 */
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, getOwner, flush, OBSERVE } from "solid-js";
import { effect, insert, spread } from "@solidjs/web";

function ownerName(): string | undefined {
  return (getOwner() as { _name?: string } | null)?._name;
}
function ownerLoc(): string | undefined {
  return (getOwner() as { _loc?: string } | null)?._loc;
}

describe("sourceNames.locations at runtime", () => {
  test("effect and insert carry the compiled loc onto their nodes; a finding inside reports it", () => {
    const seen: (string | undefined)[] = [];
    let event: any;
    const div = document.createElement("div");
    createRoot(() => {
      effect(
        () => {
          seen.push(ownerLoc());
          event = OBSERVE!.diagnostics.emit(
            { code: "INVARIANT_VIOLATION", kind: "error", severity: "error", message: "probe" },
            getOwner()
          );
          return 1;
        },
        () => {},
        { name: "span.textContent", loc: "src/App.tsx:14:7" }
      );
      insert(
        div,
        () => {
          seen.push(ownerLoc());
          return "x";
        },
        undefined,
        undefined,
        { name: "div.children", loc: "src/App.tsx:15:9" }
      );
      effect(
        () => {
          seen.push(ownerLoc());
          return 1;
        },
        () => {}
      );
    });
    flush();
    expect(seen).toEqual(["src/App.tsx:14:7", "src/App.tsx:15:9", undefined]);
    expect(event.loc).toBe("src/App.tsx:14:7");
    expect(event.ownerPath).toEqual(["span.textContent"]);
  });

  test("spread's trailing loc lands on its attribute effect and children insert", () => {
    const seen = new Set<string | undefined>();
    const div = document.createElement("div");
    createRoot(() => {
      spread(
        div,
        () => {
          seen.add(ownerLoc());
          return { title: "t", children: () => (seen.add(ownerLoc()), "x") };
        },
        false,
        undefined,
        "div",
        "src/App.tsx:20:3"
      );
    });
    flush();
    expect([...seen]).toEqual(["src/App.tsx:20:3"]);
  });
});

describe("sourceNames.bindings at runtime", () => {
  test("effect carries the compiled name onto its node", () => {
    const seen: (string | undefined)[] = [];
    createRoot(() => {
      effect(
        () => {
          seen.push(ownerName());
          return 1;
        },
        () => {},
        { name: "span.textContent" }
      );
      effect(
        () => {
          seen.push(ownerName());
          return 1;
        },
        () => {}
      );
    });
    flush();
    expect(seen).toEqual(["span.textContent", "effect"]);
  });

  test("insert names the hole's outer and inner effects alike", () => {
    const seen = new Set<string | undefined>();
    const [count, setCount] = createSignal(1);
    const div = document.createElement("div");
    createRoot(() => {
      // The accessor yields another accessor, so insert opens the inner
      // unwrapping effect too; both should read `div.children`.
      insert(
        div,
        () => {
          seen.add(ownerName());
          return () => {
            seen.add(ownerName());
            return String(count());
          };
        },
        undefined,
        undefined,
        { name: "div.children" }
      );
    });
    flush();
    setCount(2);
    flush();
    expect(div.textContent).toBe("2");
    expect([...seen]).toEqual(["div.children"]);
  });

  test("spread labels its attribute effect `<tag>.spread` and its children insert `<tag>.children`", () => {
    const seen = new Set<string | undefined>();
    const section = document.createElement("section");
    createRoot(() => {
      spread(
        section,
        () => {
          seen.add(ownerName());
          return {
            title: "t",
            get children() {
              seen.add(ownerName());
              return "kids";
            }
          };
        },
        false,
        undefined,
        "section"
      );
    });
    flush();
    expect(section.getAttribute("title")).toBe("t");
    expect(section.textContent).toBe("kids");
    expect([...seen].sort()).toEqual(["section.children", "section.spread"]);
  });

  test("without a name, the runtime's defaults stand", () => {
    const seen = new Set<string | undefined>();
    const div = document.createElement("div");
    createRoot(() => {
      insert(div, () => {
        seen.add(ownerName());
        return "x";
      });
      spread(div, () => {
        seen.add(ownerName());
        return { title: "t" };
      });
    });
    flush();
    expect([...seen]).toEqual(["effect"]);
  });
});
