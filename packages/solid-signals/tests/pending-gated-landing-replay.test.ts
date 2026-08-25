/**
 * #3041 follow-up: a render effect gated on isPending reads its async source
 * for the first time during the landing flush, under the isPending companion's
 * lane — laneReadsCommitted serves the committed value, and the staged value
 * then promotes silently (commitPendingNode never re-notifies), leaving the
 * effect one value behind until the next write. laneReadsCommitted now records
 * such readers into the transaction's _gatedSubs so the commit replays them.
 */
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

it("gated render effect is not one value behind after landing", async () => {
  const resolvers: { name: string; r: (v: string) => void }[] = [];
  const seen: string[] = [];
  let setQuery!: (v: string) => void;
  createRoot(() => {
    const [query, s] = createSignal("v0");
    setQuery = s;
    const pokemon = createMemo(
      () =>
        new Promise<string>(r => {
          resolvers.push({ name: query(), r });
        })
    );
    const pending = createMemo(() => isPending(() => pokemon()));
    createRenderEffect(
      () => (pending() ? "pending" : "idle:" + pokemon()),
      v => {
        seen.push(String(v));
        console.log("  [effect VALUE]", v);
      }
    );
  });
  flush();
  {
    const { name, r } = resolvers.shift()!;
    r(name);
    await tick();
    flush();
  }
  console.log("--- setQuery(v1) ---");
  setQuery("v1");
  flush();
  console.log("--- resolve v1 ---");
  {
    const { name, r } = resolvers.shift()!;
    r(name);
    await tick();
    flush();
  }
  console.log("--- extra ---");
  flush();
  await tick();
  flush();
  expect(seen).toEqual(["idle:v0", "pending", "idle:v0", "idle:v1"]);
});
