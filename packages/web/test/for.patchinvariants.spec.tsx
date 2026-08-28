/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * Driver invariant harness (re-audit 7). Written from the DRIVER'S CONTRACT,
 * not from failure instances: each block states an invariant and drives it
 * across every code path that must uphold it. New driver entry points must
 * be added to these matrices in the same commit that introduces them.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  createRoot,
  createSignal,
  createStore,
  flush,
  For,
  reconcile,
  resetErrorHalt
} from "solid-js";
import { patchDriver, rowProof } from "@solidjs/web";

interface Row {
  id: number;
  label: string;
}

const buildRow = (db: Row) => {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  const text = document.createTextNode("");
  td.appendChild(text);
  tr.appendChild(td);
  patchDriver(db, (n: Row, p: Row, f?: boolean) => {
    if (f || n.label !== p.label) (text as Text).data = n.label;
  });
  return tr as unknown as any;
};

const rows = (div: HTMLElement) => Array.from(div.querySelectorAll("tr"));
const labels = (div: HTMLElement) =>
  rows(div)
    .map(tr => tr.textContent)
    .join(",");
const make = (...ids: number[]): Row[] => ids.map(id => ({ id, label: `L${id}` }));

// Poison factory shared by the atomicity matrix: rows labelled BOOM register
// a live-probe patch FIRST (real compiled output registers before later
// template statements can throw), then throw. `applies` counts leaked
// dispatches — a severed registration never grows it.
function makePoison(applies: { n: number }) {
  return rowProof((db: Row) => {
    if (db.label.startsWith("BOOM")) {
      patchDriver(db, () => {
        applies.n++;
      });
      throw new Error("row build boom");
    }
    return buildRow(db);
  });
}

