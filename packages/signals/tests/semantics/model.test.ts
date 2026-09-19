import { Model, sameNumbers } from "./model.js";
import { ancestors, capture, evaluate } from "./scenario.js";
import { generate } from "./generate.js";

test("dense model agrees with the pure specification on branching graphs and sparse IDs", () => {
  for (const s of generate(3350, 60, "branches")) {
    const rename = (id: number) => (id < 0 ? id : id * 5 + 7);
    for (const node of s.nodes) {
      node.id = rename(node.id);
      node.deps = node.deps.map(rename);
      if (node.branch) {
        node.branch.condition = rename(node.branch.condition);
        node.branch.otherwise = node.branch.otherwise.map(rename);
      }
    }
    for (const reader of s.readers) reader.refs = reader.refs.map(rename);
    const model = new Model(s);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const inputs = { [-1]: a, [-2]: b };
        const expected = evaluate(s, a, inputs);
        const values = model.evaluate(a, inputs);
        for (const [id, value] of expected) expect(values.get(id)).toBe(value);
        for (let i = 0; i < s.nodes.length; i++)
          expect(values.inputs(i)).toEqual(capture(s.nodes[i], id => expected.get(id)!));
        for (const reader of s.readers) {
          const needed = model.select(reader.refs, values);
          const expected = ancestors(s, reader.refs, evaluate(s, a, inputs));
          for (const [id, slot] of model.slots) expect(!!needed[slot]).toBe(expected.has(id));
        }
      }
  }
});

test("later evaluations and selections preserve earlier values and paths", () => {
  const s = generate(33, 1)[0];
  const model = new Model(s);
  const first = model.evaluate(0);
  const inputs = first.inputs(0);
  const path = model.select(s.readers[0].refs, first);
  const savedPath = path.slice();
  const next = model.evaluate(1);
  model.select([], next);
  expect(first.get(-1)).toBe(0);
  expect(next.get(-1)).toBe(1);
  expect(first.inputs(0)).toEqual(inputs);
  expect(path).toEqual(savedPath);
  expect(sameNumbers(inputs, first.inputs(0))).toBe(true);
  expect(sameNumbers([1], [1, 2])).toBe(false);
  expect(sameNumbers([1], [2])).toBe(false);
});

test("latest read scope follows dependency masks without excluding independent ordinary nodes", () => {
  const model = new Model({
    version: 2,
    sources: [-1, -2],
    show: true,
    optimistic: { kind: "latest", proposals: [1], authoritative: 1 },
    nodes: [
      { id: 7, deps: [-2], factor: 1, offset: 0, delivery: "sync" },
      { id: 12, deps: [7], factor: 1, offset: 0, delivery: "manual" },
      { id: 20, deps: [-1], factor: 1, offset: 0, delivery: "sync" }
    ],
    readers: [],
    turns: []
  });
  for (const ref of [-2, 7, 12]) expect(model.readsLatest(ref)).toBe(true);
  for (const ref of [-1, 20]) expect(model.readsLatest(ref)).toBe(false);
  expect(new Model(generate(33, 1)[0]).readsLatest(-1)).toBe(false);
});
