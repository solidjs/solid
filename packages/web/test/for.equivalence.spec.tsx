/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  For,
  reconcile
} from "solid-js";
import { patchDriver, rowProof } from "@solidjs/web";

// EQUIVALENCE MATRIX (PROPOSAL-KEYED-LIST-DRIVER §8.1, the audit's merge
// gate): for every identity mode × operation sequence, the patch-mode list
// driver must produce EXACTLY the DOM behavior of the classic path — same
// content, same order, and the same retention topology (which positions
// keep their physical node, which get a new one, and where retained nodes
// came from). The two sides run the SAME scenario:
//
//   - driver side: a hand-compiled patch-mode row (template clone + ONE
//     patchDriver body), rowProof-stamped — the driver engages.
//   - classic side: the same DOM built under a grouped render effect (what
//     classic compilation emits), UNSTAMPED — the driver declines before
//     any DOM work and mapArray owns the list.
//
// Traces are normalized so incidental differences (creation serial order)
// cannot mask or fake divergence: per step, each position reports either
// "new" or "from:<previous position of that physical node>".

interface Row {
  id: number;
  label: string;
}

type Step = { content: string; topology: string[] };
type Op = { kind: "reconcile"; data: Row[] } | { kind: "swap"; data: Row[] }; // identity swap: s.rows = fresh (deep root only)

const make = (...ids: number[]): Row[] => ids.map(id => ({ id, label: `L${id}` }));
const relabel = (rows: Row[], id: number, label: string): Row[] =>
  rows.map(r => (r.id === id ? { id: r.id, label } : r));

// Driver row: mirrors compiled patch-mode output. One template, one body.
const driverRow = rowProof((db: Row) => {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  const text = document.createTextNode("");
  td.appendChild(text);
  tr.appendChild(td);
  patchDriver(db, (n: Row, p: Row, f?: boolean) => {
    if (f || n.label !== p.label) (text as Text).data = n.label;
    if (f || n.id !== p.id) tr.setAttribute("data-id", String(n.id));
  });
  return tr as unknown as any;
});

// Classic row: same DOM, grouped render effect (classic compiled shape),
// deliberately UNSTAMPED so the driver declines.
const classicRow = (db: Row) => {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  const text = document.createTextNode("");
  td.appendChild(text);
  tr.appendChild(td);
  createRenderEffect(
    () => ({ label: db.label, id: db.id }),
    (v: { label: string; id: number }, p?: { label: string; id: number }) => {
      if (!p || v.label !== p.label) (text as Text).data = v.label;
      if (!p || v.id !== p.id) tr.setAttribute("data-id", String(v.id));
    }
  );
  return tr as unknown as any;
};

function runScenario(
  useDriver: boolean,
  kind: "deep" | "shallow" | "projection",
  opsShared: Op[],
  seedShared: Row[]
): Step[] {
  // Fresh object graphs per run: stores ADOPT/own incoming payloads (raw as
  // truth), so sharing records between the driver and classic runs lets the
  // first run's ownership/adoption contaminate the second's.
  const ops: Op[] = structuredClone(opsShared);
  const seed: Row[] = structuredClone(seedShared);
  const row = useDriver ? driverRow : classicRow;
  const steps: Step[] = [];
  createRoot(dispose => {
    let div!: HTMLDivElement;
    let apply: (op: Op) => void;
    if (kind === "deep") {
      const [state, setState] = createStore({ rows: seed });
      <div ref={div}>
        <For each={state.rows}>{row}</For>
      </div>;
      apply = op => {
        setState(s => {
          if (op.kind === "swap") s.rows = op.data;
          else reconcile(op.data, "id")(s.rows);
        });
      };
    } else if (kind === "projection") {
      // PROJECTION family list (re-admission gate): the driven array is the
      // OUTPUT of a derived store recomputing from a source. Ops mutate the
      // SOURCE; the projection recompute walks reconcile, whose emissions
      // are transition-stamped in the apply queue — the driver must match
      // classic across recomputed structure and value ticks.
      const [source, setSource] = createStore({ rows: seed });
      const [proj] = createStore<{ list: Row[] }>(
        () => ({
          // Identity-preserving derive: source row proxies pass through, so
          // retention semantics are the source's (deep adoption).
          list: source.rows.filter(r => r.label !== "HIDE")
        }),
        { list: [] }
      );
      <div ref={div}>
        <For each={proj.list}>{row}</For>
      </div>;
      apply = op => {
        setSource(s => {
          if (op.kind === "swap") s.rows = op.data;
          else reconcile(op.data, "id")(s.rows);
        });
      };
    } else {
      // Shallow contract: the store IS the array; records are served raw.
      const [state, setState] = createStore(
        seed.map(r => ({ ...r })),
        { shallow: true } as any
      );
      <div ref={div}>
        <For each={state}>{row}</For>
      </div>;
      apply = op => {
        setState(s => {
          reconcile(op.data, "id")(s);
        });
      };
    }
    flush();

    const snapshot = (prev: Node[] | null): { step: Step; nodes: Node[] } => {
      const nodes = Array.from(div.querySelectorAll("tr")) as Node[];
      const content = nodes
        .map(n => `${(n as Element).getAttribute("data-id")}:${n.textContent}`)
        .join(",");
      const topology = nodes.map(n => {
        if (prev === null) return "new";
        const j = prev.indexOf(n);
        return j === -1 ? "new" : `from:${j}`;
      });
      return { step: { content, topology }, nodes };
    };

    let { step, nodes } = snapshot(null);
    steps.push(step);
    for (const op of ops) {
      apply(op);
      flush();
      const s = snapshot(nodes);
      steps.push(s.step);
      nodes = s.nodes;
    }
    dispose();
  });
  flush();
  return steps;
}

