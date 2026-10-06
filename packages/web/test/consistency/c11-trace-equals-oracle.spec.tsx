/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C11 — a trace materializes to one value, equal to its oracle.
 *
 * "A materialized container trace reads, at every observable point, as the
 * direct materialization of the same snapshot and patch prefix would —
 * not-ready before the snapshot, then the snapshot with every patch applied
 * so far — and its value is independent of how the data was split and
 * timed; one trace materializes to one store however many readers revive
 * it."
 *
 * Mechanism meant to carry it: solid/src/client/hydration.ts
 * `materializeContainerTrace` (the raw-stream branch: `.on()` replays the
 * buffer synchronously into a queue the projection's compute drains, one
 * version bump per live emission, `applyPatches` per batch) and
 * frames/src/frame-container-plugin.ts `materialize` (one store per `$tr`,
 * a WeakMap memo) / `reviveContainerTraces` / `isMaterializedContainer`.
 *
 * The oracle is `applyPatches` reproduced here over a plain value: the wire
 * shape is a tuple per patch — `[path, value]` sets, `[path]` deletes
 * (`splice(i, 1)` on arrays), `[path, value, 1]` inserts (`splice(i, 0, v)`).
 * The materializer under test is whichever the branch ships: resident at
 * module load on `next`, loaded lazily behind `host.prepareArgs` on
 * `size/s1-lazy-store-materializer` — `readyMaterializer` covers both.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createRoot, flush, NotReadyError } from "solid-js";
import { hydrate } from "@solidjs/web";
import { getFrameHost, installServerComponents } from "../../frames/src/client.js";
import {
  isMaterializedContainer,
  reviveContainerTraces
} from "../../frames/src/frame-container-plugin.js";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  quiesce,
  slotRange,
  traceMarker,
  watchFrames,
  type Page
} from "./support.js";

type Patch = [path: (string | number)[], value?: unknown, insert?: 1];

/** `applyPatches` (solid/src/client/hydration.ts) over a plain value. */
function oracleApply(target: any, patches: Patch[]) {
  for (const patch of patches) {
    const path = patch[0];
    let current = target;
    for (let i = 0; i < path.length - 1; i++) current = current[path[i]];
    const key = path[path.length - 1];
    if (patch.length === 1) {
      Array.isArray(current) ? current.splice(key as number, 1) : delete current[key];
    } else if (patch.length === 3) {
      (current as any[]).splice(key as number, 0, patch[1]);
    } else {
      current[key] = patch[1];
    }
  }
  return target;
}
const clone = (v: unknown) => JSON.parse(JSON.stringify(v));
/** The oracle's value after `prefix` batches of `batches` over `snapshot`. */
function oracle(snapshot: unknown, batches: Patch[][], prefix = batches.length) {
  const value = clone(snapshot);
  for (let i = 0; i < prefix; i++) oracleApply(value, batches[i]);
  return value;
}

/** What a reader sees: the value, or NOT_READY while the snapshot is absent. */
const NOT_READY = Symbol("not-ready");
function read(store: any): unknown {
  flush();
  try {
    return clone(store);
  } catch (e) {
    if (e instanceof NotReadyError) return NOT_READY;
    throw e;
  }
}

/** The branch's materializer, resident. */
async function readyMaterializer() {
  installServerComponents();
  const host: any = getFrameHost();
  await host.prepareArgs?.({ probe: traceMarker().marker });
}

/** A small deterministic PRNG (mulberry32) for the partition arm. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Split `items` into random non-empty consecutive groups. */
function partition<T>(items: T[], rand: () => number): T[][] {
  const out: T[][] = [];
  let i = 0;
  while (i < items.length) {
    const size = 1 + Math.floor(rand() * (items.length - i));
    out.push(items.slice(i, i + size));
    i += size;
  }
  return out;
}

const SNAPSHOT = { n: 1, user: { name: "a", tags: ["x"] }, list: [1, 2, 3] };
const PATCHES: Patch[] = [
  [["n"], 2],
  [["user", "name"], "b"],
  [["user", "tags", 1], "y", 1],
  [["list", 0]],
  [["list", 1], 9, 1],
  [["user", "age"], 30],
  [["user", "tags", 0]],
  [["n"], 3],
  [["list", 2], 7]
];

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

