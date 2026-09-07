/**
 * UNSTABLE_LIST_IDENTITY: a mapArray update that disposes and recreates most
 * rows for items equivalent to the ones they replaced (fresh objects for the
 * same records) is reported once per list; real turnover and stable keys are
 * not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemo, createRoot, createSignal, DEV, flush, mapArray } from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  DEV!.attribution.enable({ log: false });
  const hits: DiagnosticEvent[] = [];
  DEV!.diagnostics.subscribe(e => {
    if (e.code === "UNSTABLE_LIST_IDENTITY") hits.push(e);
  });
  return hits;
}

interface Row {
  id: number;
  name: string;
}
const rows = (n: number, name = (i: number) => `row ${i}`): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: name(i + 1) }));

function listFixture(keyed?: (item: Row) => unknown) {
  const [items, setItems] = createSignal<Row[]>(rows(10));
  let created = 0;
  createRoot(() => {
    const mapped = keyed
      ? mapArray(
          items,
          item => {
            created++;
            return item().id;
          },
          { keyed, name: "rows" }
        )
      : mapArray(
          items,
          item => {
            created++;
            return item.id;
          },
          { name: "rows" }
        );
    createMemo(() => mapped().length);
    mapped();
  });
  flush();
  created = 0;
  return { setItems, count: () => created };
}

describe("UNSTABLE_LIST_IDENTITY", () => {
  it("reports a re-fetch that hands back equivalent objects under identity keying", () => {
    const hits = arm();
    const { setItems, count } = listFixture();
    setItems(rows(10));
    flush();
    expect(count()).toBe(10);
    expect(hits).toHaveLength(1);
    const [entry] = hits;
    expect(entry.severity).toBe("warn");
    expect(entry.kind).toBe("perf");
    expect(entry.nodeName).toBe("rows");
    expect(entry.message).toContain('list "rows" recreated 10 of 10 rows');
    expect(entry.message).toContain("8 of 8 sampled pairs identical field-for-field");
    expect(entry.message).toContain("keyed: item => item.id");
    expect(entry.message).toContain('reconcile(data, "id")');
    expect(entry.data).toEqual({
      removed: 10,
      created: 10,
      length: 10,
      sampled: 8,
      equivalent: 8,
      keyed: false
    });
    // Once per list.
    setItems(rows(10));
    flush();
    expect(hits).toHaveLength(1);
  });

  it("does not report a list keyed by a stable field", () => {
    const hits = arm();
    const { setItems, count } = listFixture(item => item.id);
    setItems(rows(10));
    flush();
    expect(count()).toBe(0);
    expect(hits).toEqual([]);
  });

  it("blames the key function when keyed rows still churn for equivalent records", () => {
    const hits = arm();
    // Keyed by the object itself — as unstable as identity.
    const { setItems } = listFixture(item => item);
    setItems(rows(10));
    flush();
    expect(hits).toHaveLength(1);
    expect(hits[0].data!.keyed).toBe(true);
    expect(hits[0].message).toContain("The key function returned different keys");
  });

  it("does not report genuine turnover (different records)", () => {
    const hits = arm();
    const { setItems } = listFixture();
    setItems(rows(10, i => `other ${i}`).map((r, i) => ({ ...r, id: 100 + i })));
    flush();
    expect(hits).toEqual([]);
  });

  it("does not report a small edit to a mostly-retained list", () => {
    const hits = arm();
    const [items, setItems] = createSignal<Row[]>(rows(10));
    createRoot(() => {
      const mapped = mapArray(items, item => item.id, { name: "rows" });
      createMemo(() => mapped().length);
    });
    flush();
    const current = items();
    setItems([...current.slice(0, 8), { id: 9, name: "row 9" }, { id: 10, name: "row 10" }]);
    flush();
    expect(hits).toEqual([]);
  });
});
