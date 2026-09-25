/**
 * The lean gate: an enabled engine builds a `RerunEvent` only when something
 * wants it — a `rerun` listener on the records channel, a registered fold, or
 * the console log. Otherwise every run still leaves its facts on the node and
 * feeds the checks, but no record is allocated, kept or delivered.
 *
 * This file imports the engine's core module, not the `attribution` entry:
 * the entry re-exports `costs`/`feedback`, whose modules register a fold on
 * evaluation and would turn the gate on for the whole file. The fold leg of
 * the gate is therefore exercised last — a fold cannot be unregistered.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, nodeIdOf, registerFold } from "../src/core/attribution.js";
import type { RerunEvent } from "../src/core/attribution.js";
import { createEffect, createRoot, createSignal, flush, getOwner, OBSERVE } from "../src/index.js";
import type { RecordListener } from "../src/core/dev.js";

// Channel subscriptions are the consumer's, not the engine's: released here,
// or one test's listener would turn the gate on for the next.
const offs: (() => void)[] = [];
function onRerun(listener: RecordListener<"rerun">): () => void {
  const off = OBSERVE!.records.subscribe("rerun", listener);
  offs.push(off);
  return off;
}

afterEach(() => {
  for (const off of offs.splice(0)) off();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

/** One signal → effect chain; returns the setter and the effect node. */
function chain() {
  const [n, setN] = createSignal(0, { name: "n" });
  let node!: object;
  createRoot(() => {
    createEffect(
      () => {
        node = getOwner()!;
        return n();
      },
      () => {},
      { name: "e" }
    );
  });
  flush();
  return { setN, node };
}

describe("attribution engine: lean gate", () => {
  it("enabled with nobody wanting records, a run builds no RerunEvent", () => {
    const { setN, node } = chain();
    attribution.enable({ log: false });
    setN(1);
    flush();
    setN(2);
    flush();
    // Nothing kept, nothing identified: the record path was never entered.
    expect(attribution.history("rerun")).toEqual([]);
    expect(nodeIdOf(node)).toBeUndefined();
    expect(OBSERVE!.records.observed("rerun")).toBe(false);
  });

  it("a rerun listener turns the record on — and off again when it leaves", () => {
    const { setN, node } = chain();
    attribution.enable({ log: false });
    setN(1);
    flush();
    expect(attribution.history("rerun")).toEqual([]);

    const seen: RerunEvent[] = [];
    const lives: unknown[] = [];
    const off = onRerun((e, live) => {
      seen.push(e);
      lives.push(live);
    });
    setN(2);
    flush();
    expect(seen).toHaveLength(1);
    // The run count was kept while nobody listened: this is the node's second
    // run under the engine, the first having left no record.
    expect(seen[0]).toMatchObject({ nodeName: "e", nodeRuns: 2 });
    expect(lives).toEqual([node]);
    expect(attribution.history("rerun")).toEqual(seen);
    expect(nodeIdOf(node)).toBe(seen[0].nodeId);

    off();
    setN(3);
    flush();
    expect(seen).toHaveLength(1);
    expect(attribution.history("rerun")).toEqual(seen);
  });

  it("the gate is read at run start: a listener arriving mid-run gets the next record", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    const seen: RerunEvent[] = [];
    let armed = false;
    createRoot(() => {
      createEffect(
        () => {
          const v = n();
          if (armed && v === 1) onRerun(e => seen.push(e));
          return v;
        },
        () => {},
        { name: "e" }
      );
    });
    flush();
    attribution.enable({ log: false });
    armed = true;
    setN(1);
    flush();
    // Subscribed inside the run that nobody wanted at its start: no record.
    expect(seen).toEqual([]);
    setN(2);
    flush();
    expect(seen.map(e => e.nodeName)).toEqual(["e"]);
  });

  it("the console log wants the record", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { setN } = chain();
    attribution.enable({ log: true });
    setN(1);
    flush();
    expect(attribution.history("rerun")).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });

  it("the checks run without a record: a hot scope still warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { setN } = chain();
    attribution.enable({ log: false, hotRuns: { count: 3, windowMs: 10_000 } });
    for (let i = 1; i <= 4; i++) {
      setN(i);
      flush();
    }
    expect(attribution.history("rerun")).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("HOT_SCOPE");
  });

  // Last: registering a fold is for the rest of the process.
  it("a registered fold wants the record", () => {
    const folded: RerunEvent[] = [];
    registerFold({ rerun: (_el, e) => folded.push(e) });
    const { setN } = chain();
    attribution.enable({ log: false });
    setN(1);
    flush();
    expect(folded).toHaveLength(1);
    expect(attribution.history("rerun")).toEqual(folded);
  });
});
