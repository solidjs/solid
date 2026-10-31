/**
 * #4504: a memo between a render effect and an async memo in flight, read for
 * the first time by a mount made mid-flight.
 *
 * `m0` is the async memo's input; `m1 = createMemo(async () => m0())` takes
 * 100 ms. A plain write re-asks `m1` while nothing reads it, and 20 ms into
 * the flight a render effect mounts and reads `mb`, a memo over `m1`
 * (`() => m1()`, `() => m1() * 10`) that nothing has read before.
 *
 * With `m0 = createMemo(() => latest(s) + s())` (a verdict reader: it called
 * `latest`) `m1` and `mb` carried that posture by what they read (D-25: a
 * memo's posture is what it reads). The mount's pass of `mb` read `m1`
 * plainly — `mb` was pending, so the pass is not a verdict reader (D-25,
 * #3884) — and threw, so the reader held the mount (D-2, F-2). But the read
 * of the pending `m1` still stamped the posture on `mb` for its next pass,
 * so at the landing `mb` re-ran as a verdict reader and was served `m1`'s
 * committed value (the screen): `r:2` published at the landing, then `r:4`
 * at the commit — a held reader shown a value older than the one it waited
 * for (F-2, F-1).
 *
 * Ruled: a plain read in a mount is not display-ahead (D-27); the reader of
 * a derivation with no value to show for the re-ask is born held (D-2) and
 * shows the re-ask's answer (D-22, F-9) — the screen of the direct read
 * (`r:4`) and of a plain input. A pending read yields no value, so it hands
 * on no posture (D-25: a node whose flight is up is the hold's work, not a
 * verdict reader). A memo that is a verdict reader already keeps its
 * posture when it is served the screen of a flight: a prior on-screen
 * reader of `mb` sees what it saw before this fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  resetErrorHalt
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetErrorHalt();
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const tick = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  flush();
};

type Input = "verdict" | "plain";
type Between = "identity" | "times10" | "chain";
type Made = "before" | "mid-flight";
type Prior = "none" | "render effect" | "user effect";

const between: Record<Between, (m1: () => number) => () => number> = {
  identity: m1 => createMemo(() => m1()),
  times10: m1 => createMemo(() => m1() * 10),
  chain: m1 => {
    const inner = createMemo(() => m1() * 10);
    return createMemo(() => inner() + 1);
  }
};

async function run(input: Input, shape: Between, made: Made, prior: Prior) {
  const log: string[] = [];
  const [s, setS] = createSignal(1);
  const [on, setOn] = createSignal(prior === "render effect");
  let m1!: () => number;
  let mb!: () => number;
  createRoot(() => {
    const m0 = createMemo(() => (input === "plain" ? s() * 2 : latest(s) + s()));
    m1 = createMemo(async () => {
      const v = m0();
      await sleep(100);
      return v;
    });
    if (made === "before") mb = between[shape](m1);
  });
  if (prior === "user effect")
    createRoot(() =>
      createEffect(
        () => mb(),
        () => {}
      )
    );
  createRoot(() =>
    createRenderEffect(
      () => (on() ? `r:${mb()}` : "r:off"),
      v => void log.push(v)
    )
  );
  flush();
  await tick(150);
  setS(2);
  flush();
  await tick(20);
  if (made === "mid-flight") createRoot(() => (mb = between[shape](m1)));
  setOn(true);
  flush();
  log.push("--mounted");
  await tick(300);
  return log;
}

const screen = (shape: Between, v: number) =>
  `r:${shape === "identity" ? v : shape === "times10" ? v * 10 : v * 10 + 1}`;

describe("#4504: a memo over a re-asked async memo, first read by a mount mid-flight", () => {
  it("control: the mount reading the async memo directly is held and shows the re-ask's answer", async () => {
    const log: string[] = [];
    const [s, setS] = createSignal(1);
    const [on, setOn] = createSignal(false);
    createRoot(() => {
      const m0 = createMemo(() => latest(s) + s());
      const m1 = createMemo(async () => {
        const v = m0();
        await sleep(100);
        return v;
      });
      createRenderEffect(
        () => (on() ? `r:${m1()}` : "r:off"),
        v => void log.push(v)
      );
    });
    flush();
    await tick(150);
    setS(2);
    flush();
    await tick(20);
    setOn(true);
    flush();
    log.push("--mounted");
    await tick(300);
    expect(log).toEqual(["r:off", "--mounted", "r:4"]);
  });

  for (const input of ["verdict", "plain"] as const)
    for (const shape of ["identity", "times10", "chain"] as const)
      for (const made of ["before", "mid-flight"] as const)
        it(`${input} input, ${shape} memo made ${made === "before" ? "before the re-ask" : "mid-flight"}: the reader is born held and shows the re-ask's answer`, async () => {
          expect(await run(input, shape, made, "none")).toEqual([
            "r:off",
            "--mounted",
            screen(shape, 4)
          ]);
        });

  // #4474's equivalence: a reader that holds nothing does not change the
  // screen (laziness is never observable, D-22).
  for (const input of ["verdict", "plain"] as const)
    it(`${input} input, a prior user effect reading the memo: the same screen as with no reader`, async () => {
      expect(await run(input, "times10", "before", "user effect")).toEqual([
        "r:off",
        "--mounted",
        "r:40"
      ]);
    });

  // Unchanged by #4504: the memo already had a value and an on-screen reader
  // when the write re-asked the async memo. With the verdict input that
  // reader shows the screen of the flight (D-25: the memo is a verdict
  // reader by what it reads), the verdict lane's reveal of `latest(s) + s()`
  // over the held write (`3`, D-26), then the commit.
  it("verdict input, the memo already on screen before the re-ask: unchanged", async () => {
    expect(await run("verdict", "times10", "before", "render effect")).toEqual([
      "r:20",
      "--mounted",
      "r:30",
      "r:40"
    ]);
    expect(await run("verdict", "identity", "before", "render effect")).toEqual([
      "r:2",
      "--mounted",
      "r:3",
      "r:4"
    ]);
  });
  it("plain input, the memo already on screen before the re-ask: unchanged", async () => {
    expect(await run("plain", "times10", "before", "render effect")).toEqual([
      "r:20",
      "--mounted",
      "r:40"
    ]);
  });

  // D-22 / D-23: the memo has produced a value (the async memo's landed
  // answer, through it) and is pending on the re-ask, at any depth — read
  // unowned after the plain mount, and by a verdict leaf mounted mid-flight.
  for (const input of ["verdict", "plain"] as const)
    for (const mount of ["plain reader", "verdict leaf"] as const)
      it(`${input} input, ${mount} mounted mid-flight: latest/isPending of the memo`, async () => {
        const log: string[] = [];
        const [s, setS] = createSignal(1);
        const [on, setOn] = createSignal(false);
        let mb!: () => number;
        createRoot(() => {
          const m0 = createMemo(() => (input === "plain" ? s() * 2 : latest(s) + s()));
          const m1 = createMemo(async () => {
            const v = m0();
            await sleep(100);
            return v;
          });
          mb = createMemo(() => m1() * 10);
          createRenderEffect(
            () =>
              !on()
                ? "off"
                : mount === "plain reader"
                  ? `r:${mb()}`
                  : `l:${latest(mb)} p:${isPending(mb)}`,
            v => void log.push(v)
          );
        });
        flush();
        await tick(150);
        setS(2);
        flush();
        await tick(20);
        setOn(true);
        flush();
        log.push("--mounted");
        expect([latest(mb), isPending(mb)]).toEqual([20, true]);
        await tick(300);
        expect([latest(mb), isPending(mb)]).toEqual([40, false]);
        expect(log).toEqual(
          mount === "plain reader"
            ? ["off", "--mounted", "r:40"]
            : ["off", "l:20 p:true", "--mounted", "l:40 p:false"]
        );
      });
});
