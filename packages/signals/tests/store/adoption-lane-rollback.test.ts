/**
 * Rule test (INTERNALS-STORE-STATE.md RUL-5 / recon-snap R22 gap) — a
 * reconcile performed inside an optimistic action window is tentatively
 * visible and must FULLY revert at settle: values, array length, key
 * membership, and captured-proxy views all restore to committed state.
 * "Adoption resets ownership" must have a defined meaning when the adoption
 * itself is tentative — rollback restores prior backing and prior structure.
 */
import { expect, test } from "vitest";
import {
  action,
  createEffect,
  createOptimisticStore,
  createRoot,
  flush,
  reconcile
} from "../../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

test("reconcile inside an action window is tentative: full revert at settle", async () => {
  type Row = { id: string; v: number };
  let s!: { rows: Row[]; tag?: string };
  let setS!: (fn: (d: { rows: Row[]; tag?: string }) => void) => void;
  const views: number[][] = [];
  const lengths: number[] = [];

  createRoot(() => {
    [s, setS] = createOptimisticStore<{ rows: Row[]; tag?: string }>({
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 }
      ]
    });
    createEffect(
      () => s.rows.map(r => r.v),
      v => {
        views.push(v);
      }
    );
    createEffect(
      () => s.rows.length,
      l => {
        lengths.push(l);
      }
    );
  });
  flush();
  expect(views.at(-1)).toEqual([1, 2]);

  const capturedRow = s.rows[0];

  let resolveWork!: () => void;
  const run = action(function* () {
    setS(d => {
      reconcile(
        {
          rows: [
            { id: "a", v: 10 },
            { id: "c", v: 30 },
            { id: "d", v: 40 }
          ],
          tag: "tentative"
        },
        "id"
      )(d);
    });
    yield new Promise<void>(r => (resolveWork = r));
  })();
  flush();

  // Tentatively visible: values, structure, key membership, captured proxy.
  expect(views.at(-1)).toEqual([10, 30, 40]);
  expect(lengths.at(-1)).toBe(3);
  expect(s.tag).toBe("tentative");
  expect("tag" in s).toBe(true);
  expect(capturedRow.v).toBe(10);

  // Settle: values, structure, and captures restore.
  resolveWork();
  await run;
  await tick();
  flush();

  expect(views.at(-1)).toEqual([1, 2]);
  expect(lengths.at(-1)).toBe(2);
  expect(capturedRow.v).toBe(1);
  expect(s.rows[0]).toBe(capturedRow);
});

// FINDING-2 (docs/rules-mining/FINDINGS.md): failed on shipped — a key ADDED by a
// reconcile inside the action window survived settle. FIXED by the rewrite's
// tentative reconcile channel (§6b): membership rides armed presence nodes,
// so additions revert with their transaction exactly like deletes (RUL-8's
// key-set prediction, landed 2026-08-18).
test("a key added by an in-window reconcile reverts at settle", async () => {
  let s!: { rows: { id: string; v: number }[]; tag?: string };
  let setS!: (fn: (d: { rows: { id: string; v: number }[]; tag?: string }) => void) => void;
  createRoot(() => {
    [s, setS] = createOptimisticStore<{ rows: { id: string; v: number }[]; tag?: string }>({
      rows: [{ id: "a", v: 1 }]
    });
    createEffect(
      () => s.rows.map(r => r.v),
      () => {}
    );
  });
  flush();

  let resolveWork!: () => void;
  const run = action(function* () {
    setS(d => {
      reconcile({ rows: [{ id: "a", v: 1 }], tag: "tentative" }, "id")(d);
    });
    yield new Promise<void>(r => (resolveWork = r));
  })();
  flush();
  expect(s.tag).toBe("tentative");

  resolveWork();
  await run;
  await tick();
  flush();

  expect(s.tag).toBe(undefined);
  expect("tag" in s).toBe(false);
});
