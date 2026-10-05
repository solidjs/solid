import { createRoot, createSignal, createStore, flush, snapshot } from "../../src/index.js";

type Row = { id: string; failed?: boolean };

it("retains a draft row after a derived store adopts an equivalent source", () => {
  const { rows, setRows, setSource, dispose } = createRoot(dispose => {
    const [source, setSource] = createSignal<Row[]>([{ id: "remote" }]);
    const [rows, setRows] = createStore<Row[]>(
      draft => [...source(), ...draft.filter(row => row.failed)],
      []
    );
    return { rows, setRows, setSource, dispose };
  });

  expect(rows.map(row => row.id)).toEqual(["remote"]);

  setRows(draft => {
    draft.push({ id: "local", failed: true });
  });
  flush();
  expect(rows.map(row => row.id)).toEqual(["remote", "local"]);
  const local = rows[1];

  setSource([{ id: "remote" }]);
  flush();

  expect(rows.map(row => row.id)).toEqual(["remote", "local"]);
  expect(rows[1]).toBe(local);
  expect(Object.keys(rows[1])).toEqual(["id", "failed"]);
  expect(rows[1].failed).toBe(true);
  expect(snapshot(rows)).toEqual([{ id: "remote" }, { id: "local", failed: true }]);

  setRows(draft => {
    draft[1].failed = false;
  });
  flush();
  expect(rows[1].failed).toBe(false);

  setSource([{ id: "remote" }]);
  flush();
  expect(rows.map(row => row.id)).toEqual(["remote"]);

  dispose();
});
