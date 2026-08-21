/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  For,
  getObserver,
  getOwner,
  reconcile
} from "solid-js";
import { patchDriver } from "../src/index.js";

// Patch-mode list driver (DESIGN-PATCH-CHANNEL §3b): when a keyed `<For>`
// over a store array binds rows that prove PURE (the bind registers patches
// and creates no computations/cleanups), the runtime drives the list through
// the store's row-ops channel — no mapArray, no per-row owners, no DOM-side
// reconcile. These rows are hand-written exactly as patch-mode compilation
// emits them (template clone + one patchDriver body).

interface Row {
  id: number;
  label: string;
}

// Mirrors compiled patch-mode output for `<tr><td textContent={row.label}/></tr>`.
function pureRow(db: Row) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  const text = document.createTextNode("");
  td.appendChild(text);
  tr.appendChild(td);
  patchDriver(db, (n: Row, p: Row, f?: boolean) => {
    if (f || n.label !== p.label) {
      (text as Text).data = n.label;
      tr.setAttribute("data-id", String(n.id));
    }
  });
  return tr as unknown as any;
}

const rows = (div: HTMLElement) => Array.from(div.querySelectorAll("tr"));
const labels = (div: HTMLElement) =>
  rows(div)
    .map(tr => tr.textContent)
    .join(",");
const make = (...ids: number[]): Row[] => ids.map(id => ({ id, label: `L${id}` }));

