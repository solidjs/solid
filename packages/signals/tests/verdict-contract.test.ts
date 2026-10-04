// Verdicts (maintainer, 2026-10-01): `isPending` and `latest` are optimistic
// state the system supplies. A verdict is a guess — "pending, until this
// lands"; "the proposal is the value" — decided at the seam like a user's,
// and its readers break out of the hold the same way: work of a lane under
// the holder (the holder's verdict lane), shown now, re-derived at the
// landing, ending with it. A verdict reader is a frame reader: its plain
// reads of held nodes see the screen (committed), so `[isPending(x), x()]`
// never pairs the fresh value with pending (A10) — the reader never sees the
// fresh value. Inside `latest`, `isPending` asks whether the latest view is
// final. A verdict reader's own async holds the transaction's verdict frame
// (lane rule 3, "consistent with any optimistic update"). The
// retained pins (`latest-*`, `ispending-*`, `write-proposals-3494`,
// `latest-isPending-consistency`, the visibility oracle) cover the verdict
// definitions; these cover what is specific to the lane model.

import { afterEach, describe, expect, it } from "vitest";
import {
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

afterEach(() => flush());

async function settled() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

describe("verdict readers break out as the holder's verdict lane", () => {
  it("a spinner shows while the write is held, and leaves in the frame that lands it", async () => {
    const [q, setQ] = createSignal("a");
    let resolve!: (v: string) => void;
    const log: string[] = [];
    const dispose = createRoot(d => {
      const results = createMemo(() => {
        const v = q();
        return new Promise<string>(r => (resolve = r)).then(() => v);
      });
      createRenderEffect(results, v => void log.push(`results:${v}`));
      createRenderEffect(
        () => (isPending(q) ? "spinner" : "idle"),
        v => void log.push(v)
      );
      return d;
    });
    flush();
    resolve("x");
    await settled();
    expect(log).toEqual(["idle", "results:a"]);

    setQ("b"); // held: results re-asks
    flush();
    expect(q()).toBe("a");
    expect(log.slice(2)).toEqual(["spinner"]);

    resolve("y");
    await settled();
    // One frame: the hold lands and the verdict flips with it.
    expect(log.slice(3).sort()).toEqual(["idle", "results:b"]);
    expect(q()).toBe("b");
    dispose();
  });

  it("latest() of the held write shows the proposal now; a plain read beside it is the screen (A10)", async () => {
    const [q, setQ] = createSignal("a");
    let resolve!: (v: string) => void;
    const log: string[] = [];
    const dispose = createRoot(d => {
      const results = createMemo(() => {
        const v = q();
        return new Promise<string>(r => (resolve = r)).then(() => v);
      });
      createRenderEffect(results, () => {});
      createRenderEffect(
        () => `latest=${latest(q)} plain=${q()} pending=${isPending(q)}`,
        v => void log.push(v)
      );
      return d;
    });
    flush();
    resolve("x");
    await settled();
    expect(log).toEqual(["latest=a plain=a pending=false"]);

    setQ("b");
    flush();
    // The input box shows the typed value; whatever reads q plainly in the
    // same hole still shows the screen, and is told it is not final.
    expect(log.at(-1)).toBe("latest=b plain=a pending=true");

    resolve("y");
    await settled();
    expect(log.at(-1)).toBe("latest=b plain=b pending=false");
    dispose();
  });

  it("a verdict reader whose own pass goes async holds the transaction's verdict frame, not the parent (lane rule 3)", async () => {
    // "Consistent with any optimistic update": the transaction's verdict
    // readers are one optimistic frame, as a guess and its derivations are
    // (lane contract 3) — one of them in flight holds the frame's reveal,
    // and the parent's own flight is not waited on.
    const [q, setQ] = createSignal("a");
    let resolveResults!: (v: string) => void;
    let resolveSuggest!: (v: string) => void;
    const log: string[] = [];
    const dispose = createRoot(d => {
      const results = createMemo(() => {
        const v = q();
        return new Promise<string>(r => (resolveResults = r)).then(() => `results:${v}`);
      });
      // fetch(latest(q)): downstream async of a verdict reader.
      const suggest = createMemo(() => {
        const text = latest(q);
        return new Promise<string>(r => (resolveSuggest = r)).then(() => `suggest:${text}`);
      });
      createRenderEffect(results, v => void log.push(v));
      createRenderEffect(suggest, v => void log.push(v));
      createRenderEffect(
        () => `input:${latest(q)}`,
        v => void log.push(v)
      );
      return d;
    });
    flush();
    resolveResults("x");
    resolveSuggest("x");
    await settled();
    expect(log.sort()).toEqual(["input:a", "results:a", "suggest:a"]);
    log.length = 0;

    setQ("b");
    flush();
    // The verdict frame is held on `suggest`'s flight: nothing of it shows
    // yet — the input included.
    expect(log).toEqual([]);

    resolveSuggest("y");
    await settled();
    // The frame reveals on its own flight, not the parent's.
    expect(log.sort()).toEqual(["input:b", "suggest:b"]);

    resolveResults("y");
    await settled();
    expect(log.sort()).toEqual(["input:b", "results:b", "suggest:b"]);
    dispose();
  });
});

describe("a verdict reader is a frame reader for as long as it probes", () => {
  it("a memo reading a flight plainly beside its probe is handed the committed value, in either order; one that stops probing suspends again after one pass", async () => {
    const [q, setQ] = createSignal(1);
    const [mode, setMode] = createSignal<"probe" | "plain">("probe");
    let resolve!: (v: number) => void;
    const log: string[] = [];
    const dispose = createRoot(d => {
      const data = createMemo(() => {
        const v = q();
        return new Promise<number>(r => (resolve = r)).then(() => v * 10);
      });
      // Plain read first, probe second: the order the compiled two-effect
      // form never has, and the one a throw would have made order-dependent.
      const view = createMemo(() =>
        mode() === "probe" ? `${data()}:${isPending(data)}` : `${data()}:plain`
      );
      createRenderEffect(view, v => void log.push(v));
      return d;
    });
    flush();
    resolve(0);
    await settled();
    expect(log.at(-1)).toBe("10:false");
    log.length = 0;

    setQ(2); // data in flight
    flush();
    // The memo is a frame reader: the screen's value, and the verdict — now.
    expect(log).toEqual(["10:true"]);
    resolve(0);
    await settled();
    expect(log.at(-1)).toBe("20:false");
    expect(log).not.toContain("20:true");

    // The memo stops probing: this pass still carries the posture (one pass
    // of memory), the next does not.
    setMode("plain");
    flush();
    expect(log.at(-1)).toBe("20:plain");
    setQ(3); // data in flight again
    flush();
    // An ordinary derivation now: it suspends on the flight, nothing shows.
    expect(log.at(-1)).toBe("20:plain");
    resolve(0);
    await settled();
    expect(log.at(-1)).toBe("30:plain");
    dispose();
  });
});

describe("verdicts of a guess", () => {
  it("latest() of a blocked lane's guess shows it; isPending reads it not final; the reader breaks out of the lane", async () => {
    const [src, setSrc] = createSignal(0);
    let resolveTruth!: (v: number) => void;
    let resolveDetail!: (v: number) => void;
    const log: string[] = [];
    let setOpt!: (v: number) => void;
    const dispose = createRoot(d => {
      const truth = createMemo(() => (src() ? new Promise<number>(r => (resolveTruth = r)) : 0));
      const [opt, s] = createOptimistic(() => truth());
      setOpt = s;
      // The lane blocks on this.
      const detail = createMemo(() => (opt() ? new Promise<number>(r => (resolveDetail = r)) : 0));
      createRenderEffect(detail, v => void log.push(`detail:${v}`));
      createRenderEffect(opt, v => void log.push(`opt:${v}`));
      createRenderEffect(
        () => `probe:${latest(opt)}/${isPending(opt)}`,
        v => void log.push(v)
      );
      return d;
    });
    flush();
    expect(log.sort()).toEqual(["detail:0", "opt:0", "probe:0/false"]);
    log.length = 0;

    setSrc(1);
    setOpt(5);
    flush();
    // The lane is blocked on `detail`: the guess does not show (`opt:` keeps
    // 0), but `latest` shows it and the slot is not final. (The first frame
    // is the probe re-derived for `truth`'s flight before the seam applies
    // the guess — A28, the write is visible from the flush's verdict on.)
    expect(log).toEqual(["probe:0/true", "probe:5/true"]);

    resolveDetail(50);
    await settled();
    // The lane reveals.
    expect(log.slice(2).sort()).toEqual(["detail:50", "opt:5"]);

    resolveTruth(5); // confirm
    await settled();
    expect(log.at(-1)).toBe("probe:5/false");
    dispose();
  });
});