function assertEquivalent(kind: "deep" | "shallow", ops: Op[], seed: Row[] = make(1, 2, 3, 4)) {
  const driver = runScenario(true, kind, ops, seed);
  const classic = runScenario(false, kind, ops, seed);
  expect(driver).toEqual(classic);
  return driver;
}

const R = (data: Row[]): Op => ({ kind: "reconcile", data });

describe("equivalence matrix: driver DOM ≡ classic DOM", () => {
  const sequences: Record<string, Op[]> = {
    "aligned value tick": [R(relabel(make(1, 2, 3, 4), 2, "X2"))],
    "replace one record, same keys": [
      R([make(1)[0], { id: 2, label: "R2" }, make(3, 4)[0], make(3, 4)[1]])
    ],
    "reorder (reverse)": [R(make(4, 3, 2, 1))],
    "move + replace through the move": [
      R(make(4, 1, 2, 3)),
      R([{ id: 4, label: "Z4" }, ...make(1, 2, 3)])
    ],
    "add mid": [R(make(1, 2, 5, 3, 4))],
    "remove mid": [R(make(1, 3, 4))],
    "clear then refill": [R([]), R(make(7, 8))],
    "pure append past an aligned prefix": [R(make(1, 2, 3, 4, 5, 6))],
    "append after aligned value tick (same batch)": [
      R([...relabel(make(1, 2, 3, 4), 1, "A1"), ...make(5)])
    ],
    "mixed batch (add+remove+move+value)": [
      R([{ id: 3, label: "M3" }, make(1)[0], { id: 9, label: "N9" }, make(4)[0]])
    ],
    "duplicate-free churn (all fresh records, same keys)": [
      R(make(1, 2, 3, 4).map(r => ({ ...r, label: r.label + "'" })))
    ]
  };

  for (const [name, ops] of Object.entries(sequences)) {
    test(`deep / ${name}`, () => {
      assertEquivalent("deep", ops);
    });
    test(`shallow / ${name}`, () => {
      assertEquivalent("shallow", ops);
    });
    test(`projection / ${name}`, () => {
      assertEquivalent("projection", ops);
    });
  }

  test("projection / recompute-driven structure (filter drops and restores a row)", () => {
    assertEquivalent("projection", [
      // Hiding is a VALUE change on the source that becomes STRUCTURE on the
      // projection output — the recompute's reconcile emits the ops.
      { kind: "reconcile", data: relabel(make(1, 2, 3, 4), 2, "HIDE") },
      { kind: "reconcile", data: relabel(make(1, 2, 3, 4), 2, "BACK") }
    ]);
  });

  test("projection / retention across recompute (untouched rows keep nodes)", () => {
    const trace = assertEquivalent("projection", [
      { kind: "reconcile", data: relabel(make(1, 2, 3, 4), 2, "HIDE") }
    ]);
    // Row 2 leaves the output; 1, 3, 4 keep their physical nodes.
    expect(trace[1].topology).toEqual(["from:0", "from:2", "from:3"]);
  });

  test("deep / identity swap to a fresh array (s.rows = next)", () => {
    assertEquivalent("deep", [
      { kind: "swap", data: make(3, 2, 99) },
      R(relabel(make(3, 2, 99), 2, "Y2"))
    ]);
  });

  test("deep / retention sanity: aligned tick retains every node on BOTH sides", () => {
    const trace = assertEquivalent("deep", [R(relabel(make(1, 2, 3, 4), 2, "X2"))]);
    expect(trace[1].topology).toEqual(["from:0", "from:1", "from:2", "from:3"]);
  });

  test("shallow / retention sanity: replaced record REBUILDS on both sides (identity ruling)", () => {
    const trace = assertEquivalent("shallow", [
      R([make(1)[0], { id: 2, label: "R2" }, make(3, 4)[0], make(3, 4)[1]])
    ]);
    // Every record object is fresh in the payload (shallow reference
    // identity): all four rebuild — classic mapArray semantics exactly.
    expect(trace[1].topology).toEqual(["new", "new", "new", "new"]);
  });
});

