import { afterEach, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  onSettled
} from "../src/index.js";

afterEach(() => flush());

async function settle() {
  for (let i = 0; i < 6; i++) {
    flush();
    await Promise.resolve();
  }
  flush();
}

// #4606: the run's own read pulls the memo, whose walk the recomputing run
// refuses; the tracked effect re-runs once the memo's value commits (F-1).
it("re-runs for a same-pass write it reads through a memo (#4606)", async () => {
  const log: number[] = [];
  createRoot(() => {
    const [s, setS] = createSignal(0);
    const m = createMemo(() => s() * 10);
    createEffect(
      () => 1,
      () => {
        setS(1);
      }
    );
    createTrackedEffect(() => {
      log.push(m());
    });
  });
  await settle();
  expect(log).toEqual([0, 10]);
});

it("re-runs for an onSettled write it reads through a memo (#4606)", async () => {
  const log: number[] = [];
  createRoot(() => {
    const [s, setS] = createSignal(100);
    const m = createMemo(() => s() + 1);
    onSettled(() => {
      setS(101);
    });
    createTrackedEffect(() => {
      log.push(m());
    });
  });
  await settle();
  expect(log).toEqual([101, 102]);
});

it("does not re-run for a memo whose same-pass writes net to the committed value", async () => {
  const log: number[] = [];
  createRoot(() => {
    const [s, setS] = createSignal(0);
    const m = createMemo(() => s() * 10);
    createEffect(
      () => 1,
      () => {
        setS(1);
        setS(0);
      }
    );
    createTrackedEffect(() => {
      log.push(m());
    });
  });
  await settle();
  expect(log).toEqual([0]);
});

// #4607: a run during an action's hold, for another dependency, is served
// the committed value of the held one (D-29) and consumes the run the
// landing replays; it re-runs at the landing as A15's stale reader.
for (const mode of ["tracked", "effect"] as const)
  for (const touchU of [false, true])
    it(`${mode}: last run sees an action's landing (mid-hold run: ${touchU}) (#4607)`, async () => {
      const log: string[] = [];
      let release!: (v?: unknown) => void;
      let s!: () => number, setS!: (v: number) => void, setU!: (v: number) => void;
      createRoot(() => {
        let u: () => number;
        [s, setS] = createSignal(0);
        [u, setU] = createSignal(0);
        if (mode === "tracked")
          createTrackedEffect(() => {
            log.push(`s${s()}u${u()}`);
          });
        else
          createEffect(
            () => `s${s()}u${u()}`,
            v => {
              log.push(v);
            }
          );
      });
      await settle();
      const p = new Promise(r => (release = r));
      const done = action(function* () {
        setS(1);
        yield p;
      })();
      await settle();
      if (touchU) {
        setU(1);
        await settle();
        // D-29: the held write is never visible to it.
        expect(log[log.length - 1]).toBe(mode === "tracked" ? "s0u1" : "s0u0");
      }
      release();
      await done;
      await settle();
      expect(s()).toBe(1);
      expect(log).toEqual(
        touchU
          ? mode === "tracked"
            ? ["s0u0", "s0u1", "s1u1"]
            : ["s0u0", "s1u1"]
          : ["s0u0", "s1u0"]
      );
    });

// D-29: re-run at the landing, but it holds nothing — a flight it reads,
// once no render effect reads it, does not keep the hold open.
it("a tracked effect that read a held value does not hold a flight (#4607)", async () => {
  const shown: string[] = [];
  const seen: number[] = [];
  let s!: () => number, setS!: (v: number) => void;
  let setU!: (v: number) => void, setShow!: (v: boolean) => void;
  createRoot(() => {
    let u: () => number, show: () => boolean;
    [s, setS] = createSignal(0);
    [u, setU] = createSignal(0);
    [show, setShow] = createSignal(true);
    const F = createMemo(async () => (s() === 0 ? 0 : new Promise<number>(() => {})));
    createRenderEffect(
      () => (show() ? `s${s()} F${F()}` : `s${s()} hidden`),
      v => {
        shown.push(v);
      }
    );
    createTrackedEffect(() => {
      u();
      seen.push(s());
      F();
    });
  });
  await settle();
  setS(1);
  await settle();
  setU(1);
  await settle();
  expect(seen).toEqual([0, 0]);
  setShow(false);
  await settle();
  expect(shown).toEqual(["s0 F0", "s1 hidden"]);
  expect(seen).toEqual([0, 0, 1]);
});