describe("patch-mode list driver", () => {
  test("value ticks patch retained rows; structure moves/creates/removes nodes", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const owners: unknown[] = [];
      const [state, setState] = createStore({ rows: make(1, 2, 3) });
      const spiedRow = (db: Row) => {
        owners.push(getOwner());
        return pureRow(db);
      };
      <div ref={div}>
        <For each={state.rows}>{spiedRow}</For>
      </div>;
      expect(labels(div)).toBe("L1,L2,L3");
      // Engagement proof: the driver binds every post-probe row under ONE
      // shared list owner (no per-row owners); mapArray would mint one per row.
      expect(owners.length).toBe(3);
      expect(owners[1]).toBe(owners[2]);
      expect(owners[0]).not.toBe(owners[1]);
      const [tr1, tr2, tr3] = rows(div);

      // Value tick: same structure, one label — the row's patch fires, the
      // node is retained, siblings untouched.
      setState(s => {
        reconcile(
          make(1, 2, 3).map(r => (r.id === 2 ? { ...r, label: "X" } : r)),
          "id"
        )(s.rows);
      });
      flush();
      expect(labels(div)).toBe("L1,X,L3");
      expect(rows(div)[1]).toBe(tr2);

      // Move: keyed survivors keep their DOM nodes.
      setState(s => {
        reconcile([make(3)[0], make(1)[0], { id: 2, label: "X" }], "id")(s.rows);
      });
      flush();
      expect(labels(div)).toBe("L3,L1,X");
      expect(rows(div)[0]).toBe(tr3);
      expect(rows(div)[1]).toBe(tr1);
      expect(rows(div)[2]).toBe(tr2);

      // Remove + add in one transition.
      setState(s => {
        reconcile(make(3, 4), "id")(s.rows);
      });
      flush();
      expect(labels(div)).toBe("L3,L4");
      expect(rows(div)[0]).toBe(tr3);
      expect(tr1.isConnected).toBe(false);
      expect(tr2.isConnected).toBe(false);

      dispose();
    });
  });

  test("setter-driven structure (push/splice/permutation) keeps the driven list in sync", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const [state, setState] = createStore({ rows: make(1, 2, 3) });
      <div ref={div}>
        <For each={state.rows}>{pureRow}</For>
      </div>;
      const [tr1, tr2, tr3] = rows(div);

      // splice removal — surviving nodes retained.
      setState(s => {
        s.rows.splice(1, 1);
      });
      flush();
      expect(labels(div)).toBe("L1,L3");
      expect(rows(div)[0]).toBe(tr1);
      expect(rows(div)[1]).toBe(tr3);
      expect(tr2.isConnected).toBe(false);

      // push — appended row binds at op-apply.
      setState(s => {
        s.rows.push({ id: 4, label: "L4" });
      });
      flush();
      expect(labels(div)).toBe("L1,L3,L4");
      expect(rows(div)[0]).toBe(tr1);

      // in-place permutation — same records, nodes move.
      setState(s => {
        s.rows.reverse();
      });
      flush();
      expect(labels(div)).toBe("L4,L3,L1");
      expect(rows(div)[1]).toBe(tr3);
      expect(rows(div)[2]).toBe(tr1);

      // unshift — prepend binds new, retains the rest.
      setState(s => {
        s.rows.unshift({ id: 5, label: "L5" });
      });
      flush();
      expect(labels(div)).toBe("L5,L4,L3,L1");
      expect(rows(div)[3]).toBe(tr1);

      // Permutation authored FROM DRAFT PROXIES (`s.rows = [...permuted
      // reads]`) — deep ingest stores the proxies verbatim; identity
      // matching must unwrap or every row rebuilds (JFB reorder gate).
      const before = rows(div);
      setState(s => {
        s.rows = [s.rows[2], s.rows[3], s.rows[0], s.rows[1]];
      });
      flush();
      expect(labels(div)).toBe("L3,L1,L5,L4");
      expect(rows(div)[0]).toBe(before[2]);
      expect(rows(div)[1]).toBe(before[3]);
      expect(rows(div)[2]).toBe(before[0]);
      expect(rows(div)[3]).toBe(before[1]);

      dispose();
    });
  });

  test("array identity swap retains rows matched by raw identity", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const shared = make(1, 2, 3);
      const [state, setState] = createStore({ rows: shared });
      <div ref={div}>
        <For each={state.rows}>{pureRow}</For>
      </div>;
      const [tr1, , tr3] = rows(div);

      // New array object, two raw rows carried over — mapArray's keyed
      // (identity) semantics: carried rows keep their DOM.
      setState(s => {
        s.rows = [shared[2], { id: 9, label: "L9" }, shared[0]];
      });
      flush();
      expect(labels(div)).toBe("L3,L9,L1");
      expect(rows(div)[0]).toBe(tr3);
      expect(rows(div)[2]).toBe(tr1);

      // The re-registered channel still drives the new array.
      setState(s => {
        reconcile([{ id: 9, label: "N9" }], "id")(s.rows);
      });
      flush();
      expect(labels(div)).toBe("N9");

      dispose();
    });
  });

  test("impure rows decline the driver and keep classic semantics", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      let effectRuns = 0;
      const [state, setState] = createStore({ rows: make(1, 2) });
      const impureRow = (db: Row) => {
        const tr = pureRow(db);
        // A computation created during bind — the probe sees a non-blank
        // owner and hands the list back to mapArray.
        createEffect(
          () => db.label,
          () => {
            effectRuns++;
          }
        );
        return tr;
      };
      <div ref={div}>
        <For each={state.rows}>{impureRow}</For>
      </div>;
      flush();
      expect(labels(div)).toBe("L1,L2");
      const runsAfterMount = effectRuns;

      setState(s => {
        reconcile([make(2)[0], { id: 1, label: "Y" }], "id")(s.rows);
      });
      flush();
      expect(labels(div)).toBe("L2,Y");
      // The per-row effect survives and re-fires — proof rows kept owners
      // (the classic path), not the ownerless patch-list path.
      expect(effectRuns).toBeGreaterThan(runsAfterMount);

      dispose();
    });
  });

  test("empty initial list engages tentatively; first rows prove purity and drive", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const owners: unknown[] = [];
      const [state, setState] = createStore({ rows: [] as Row[] });
      const spiedRow = (db: Row) => {
        owners.push(getOwner());
        return pureRow(db);
      };
      <div ref={div}>
        <For each={state.rows}>{spiedRow}</For>
      </div>;
      expect(rows(div).length).toBe(0);
      // First arrival through the setter channel: deferred probe passes,
      // rows bind ownerlessly (post-probe rows share the list owner).
      setState(s => {
        s.rows.push(...make(1, 2, 3));
      });
      flush();
      expect(labels(div)).toBe("L1,L2,L3");
      expect(owners.length).toBe(3);
      expect(owners[1]).toBe(owners[2]);
      // Still driven: reconcile structure + value patch both apply.
      const [tr1] = rows(div);
      setState(s => {
        reconcile([make(3)[0], { id: 1, label: "Y1" }], "id")(s.rows);
      });
      flush();
      expect(labels(div)).toBe("L3,Y1");
      expect(rows(div)[1]).toBe(tr1);
      dispose();
    });
  });

  test("empty initial list with impure rows late-declines to a working classic path", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      let effectRuns = 0;
      const [state, setState] = createStore({ rows: [] as Row[] });
      const impureRow = (db: Row) => {
        const tr = pureRow(db);
        createEffect(
          () => db.label,
          () => {
            effectRuns++;
          }
        );
        return tr;
      };
      <div ref={div}>
        <For each={state.rows}>{impureRow}</For>
      </div>;
      expect(rows(div).length).toBe(0);
      setState(s => {
        s.rows.push(...make(1, 2));
      });
      flush();
      // The deferred probe declined; the classic re-entry rendered ALL rows
      // with per-row owners (the effect lives and fires).
      expect(labels(div)).toBe("L1,L2");
      setState(s => {
        s.rows[0].label = "Z1";
      });
      flush();
      expect(labels(div)).toBe("Z1,L2");
      expect(effectRuns).toBeGreaterThan(0);
      dispose();
    });
  });

  test("effect fallback keeps DOM writes in the effect phase (reads tracked, writes untracked)", () => {
    // Non-patchable subject (props-shaped: getters over a signal) takes the
    // dual-driver effect fallback. The compiled body's writes must land in
    // the EFFECT phase (observer null — transitions/batching timing), while
    // the read pass still tracks the signal so changes re-apply.
    const [sig, setSig] = createSignal("a");
    const subject = {
      get label() {
        return sig();
      }
    };
    const writes: Array<{ v: string; observed: boolean }> = [];
    createRoot(() => {
      patchDriver(subject, (n: any, p: any, f?: boolean) => {
        const v = n.label;
        if (f || v !== p.label) writes.push({ v, observed: getObserver() !== null });
      });
    });
    flush();
    expect(writes).toEqual([{ v: "a", observed: false }]);
    setSig("b");
    flush();
    expect(writes).toEqual([
      { v: "a", observed: false },
      { v: "b", observed: false }
    ]);
  });

  test("list disposal stops patch dispatch", () => {
    let div!: HTMLDivElement;
    const [state, setState] = createStore({ rows: make(1) });
    const dispose = createRoot(d => {
      <div ref={div}>
        <For each={state.rows}>{pureRow}</For>
      </div>;
      return d;
    });
    expect(labels(div)).toBe("L1");
    const tr = rows(div)[0];
    dispose();
    setState(s => {
      s.rows[0].label = "dead";
    });
    flush();
    expect(tr.textContent).toBe("L1");
  });
});