// OPTIMISTIC equivalence (family increment 2): structural optimism rides the
// override channel — lane-timed row ops in flight, identity RESYNC on
// revert. Each script snapshots mounted → in-flight → settled and asserts
// driver ≡ classic at every point.
describe("equivalence matrix: optimistic lists", () => {
  type Mutate = (s: { list: Row[] }) => void;

  async function runOptimistic(
    useDriver: boolean,
    mutate: Mutate,
    outcome: "revert" | "land"
  ): Promise<Step[]> {
    const row = useDriver ? driverRow : classicRow;
    const steps: Step[] = [];
    let div!: HTMLDivElement;
    let dispose!: () => void;
    let save!: () => any;
    let settle!: (ok: boolean) => void;
    createRoot(d => {
      dispose = d;
      const [state, setState] = createOptimisticStore<{ list: Row[] }>({ list: make(1, 2, 3) });
      <div ref={div}>
        <For each={state.list}>{row}</For>
      </div>;
      save = action(function* () {
        setState(mutate as any);
        yield new Promise<void>((res, rej) => {
          settle = ok => (ok ? res() : rej(new Error("revert")));
        });
      }) as any;
    });
    flush();

    let nodes: Node[] = [];
    const snap = () => {
      const now = Array.from(div.querySelectorAll("tr")) as Node[];
      const content = now
        .map(n => `${(n as Element).getAttribute("data-id")}:${n.textContent}`)
        .join(",");
      const topology = now.map(n => {
        const j = nodes.indexOf(n);
        return j === -1 ? "new" : `from:${j}`;
      });
      nodes = now;
      steps.push({ content, topology });
    };

    snap(); // mounted
    const p = Promise.resolve(save()).catch(() => {});
    flush();
    snap(); // in-flight optimism
    settle(outcome === "land");
    await p;
    flush();
    snap(); // settled (landed or reverted)
    dispose();
    flush();
    return steps;
  }

  async function assertOptimistic(mutate: Mutate, outcome: "revert" | "land") {
    const driver = await runOptimistic(true, mutate, outcome);
    const classic = await runOptimistic(false, mutate, outcome);
    expect(driver).toEqual(classic);
    return driver;
  }

  const scripts: Record<string, Mutate> = {
    "push a row": s => {
      s.list.push({ id: 9, label: "N9" });
    },
    "remove mid (splice)": s => {
      s.list.splice(1, 1);
    },
    "reorder + value in one draft": s => {
      const [a, b, c] = [s.list[0], s.list[1], s.list[2]];
      s.list[0] = c;
      s.list[1] = a;
      s.list[2] = b;
      s.list[0].label = "Z3";
    },
    "replace the whole list (parent key write)": s => {
      (s as any).list = make(5, 6);
    }
  };

  for (const [name, mutate] of Object.entries(scripts)) {
    test(`optimistic / ${name} — revert`, async () => {
      await assertOptimistic(mutate, "revert");
    });
    test(`optimistic / ${name} — land`, async () => {
      await assertOptimistic(mutate, "land");
    });
  }

  test("optimistic / in-flight visibility sanity: push shows before settle on BOTH sides", async () => {
    const trace = await assertOptimistic(s => {
      s.list.push({ id: 9, label: "N9" });
    }, "revert");
    expect(trace[1].content).toBe("1:L1,2:L2,3:L3,9:N9"); // optimism visible
    expect(trace[2].content).toBe("1:L1,2:L2,3:L3"); // revert restores committed
  });
});
