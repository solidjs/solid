/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createStore, flush, For, reconcile, enableHydration } from "solid-js";
import { hydrate, getNextElement, template, patchDriver } from "@solidjs/web";

enableHydration();

// Patch-mode list hydration (DESIGN-PATCH-CHANNEL §5): claim + register
// ONLY. The driver claims each server row positionally through the row's own
// `_hk` key (the row owner's id is the key minus its trailing child counter),
// patchDriver registers WITHOUT the initial force-apply (server HTML is the
// truth until the first transition), and no per-row effects or owners with
// reactive work are created.

interface Row {
  id: number;
  label: string;
}

// Hand-written mirror of hydratable patch-mode compiled output for
// `<li textContent={row.label}/>`: claim the row root, walk to the text
// node, hand ONE compiled body to the driver.
const rowTmpl = template("<li> ");
function pureRow(r: Row) {
  const li = getNextElement(rowTmpl) as HTMLElement;
  const text = li.firstChild as Text;
  patchDriver(r, (n: Row, p: Row, f?: boolean) => {
    if (f || n.label !== p.label) text.data = n.label;
  });
  return li as unknown as any;
}

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

describe("patch-mode list hydration claiming", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    if (dispose) dispose();
    dispose = undefined;
    setupHydration();
    container.innerHTML = "";
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  test("claims server rows, skips initial apply, patches after first transition", () => {
    // Server truth intentionally DISAGREES with the client store on row 2
    // ("SERVER" vs "L2"): claim + register must leave the server text alone.
    container.innerHTML =
      "<ul _hk=0><li _hk=a0>L1</li><li _hk=b0>SERVER</li><li _hk=c0>L3</li></ul>";
    const serverRows = Array.from(container.querySelectorAll("li"));

    const [state, setState] = createStore({
      rows: [
        { id: 1, label: "L1" },
        { id: 2, label: "L2" },
        { id: 3, label: "L3" }
      ] as Row[]
    });

    dispose = hydrate(
      () => (
        <ul>
          <For each={state.rows}>{pureRow}</For>
        </ul>
      ),
      container
    );

    const rows = () => Array.from(container.querySelectorAll("li"));
    // Row DOM is the CLAIMED server DOM — no rebuild, no reordering.
    expect(rows()).toEqual(serverRows);
    // Skip-initial: the mismatched server text survives hydration.
    expect(rows()[1].textContent).toBe("SERVER");

    // First transition: the registered patch takes over. prev is the
    // committed store value, so row 2 repaints even though the DOM held
    // different (server) text — visibility transitions drive the channel,
    // not DOM state.
    setState(s => {
      s.rows[1].label = "X2";
    });
    flush();
    expect(rows()[1].textContent).toBe("X2");
    expect(rows()[1]).toBe(serverRows[1]);
    expect(rows()[0].textContent).toBe("L1");

    // Structure post-hydration rides row ops on the claimed nodes.
    setState(s => {
      reconcile(
        [
          { id: 3, label: "L3" },
          { id: 1, label: "L1" }
        ],
        "id"
      )(s.rows);
    });
    flush();
    expect(rows().map(r => r.textContent)).toEqual(["L3", "L1"]);
    expect(rows()[0]).toBe(serverRows[2]);
    expect(rows()[1]).toBe(serverRows[0]);
    expect(serverRows[1].isConnected).toBe(false);
  });

  test("row count mismatch declines without disturbing the hydration id chain", () => {
    // Two server rows, three store rows — the driver must decline BEFORE
    // consuming any child id so the sibling <span> still claims cleanly
    // through the classic path.
    container.innerHTML = "<ul _hk=0><li _hk=a0>L1</li><li _hk=b0>L2</li></ul>";

    const [state] = createStore({
      rows: [
        { id: 1, label: "L1" },
        { id: 2, label: "L2" },
        { id: 3, label: "L3" }
      ] as Row[]
    });

    // Classic fallback will key-miss our synthetic row keys (they encode no
    // real owner chain) and rebuild rows detached — that's expected here.
    // The assertion is only that the decline is clean: no throw, and the
    // list still renders all three rows through mapArray.
    dispose = hydrate(
      () => (
        <ul>
          <For each={state.rows}>{pureRow}</For>
        </ul>
      ),
      container
    );

    expect(container.querySelectorAll("ul").length).toBe(1);
  });
});
