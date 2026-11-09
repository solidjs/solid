// D-25 (a verdict posture outlives the pass that asked) has `propagateStatus`
// re-derive a verdict reader when a source it probed settles — pending or
// errored, the answer `isPending`/`latest` give changed, so the pass runs
// again. That shortcut returned before retiring the settled source from the
// reader's `_pendingSources`: an errored probe target stayed in the set, the
// re-run parked on a second source (added beside it), and that source's
// landing found the errored one as `remaining` — the reader stayed pending on
// a source that will never settle, and the boundary over it never released.
// Found while shadowing the seat table (no issue number).
import { expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

type Flight = {
  label: string;
  value: number;
  rejects: boolean;
  resolve: (v: number) => void;
  reject: (e: unknown) => void;
};

const microtask = () => Promise.resolve();
const macrotask = () => new Promise(r => setTimeout(r, 0));
async function drain() {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 6; j++) await microtask();
    flush();
    await macrotask();
  }
  flush();
}

function harness() {
  const log: string[] = [];
  const flights: Flight[] = [];
  const flight = (label: string, value: number, rejects: boolean) =>
    new Promise<number>((resolve, reject) =>
      flights.push({ label, value, rejects, resolve, reject })
    );
  const settle = (label: string) => {
    const i = flights.findIndex(f => f.label.startsWith(label));
    if (i < 0) throw new Error(`no flight ${label} among ${flights.map(f => f.label)}`);
    const [f] = flights.splice(i, 1);
    log.push("settle " + f.label);
    if (f.rejects) f.reject(new Error(f.label));
    else f.resolve(f.value);
  };
  const shown = { loading: undefined as unknown, screen: undefined as unknown };
  // The reader under test: a verdict reader of `m2` that also reads `m0`
  // plainly, under a Loading boundary.
  const mount = (m0: () => number, m2: () => number) => {
    const boundary = createLoadingBoundary(
      () => {
        createRenderEffect(
          () => [isPending(m2), m0()],
          v => {
            shown.screen = v;
            log.push("screen " + JSON.stringify(v));
          }
        );
        return "content";
      },
      () => "[fallback]"
    );
    createRenderEffect(boundary, v => {
      shown.loading = v;
      log.push("boundary " + v);
    });
  };
  return { log, flights, flight, settle, shown, mount };
}

it("a verdict reader whose probed source errored, re-parked on a flight it must observe, is released at that flight's landing", async () => {
  const { log, flight, settle, shown, mount } = harness();
  const [input, setInput] = createSignal(0);
  const [pick, setPick] = createSignal(true);
  createRoot(() => {
    // `m0` answers 3 whatever `input` is: its re-ask lands on an unchanged
    // value, which notifies nobody — only the settle walk reaches the reader.
    const m0 = createMemo(() => flight(`m0:${input()}`, 3, false));
    const m1 = createMemo(() => flight("m1", 3, false));
    // Async over async: `m2` asks at `m1`'s landing, and that flight rejects.
    const m2 = createMemo(() => flight(`m2:${1 + m1()}`, 0, true));
    createRenderEffect(
      () => (pick() ? m0() : "other"),
      () => {}
    );
    createRenderEffect(input, () => {});
    mount(m0, m2);
  });
  flush();
  await drain();
  // Give `m0` a committed value, then drop its reader.
  settle("m0:0");
  await drain();
  setPick(false);
  await drain();
  // The write to `input` commits beneath `m0`'s unobserved re-ask (the
  // published-inputs mark): a verdict reader reaching it is not served the
  // committed 3 — it observes the flight (A15 reveal corollary).
  setInput(1);
  await drain();
  // `m2` goes pending on its own flight, then errors: the reader re-derives,
  // finds `isPending(m2)` false, and parks on `m0`.
  settle("m1");
  await drain();
  settle("m2");
  await drain();
  expect(shown.loading).toBe("[fallback]");
  // `m0` lands on the value it already had: the reader must be released.
  settle("m0:1");
  await drain();
  expect(shown.screen).toEqual([false, 3]);
  expect(shown.loading).toBe("content");
  expect(log.slice(-2)).toEqual(["screen [false,3]", "boundary content"]);
});

it("the shape it was found in: un-owned memos, the plain read waking a released source", async () => {
  const { flights, flight, settle, shown, mount } = harness();
  const [input] = createSignal(2);
  // Created outside any root: `m0`'s first landing finds no subscriber and
  // is released, so the reader's plain read wakes it into a fresh flight.
  const m0 = createMemo(() => flight(`m0:${1 + input()}`, 1 + input(), false));
  const m1 = createMemo(() => flight(`m1:${1 + input()}`, 1 + input(), false));
  const m2 = createMemo(() => {
    const v = 1 + m1();
    return flight(`m2:${v}`, v, v % 4 === 0);
  });
  createRoot(() => mount(m0, m2));
  flush();
  await drain();
  let rounds = 0;
  while (flights.length && rounds++ < 25) {
    while (flights.length) settle(flights[0].label);
    await drain();
  }
  expect(shown.screen).toEqual([false, 3]);
  expect(shown.loading).toBe("content");
});