describe("INVARIANT: a throwing row build leaves DOM, bookkeeping, and sibling registrations atomic — at EVERY build entry point", () => {
  test("entry point: initial client construction", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const applies = { n: 0 };
      const poison = makePoison(applies);
      const [state, setState] = createStore({
        rows: [make(1)[0], { id: 9, label: "BOOM" }, make(3)[0]]
      });
      expect(() => (
        <div ref={div}>
          <For each={state.rows}>{poison}</For>
        </div>
      )).toThrow("row build boom");
      resetErrorHalt();
      // Nothing mounted, nothing left half-built.
      expect(rows(div).length).toBe(0);
      // The completed row 1 and the poison's own partial registration are
      // severed: later writes reach nobody.
      const before = applies.n;
      setState(s => {
        s.rows[1].label = "BOOM2";
      });
      flush();
      expect(applies.n).toBe(before);
      dispose();
    });
  });

  test("entry point: staged update build (ops application)", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const applies = { n: 0 };
      const poison = makePoison(applies);
      const [state, setState] = createStore({ rows: make(1, 2, 3) });
      <div ref={div}>
        <For each={state.rows}>{poison}</For>
      </div>;
      const [tr1, tr2, tr3] = rows(div);
      setState(s => {
        reconcile([make(1)[0], { id: 9, label: "BOOM" }, make(3)[0]], "id")(s.rows);
      });
      expect(() => flush()).toThrow("row build boom");
      resetErrorHalt();
      expect(labels(div)).toBe("L1,L2,L3");
      expect(rows(div)[0]).toBe(tr1);
      expect(rows(div)[1]).toBe(tr2);
      expect(rows(div)[2]).toBe(tr3);
      const before = applies.n;
      setState(s => {
        s.rows[1].label = "BOOM2";
      });
      flush();
      expect(applies.n).toBe(before);
      dispose();
    });
  });

  test("entry point: shallow slot rebuild (reference replacement)", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const applies = { n: 0 };
      const poison = makePoison(applies);
      // Shallow LIST of deep-store records: slot values are patchable
      // records, so row builds register real channels — the leak surface.
      const [recs, setRecs] = createStore<{ all: Row[] }>({ all: make(1, 2, 3) });
      const [shRows, setState] = createStore([recs.all[0], recs.all[1], recs.all[2]], {
        shallow: true
      } as any);
      <div ref={div}>
        <For each={shRows}>{poison}</For>
      </div>;
      expect(labels(div)).toBe("L1,L2,L3");
      const [tr1, tr2, tr3] = rows(div);

      // Key-aligned reference replacement whose replacement build throws.
      const boom = { id: 2, label: "BOOM" };
      setState(s => {
        reconcile([recs.all[0], boom, recs.all[2]], "id")(s);
      });
      expect(() => flush()).toThrow("row build boom");
      resetErrorHalt();

      // Atomic: the old row is still mounted, still REGISTERED (its record's
      // value ticks must keep applying — a severed-but-mounted row is silent
      // staleness, the worst failure shape), and the poison's partial
      // registration is severed.
      expect(labels(div)).toBe("L1,L2,L3");
      expect(rows(div)[1]).toBe(tr2);
      const before = applies.n;
      setRecs(s => {
        s.all[1].label = "LIVE2";
      });
      flush();
      expect(applies.n).toBe(before);
      expect(rows(div)[1].textContent).toBe("LIVE2");

      // Recovery: a healthy replacement rebuilds the slot.
      setState(s => {
        reconcile([recs.all[0], { id: 2, label: "H2" }, recs.all[2]], "id")(s);
      });
      flush();
      expect(labels(div)).toBe("L1,H2,L3");
      expect(rows(div)[0]).toBe(tr1);
      expect(rows(div)[2]).toBe(tr3);
      dispose();
    });
  });

  test("entry point: identity resync after a failed apply", () => {
    createRoot(dispose => {
      let div!: HTMLDivElement;
      const applies = { n: 0 };
      const poison = makePoison(applies);
      const [state, setState] = createStore({ rows: make(1, 2, 3) });
      <div ref={div}>
        <For each={state.rows}>{poison}</For>
      </div>;
      const [tr1, tr2, tr3] = rows(div);
      // First failure arms resyncNeeded.
      setState(s => {
        reconcile([make(1)[0], { id: 9, label: "BOOM" }, make(3)[0]], "id")(s.rows);
      });
      expect(() => flush()).toThrow("row build boom");
      resetErrorHalt();
      // The next LIST event triggers the identity resync (deep contract:
      // value-only recovery waits for structure); the resync build throws
      // too (the poison row is still in the store) — the resync itself must
      // be atomic, same contract as any build.
      setState(s => {
        reconcile([make(3)[0], { id: 9, label: "BOOM" }, make(1)[0]], "id")(s.rows);
      });
      expect(() => flush()).toThrow("row build boom");
      resetErrorHalt();
      expect(rows(div)[0]).toBe(tr1);
      expect(rows(div)[1]).toBe(tr2);
      expect(rows(div)[2]).toBe(tr3);
      // Healthy state recovers content through the retried resync.
      setState(s => {
        reconcile(make(1, 3), "id")(s.rows);
      });
      flush();
      expect(labels(div)).toBe("L1,L3");
      dispose();
    });
  });
});

describe("INVARIANT: recorded read sets cover every key a Tier-2 body CAN read (branches included)", () => {
  test("a ternary body's untaken branch still demotes when that key becomes a getter", () => {
    const [dep, setDep] = createRoot(() => createSignal("sig-b"));
    const [state, setState] = createStore<any>({
      cell: { flag: true, a: "A", b: "B" }
    });
    const text = document.createTextNode("");
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // Hand-written mirror of Tier-2 compiled output for
      // `textContent={cell.flag ? cell.a : cell.b}` — under the initial
      // force-apply only ONE branch's key is read.
      patchDriver(state.cell, (n: any, p: any, f?: boolean) => {
        if (f || n.flag !== p.flag || (n.flag ? n.a : n.b) !== (p.flag ? p.a : p.b))
          text.data = n.flag ? n.a : n.b;
      });
    });
    expect(text.data).toBe("A");
    // `b` — never read by any apply so far — becomes getter-backed while
    // the flag flips. The channel must treat the body's FULL read
    // envelope as recorded: this adoption demotes, and the getter's
    // outside dependency keeps re-applying through the tracked fallback.
    setState((s: any) => {
      reconcile(
        {
          flag: false,
          a: "A",
          get b() {
            return dep();
          }
        },
        "id"
      )(s.cell);
    });
    flush();
    expect(text.data).toBe("sig-b");
    setDep("sig-b2");
    flush();
    expect(text.data).toBe("sig-b2");
    dispose();
  });
});
