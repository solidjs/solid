import { readFileSync } from "node:fs";
import { validate, type Scenario } from "./scenario.js";
import { complexity, compareComplexity } from "./complexity.js";
import { chain } from "./fixtures.js";

const manifest = JSON.parse(
  readFileSync(new URL("./quality/corpus.json", import.meta.url), "utf8")
) as {
  cases: {
    id: string;
    input: Scenario;
    reduced: Scenario;
    members: { batch: string; index: number }[];
  }[];
  routes: { source: string; target: string }[];
};

test("quality fixtures retain all audited inputs and original memberships", () => {
  const ids = new Set<string>(),
    memberships = new Set<string>();
  for (const c of manifest.cases) {
    expect(ids.has(c.id)).toBe(false);
    ids.add(c.id);
    expect(validate(c.input), c.id).toBeUndefined();
    expect(validate(c.reduced), c.id).toBeUndefined();
    for (const m of c.members) {
      const key = `${m.batch}:${m.index}`;
      expect(memberships.has(key), c.id).toBe(false);
      memberships.add(key);
    }
  }
  expect(ids.size).toBe(97);
  expect(memberships.size).toBe(1720);
  for (const r of manifest.routes) {
    expect(ids.has(r.source)).toBe(true);
    expect(ids.has(r.target)).toBe(true);
  }
});

test("complexity prefers removing async machinery even with another witnessed input", () => {
  const s = chain("manual");
  s.nodes[1].delivery = "manual";
  const c = structuredClone(s);
  c.nodes[1].delivery = "sync";
  c.readers[0].refs.push(0);
  expect(compareComplexity(c, s)).toBeLessThan(0);
  expect(complexity(s)).toEqual(complexity(structuredClone(s)));
});
