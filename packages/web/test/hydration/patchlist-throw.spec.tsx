/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/** Hydration slice of the re-audit-7 driver invariant harness — lives under
 * test/hydration/ because these specs compile hydratable through their own
 * vitest config. */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createStore, flush, For, resetErrorHalt, enableHydration } from "solid-js";
import { getNextElement, hydrate, patchDriver, rowProof, template } from "@solidjs/web";

interface Row {
  id: number;
  label: string;
}

describe("INVARIANT: hydration failure surrenders the list's ENTIRE server DOM region", () => {
  enableHydration();
  const rowTmpl = template("<li> ");
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    if (dispose) dispose();
    dispose = undefined;
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    container.innerHTML = "";
  });
  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  test("a throwing claim removes completed, claimed, AND trailing server rows", () => {
    container.innerHTML =
      "<ul _hk=0><li _hk=a0>L1</li><li _hk=b0>L2</li><li _hk=c0>L3</li><li _hk=d0>L4</li></ul>";
    const hydratingPoison = rowProof((r: Row) => {
      const li = getNextElement(rowTmpl) as HTMLElement;
      if (r.label === "BOOM") throw new Error("hydration claim boom");
      const text = li.firstChild as Text;
      patchDriver(r, (n: Row, p: Row, f?: boolean) => {
        if (f || n.label !== p.label) text.data = n.label;
      });
      return li as unknown as any;
    });
    const [state] = createStore({
      rows: [
        { id: 1, label: "L1" },
        { id: 2, label: "BOOM" },
        { id: 3, label: "L3" },
        { id: 4, label: "L4" }
      ] as Row[]
    });
    expect(() => {
      dispose = hydrate(
        () => (
          <ul>
            <For each={state.rows}>{hydratingPoison}</For>
          </ul>
        ),
        container
      );
    }).toThrow("hydration claim boom");
    dispose = undefined;
    resetErrorHalt();
    // No orphaned server rows: a boundary fallback rendering into this
    // region must not sit beside stale rows 3 and 4.
    expect(container.querySelectorAll("li").length).toBe(0);
  });
});