describe("C11 — a trace materializes to one value, equal to its oracle", () => {
  test("(a) snapshot before revival, patches after: equals the oracle after each patch", async () => {
    await readyMaterializer();
    const trace = traceMarker();
    trace.snapshot(SNAPSHOT);
    const store = reviveContainerTraces(trace.marker) as any;
    expect(isMaterializedContainer(store)).toBe(true);
    expect(read(store)).toEqual(oracle(SNAPSHOT, [], 0));
    const batches = PATCHES.map(p => [p]);
    for (let i = 0; i < batches.length; i++) {
      trace.patch(batches[i]);
      expect(read(store), `after patch ${i}`).toEqual(oracle(SNAPSHOT, batches, i + 1));
    }
  });

  test("(b) revival before the snapshot: not-ready, then the snapshot equals the oracle", async () => {
    await readyMaterializer();
    const trace = traceMarker();
    const store = reviveContainerTraces(trace.marker) as any;
    expect(read(store)).toBe(NOT_READY);
    // Still not ready after a beat with nothing delivered.
    await quiesce(1);
    expect(read(store)).toBe(NOT_READY);
    trace.snapshot(SNAPSHOT);
    expect(read(store)).toEqual(oracle(SNAPSHOT, [], 0));
    trace.patch([PATCHES[0], PATCHES[1]]);
    expect(read(store)).toEqual(oracle(SNAPSHOT, [[PATCHES[0], PATCHES[1]]]));
  });

  test("(c) random splits: 1 batch vs N batches vs random partitions give equal prefixes and final value", async () => {
    await readyMaterializer();
    const expected = oracle(SNAPSHOT, [PATCHES]);
    // One batch.
    {
      const trace = traceMarker();
      trace.snapshot(SNAPSHOT);
      const store = reviveContainerTraces(trace.marker) as any;
      trace.patch(PATCHES);
      expect(read(store)).toEqual(expected);
    }
    // One patch per batch, with the snapshot delivered AFTER revival and a
    // beat between batches (live emissions, each a version bump).
    {
      const trace = traceMarker();
      const store = reviveContainerTraces(trace.marker) as any;
      trace.snapshot(SNAPSHOT);
      for (let i = 0; i < PATCHES.length; i++) {
        trace.patch([PATCHES[i]]);
        await quiesce(1);
        expect(read(store), `N batches, prefix ${i + 1}`).toEqual(
          oracle(
            SNAPSHOT,
            PATCHES.map(p => [p]),
            i + 1
          )
        );
      }
    }
    // Random partitions, random interleaving of revival vs snapshot.
    const rand = prng(3289);
    for (let round = 0; round < 24; round++) {
      const batches = partition(PATCHES, rand);
      const reviveFirst = rand() < 0.5;
      const trace = traceMarker();
      let store: any;
      if (reviveFirst) store = reviveContainerTraces(trace.marker);
      trace.snapshot(SNAPSHOT);
      if (!reviveFirst) store = reviveContainerTraces(trace.marker);
      for (let i = 0; i < batches.length; i++) {
        trace.patch(batches[i]);
        if (rand() < 0.5) await quiesce(1);
        expect(read(store), `round ${round} prefix ${i + 1}`).toEqual(
          oracle(SNAPSHOT, batches, i + 1)
        );
      }
      expect(read(store), `round ${round} final`).toEqual(expected);
    }
  });

  test("(d) two revivals of one marker through reviveContainerTraces are the same object", async () => {
    await readyMaterializer();
    const trace = traceMarker();
    trace.snapshot(SNAPSHOT);
    // Two records carrying the same marker (the document face: one trace,
    // two occurrences' args) revive to ONE store.
    const first = reviveContainerTraces({ data: trace.marker }) as any;
    const second = reviveContainerTraces({ nested: { data: trace.marker } }) as any;
    expect(first.data).toBe(second.nested.data);
    expect(isMaterializedContainer(first.data)).toBe(true);
    trace.patch([PATCHES[0]]);
    expect(read(first.data)).toEqual(read(second.nested.data));
    expect(read(first.data)).toEqual(oracle(SNAPSHOT, [[PATCHES[0]]]));
  });

  test("(d) page face: a fill reading a trace arg shows the oracle at every observed frame", async () => {
    const fid = freshFid("c11d");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "1:a:1,2,3"))}</ul>`)
    );
    const trace = traceMarker();
    trace.snapshot(SNAPSHOT);
    page.slotRecord(fid, "item#0", { data: trace.marker });
    const Comp = (globalThis as any)._$SC.r(fid);
    const render = (d: any) => `${d.n}:${d.user.name}:${d.list.join(",")}`;
    const dispose = hydrate(
      () => <Comp item={(p: { data: any }) => <li>{render(p.data)}</li>} />,
      page.container
    );
    await quiesce();
    await quiesce();
    const frames = watchFrames(page.container);
    expect(page.container.textContent).toBe(render(SNAPSHOT));
    const batches = PATCHES.map(p => [p]);
    const expectedFrames = [render(SNAPSHOT)];
    for (let i = 0; i < batches.length; i++) {
      trace.patch(batches[i]);
      await quiesce(1);
      const want = render(oracle(SNAPSHOT, batches, i + 1));
      expect(page.container.textContent, `frame ${i + 1}`).toBe(want);
      if (expectedFrames[expectedFrames.length - 1] !== want) expectedFrames.push(want);
    }
    frames.sample();
    frames.stop();
    // Every frame the observer recorded is an oracle prefix, in order.
    expect(frames.frames).toEqual(expectedFrames);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  test("(e) array-rooted trace: del/insert/set/length patches equal the oracle", async () => {
    await readyMaterializer();
    const snapshot = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const batches: Patch[][] = [
      [[[1]]],
      [[[1], { id: 9 }, 1]],
      [[[0, "id"], 10]],
      [[["length"], 2]],
      [[[2], { id: 4 }, 1], [[0]]]
    ];
    const trace = traceMarker(true);
    const store = reviveContainerTraces(trace.marker) as any;
    expect(read(store)).toBe(NOT_READY);
    trace.snapshot(snapshot);
    expect(Array.isArray(store)).toBe(true);
    expect(read(store)).toEqual(snapshot);
    for (let i = 0; i < batches.length; i++) {
      trace.patch(batches[i]);
      expect(read(store), `prefix ${i + 1}`).toEqual(oracle(snapshot, batches, i + 1));
    }
  });

  test("(control) the trace's end latches the last state", async () => {
    await readyMaterializer();
    const trace = traceMarker();
    trace.snapshot(SNAPSHOT);
    const store = reviveContainerTraces(trace.marker) as any;
    trace.patch([PATCHES[0]]);
    const latched = oracle(SNAPSHOT, [[PATCHES[0]]]);
    expect(read(store)).toEqual(latched);
    trace.end();
    await quiesce(1);
    expect(read(store)).toEqual(latched);
    // Nothing after the end reaches the store (the stream is closed).
    trace.patch([PATCHES[1]]);
    await quiesce(1);
    expect(read(store)).toEqual(latched);
  });
});
