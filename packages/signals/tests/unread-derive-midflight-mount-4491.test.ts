/**
 * #4491: a reader that mounts while an unread derived store's derive has a
 * flight up reads the store like its memo (D-30, "in both forms").
 *
 * `createStore(d => { d.v = m1() }, {})` over `m1 = async(m0)` with
 * `m0 = memo(latest(s) + s)`: `m0` is a verdict reader, so `m1` and the
 * derive are verdict readers through what they read (D-25 / F-6). Nothing
 * reads the store when `m1` re-asks (s: 1 -> 2); a reader of the store then
 * mounts mid-flight.
 *
 * - memo form (the reader reads `m1()`): the mount consumes unanswered async
 *   and is held until `m1` answers (F-2): ["r:off", "--mounted", "r:4"].
 * - store form, before: the derive was served `m1`'s committed value and
 *   settled over it (A15's stale reader), so its leaf read as final. The
 *   reader showed the old question's answer `r:2` before `r:4`: in the
 *   mounting flush itself when the unread derive skips the flight (#4479),
 *   at the landing otherwise (the derive's landing pass, a frame reader,
 *   read the screen).
 *
 * The forms the #4479 review probed (a key read, `Object.keys`, a JSON
 * walk) must match the memo form, mounted mid-flight with and without a
 * plain write beside the flight (with it, the store form showed `r:5`, an
 * answer to a question between the two, before `r:6`). So must a reader
 * already on screen at the re-ask, with the plain write (before the fix the
 * whole-object readers showed `s:3` beside the old `v` ahead of `r:4`), and
 * a reader mounted after the landing, which shows at once: the hold reaches
 * neither.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
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

type Form = "memo" | "storeKey" | "storeKeys" | "storeJSON";
const storeForms = ["storeKey", "storeKeys", "storeJSON"] as const;

/** The reader's display of `v`: every form shows the same text. */
async function run(form: Form, at: "before" | "during" | "duringWrite" | "afterLanding") {
  const log: string[] = [];
  const [s, setS] = createSignal(1);
  const [on, setOn] = createSignal(at === "before");
  createRoot(() => {
    const m0 = createMemo(() => latest(s) + s());
    const m1 = createMemo(async () => {
      const v = m0();
      await sleep(100);
      return v;
    });
    let read: () => unknown = () => m1();
    if (form !== "memo") {
      const [st] = createStore<{ v?: number }>(d => {
        d.v = m1();
      }, {});
      read =
        form === "storeKey"
          ? () => st.v
          : form === "storeKeys"
            ? () => (Object.keys(st).join() === "v" ? (st as any).v : "keys?")
            : () => JSON.parse(JSON.stringify(st)).v;
    }
    if (at !== "during")
      createRenderEffect(
        () => `s:${s()}`,
        v => void log.push(v)
      );
    createRenderEffect(
      () => (on() ? `r:${read()}` : "r:off"),
      v => void log.push(v)
    );
  });
  flush();
  await tick(150);
  setS(2); // m1 re-asks
  flush();
  log.push("--reask");
  await tick(20);
  if (at === "during" || at === "duringWrite") {
    setOn(true); // a reader mounts mid-flight; nothing read the store before
    flush();
    log.push("--mounted");
  }
  if (at !== "during") {
    await tick(10);
    setS(3); // a plain write beside the flight
    flush();
    log.push("--plain write");
  }
  await tick(300);
  if (at === "afterLanding") {
    setOn(true);
    flush();
    log.push("--mounted");
  }
  await tick(300);
  return log;
}

describe("a reader mounted mid-flight reads a derived store like its memo (#4491)", () => {
  test("memo form: the mount is held until m1 answers (F-2)", async () => {
    expect(await run("memo", "during")).toEqual(["r:off", "--reask", "--mounted", "r:4"]);
  });
  test("memo form, a plain write beside the flight: held with it, re-asked once", async () => {
    expect(await run("memo", "duringWrite")).toEqual([
      "s:1",
      "r:off",
      "s:2",
      "--reask",
      "--mounted",
      "--plain write",
      "r:6",
      "s:3"
    ]);
  });
  for (const form of storeForms)
    test(`${form}: held like the memo form, never the old question's r:2 (D-30)`, async () => {
      expect(await run(form, "during")).toEqual(await run("memo", "during"));
      // The write beside the flight shows no answer of a question between
      // the two (`r:5`) either: the memo form's screen, frame for frame.
      expect(await run(form, "duringWrite")).toEqual(await run("memo", "duringWrite"));
    });
});

describe("readers the hold does not reach (#4491)", () => {
  test("memo form, reader on screen at the re-ask; reader mounted after the landing", async () => {
    expect(await run("memo", "before")).toEqual([
      "s:1",
      "r:2",
      "--reask",
      "--plain write",
      "r:4",
      "s:3",
      "r:6"
    ]);
    expect(await run("memo", "afterLanding")).toEqual([
      "s:1",
      "r:off",
      "s:2",
      "--reask",
      "s:3",
      "--plain write",
      "r:6",
      "--mounted"
    ]);
  });
  for (const form of storeForms)
    test(`${form}: as the memo form`, async () => {
      expect(await run(form, "before")).toEqual(await run("memo", "before"));
      expect(await run(form, "afterLanding")).toEqual(await run("memo", "afterLanding"));
    });
});
