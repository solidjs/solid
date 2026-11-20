// #5093: inside one action, a return-form write adopts a new array, the
// action yields, then a push writes the array again. The push is the
// holder's own write, so it joins the hold (D-8, A34): `mapArray` maps the
// pushed row, not `undefined`.
import { expect, test } from "vitest";
import {
  action,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  mapArray
} from "../src/index.js";

const cases: [string, any[], (l: any[]) => any, boolean, string[]][] = [
  [
    "filter, yield, push",
    [{ id: "A" }, { id: "B" }],
    l => l.filter(x => x.id !== "A"),
    true,
    ["A,B", "B,Z"]
  ],
  ["empty array, yield, push", [{ id: "A" }], () => [], true, ["A", "Z"]],
  [
    "filter, push (no yield)",
    [{ id: "A" }, { id: "B" }],
    l => l.filter(x => x.id !== "A"),
    false,
    ["A,B", "B,Z"]
  ],
  [
    "splice, yield, push",
    [{ id: "A" }, { id: "B" }],
    l => {
      l.splice(0, 1);
    },
    true,
    ["A,B", "B,Z"]
  ]
];

for (const [name, initial, first, yields, expected] of cases)
  test(`#5093 ${name}: mapArray maps the pushed row`, async () => {
    const [list, setList] = createStore(initial);
    const seen: string[] = [];
    const dispose = createRoot(dispose => {
      const rows = mapArray(
        () => list,
        (row: any) => () => (row === undefined ? "<undefined>" : row.id)
      );
      createRenderEffect(
        () => rows().map(r => r()),
        ids => {
          seen.push(ids.join(","));
        }
      );
      return dispose;
    });
    flush();
    const retry = action(function* () {
      setList(first);
      if (yields) yield new Promise(r => setTimeout(r, 10));
      setList((l: any[]) => {
        l.push({ id: "Z" });
      });
    });
    await retry();
    flush();
    expect(seen).toEqual(expected);
    expect(list.map((r: any) => r.id).join(",")).toBe(expected[1]);
    dispose();
  });
