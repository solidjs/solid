import { chain } from "./fixtures.js";
import { observationReductions } from "./reduce.js";
import { validate, type Scenario } from "./scenario.js";

function mounted(): Scenario {
  const s: Scenario = { ...chain(), version: 2, sources: [-1], anchorShow: false };
  s.readers[0].mounted = false;
  s.readers.push({ id: 1, refs: [0], gated: false, boundary: "none", mounted: true });
  s.turns = [
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "task",
          steps: [
            { op: "mount", reader: 0, value: true },
            { op: "mount", reader: 1, value: false },
            { op: "resolve", node: 0, which: "newest", key: "0:[1]#2" }
          ]
        }
      ]
    },
    { task: 0 }
  ];
  return s;
}

test("mount-to-gate preserves initial visibility, request keys and other mounting controls", () => {
  const s = mounted(),
    before = structuredClone(s);
  const c = [...observationReductions(s)].find(c => c.readers[0].gated)!;
  expect(c.show).toBe(false);
  expect(c.readers[0].mounted).toBeUndefined();
  expect(c.readers[1]).toBe(s.readers[1]);
  expect(c.turns).toEqual([
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "task",
          steps: [
            { op: "show", value: true },
            { op: "mount", reader: 1, value: false },
            { op: "resolve", node: 0, which: "newest", key: "0:[1]#2" }
          ]
        }
      ]
    },
    { task: 0 }
  ]);
  expect(validate(c)).toBeUndefined();
  expect(s).toEqual(before);
});

test("mount conversion does not reuse an observed or explicitly set visibility signal", () => {
  for (const mode of ["anchor", "default-anchor", "reader", "setter"] as const) {
    const s = mounted();
    if (mode === "anchor") s.anchorShow = true;
    if (mode === "default-anchor") delete s.anchorShow;
    if (mode === "reader") s.readers[1].gated = true;
    if (mode === "setter") s.turns.push({ steps: [{ op: "show", value: false }] });
    expect([...observationReductions(s)], mode).toEqual([]);
  }
});

test("a fixed source reader can become an anchor without changing other readers or work", () => {
  const s: Scenario = { ...chain(), version: 2, sources: [-1, -2], anchors: [-2] };
  s.readers[0].refs = [-1];
  s.readers.push({ id: 1, refs: [1], gated: false, boundary: "none" });
  const before = structuredClone(s),
    [c] = [...observationReductions(s)];
  expect(c.anchors).toEqual([-2, -1]);
  expect(c.readers).toEqual([s.readers[1]]);
  expect(c.nodes).toBe(s.nodes);
  expect(c.turns).toBe(s.turns);
  expect(validate(c)).toBeUndefined();
  expect(s).toEqual(before);
  s.anchors = [-1, -2];
  expect([...observationReductions(s)]).toEqual([]);
  delete s.anchors;
  expect([...observationReductions(s)]).toEqual([]);
});

test("anchor substitution retains source readers addressed by queued disposal", () => {
  const s: Scenario = { ...chain(), version: 2, sources: [-1], anchors: [] };
  s.readers[0].refs = [-1];
  s.turns = [
    { steps: [{ op: "queue", id: 0, via: "microtask", steps: [{ op: "dispose", reader: 0 }] }] }
  ];
  expect([...observationReductions(s)]).toEqual([]);
  s.turns = [];
  for (const change of [{ gated: true }, { boundary: "retain" as const }, { pending: true }]) {
    const c: Scenario = { ...s, readers: [{ ...s.readers[0], ...change }] };
    expect([...observationReductions(c)]).toEqual([]);
  }
});
