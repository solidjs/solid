// A memo that reads a verdict memo is a verdict reader (D-25, #4050) without
// opening a window of its own. When that verdict memo goes pending, none of
// what an async one read changed: it waits on it like any derivation (F-9),
// and a pass its hold re-runs is the hold's work, reading plainly (D-25,
// #3884, verdict.ts `holdWork`), so it asks its next question once, at the
// landing. Before: `m1` over
// `m0 = ask(1 + latest(s) + s())` was re-derived when `m0` re-asked, served
// `m0`'s committed value (A10) — the one it had already derived `m1:5` from —
// and asked `m1:5` again; that flight held the verdict lane, `m0`'s landing
// re-ran it as lane work onto the same committed value (a third `m1:5`), and
// only the landing's re-derive asked `m1:6`.
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh
} from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(15);
    flush();
  }
}

const expected = {
  // The verdict lane answers m0's display-ahead intermediate (`latest(s)` = 2
  // beside the screen's `s()` = 1) and m1 over it while `h` holds the write
  // (F-6: async derived from a display-ahead read is the lane's), then the
  // landing asks each memo once.
  "latest held": ["m0:4", "m1:5", "m0:5", "m1:6"],
  "latest unheld": ["m0:4", "m0:5", "m1:6"],
  "plain held": ["m0:5", "m1:6"],
  "plain unheld": ["m0:5", "m1:6"]
};

for (const useLatest of [true, false])
  for (const heldWrite of [true, false]) {
    const name = `${useLatest ? "latest" : "plain"} ${heldWrite ? "held" : "unheld"}`;
    it(`${name}: an async memo over a verdict memo asks each question once`, async () => {
      const [s, setS] = createSignal(1);
      const asks: string[] = [];
      const ask = (name: string, v: number) => {
        asks.push(`${name}:${v}`);
        return sleep(10).then(() => {
          if (v === 3) throw new Error(`${name}:${v}`);
          return v;
        });
      };
      const out: string[] = [];
      createRoot(() => {
        const m0 = createMemo(() => ask("m0", 1 + (useLatest ? latest(s) : s()) + s()));
        const m1 = createMemo(() => ask("m1", 1 + m0()));
        // Holds the write's frame for 80ms (the boundary's content reads it).
        const h = createMemo(() => (s() === 1 ? 1 : sleep(80).then(() => 1)));
        createErrorBoundary(
          () =>
            createLoadingBoundary(
              () => {
                createRenderEffect(
                  () => (heldWrite ? h() : 0, String(isPending(m1))),
                  v => void out.push(v)
                );
                return null;
              },
              () => "L"
            ),
          () => "E"
        );
      });
      flush();
      await settle();
      expect(asks).toEqual(["m0:3"]);
      setS(2);
      await settle();
      await settle();
      const after = asks.slice(1);
      expect(after).toEqual(expected[name as keyof typeof expected]);
      const m1Asks = after.filter(a => a.startsWith("m1"));
      expect(new Set(m1Asks).size).toBe(m1Asks.length);
      expect(out[out.length - 1]).toBe("false");
    });
  }

// Settled memos, no boundary hold: the verdict lane shows `m0:4`/`m1:5`, the
// write's landing re-asks `m0`, and `m1` waits on it — pending throughout,
// its next question asked once.
for (const reader of ["m1()", "[isPending(m1), m1()]"] as const)
  it(`${reader}: a memo over a re-asking verdict memo waits on it, pending`, async () => {
    const [s, setS] = createSignal(1);
    const asks: string[] = [];
    const ask = (name: string, v: number) => {
      asks.push(`${name}:${v}`);
      return sleep(10).then(() => v);
    };
    const out: string[] = [];
    createRoot(() => {
      const m0 = createMemo(() => ask("m0", 1 + latest(s) + s()));
      const m1 = createMemo(() => ask("m1", 1 + m0()));
      createLoadingBoundary(
        () => {
          createRenderEffect(
            () => (reader === "m1()" ? String(m1()) : `${isPending(m1)},${m1()}`),
            v => void out.push(v)
          );
          return null;
        },
        () => "L"
      );
    });
    flush();
    await settle();
    expect(asks).toEqual(["m0:3", "m1:4"]);
    setS(2);
    await settle();
    await settle();
    expect(asks.slice(2)).toEqual(["m0:4", "m1:5", "m0:5", "m1:6"]);
    if (reader === "m1()") expect(out).toEqual(["4", "5", "6"]);
    else {
      expect(out[0]).toBe("false,4");
      expect(out[out.length - 1]).toBe("false,6");
      // Never final before `m1:6` lands.
      expect(out.slice(1, -1).every(v => v.startsWith("true,"))).toBe(true);
    }
  });

// Two verdict memos feeding one async memo (#4397 review): `m1` over
// `m0 = ask(1 + latest(s) + s())` and `m0b = ask(10 * (latest(t) + t()))`,
// `setS(2)` then `setT(1)` 12ms later. An async memo that opened no window
// of its own waits on a verdict source going pending like any derivation
// (F-9), and its hold's re-run of it reads plainly (D-25, verdict.ts
// `holdWork`), so no question is asked twice, whether `[isPending(m1), m1()]`
// is read in one render effect or in two (D-25).
async function twoVerdicts(grouped: boolean) {
  const [s, setS] = createSignal(1);
  const [t, setT] = createSignal(0);
  const asks: string[] = [];
  const ask = (name: string, v: number) => {
    asks.push(`${name}:${v}`);
    return sleep(10).then(() => v);
  };
  const shown = { pending: "", value: "" };
  createRoot(() => {
    const m0 = createMemo(() => ask("m0", 1 + latest(s) + s()));
    const m0b = createMemo(() => ask("m0b", 10 * (latest(t) + t())));
    const m1 = createMemo(() => ask("m1", 1 + m0() + m0b()));
    createLoadingBoundary(
      () => {
        if (grouped)
          createRenderEffect(
            () => [String(isPending(m1)), String(m1())],
            ([p, v]) => void Object.assign(shown, { pending: p, value: v })
          );
        else {
          createRenderEffect(
            () => String(isPending(m1)),
            p => void (shown.pending = p)
          );
          createRenderEffect(
            () => String(m1()),
            v => void (shown.value = v)
          );
        }
        return null;
      },
      () => "L"
    );
  });
  flush();
  await settle();
  asks.length = 0;
  setS(2);
  await sleep(12);
  flush();
  setT(1);
  await settle();
  await settle();
  return { asks, shown };
}

it("two verdict memos into one async memo: no question asked twice, grouped or split", async () => {
  const grouped = await twoVerdicts(true);
  const split = await twoVerdicts(false);
  for (const { asks } of [grouped, split]) expect(new Set(asks).size).toBe(asks.length);
  expect(grouped.shown).toEqual({ pending: "false", value: "26" });
  expect(split.shown).toEqual(grouped.shown);
});

// Open question (lane merge, #4398): with the grouped reader,
// `m1` is pending in the s write's transaction and the render effect reading
// `isPending(m1)` beside `m1()` is held there, so the t write merges into
// that transaction instead of opening its own lane — the t lane's views of
// `m1` (`m1:15`, `m1:16`) are never asked. Split, the t write opens its own
// lane and they are asked. Whether a later write merges into an open
// transaction or opens its own lane must not depend on grouping (D-25,
// D-26; F-6: `[isPending(x), x()]` in one render effect holds like `x()`
// alone).
it.fails(
  "two verdict memos into one async memo: grouped asks the t lane's questions as split does",
  async () => {
    const grouped = await twoVerdicts(true);
    const split = await twoVerdicts(false);
    expect(grouped.asks).toEqual(split.asks);
  }
);

// Grouping never changes the result (F-6: `[isPending(x), x()]` in one
// render effect holds like `x()` alone). Over a write `h` holds, the grouped
// reader read `h` as a stale reader of the transaction (A15) and the verdict
// lane's reveal re-derived it: the reveal's re-run cleared the frame-read
// mark the transaction's hold counts, so the transaction landed with `h` in
// flight, the landing voided the reveal's run, and `m1`'s lane answer was
// asked and never shown. A lane's reveal now leaves the mark to the
// transaction (`reruns`). And a pass served a held node's committed value
// does not wait on its flight (`frameRead`): a reader that went
// pending on a `refresh()` of `m0` mid-hold woke when the re-ask landed,
// instead of waiting on `h` too and skipping `m1`'s lane answer.
async function heldShapes(
  f: (l: number, v: number) => number,
  script: (setS: (v: number) => void, m0: () => number) => Promise<void>
) {
  const shown: Record<string, string[]> = {};
  const asked: Record<string, string[]> = {};
  for (const reader of ["value", "pair", "split"] as const) {
    const [s, setS] = createSignal(1);
    const asks: string[] = [];
    const values: string[] = [];
    const ask = (n: string, v: number) => {
      asks.push(`${n}:${v}`);
      return sleep(10).then(() => v);
    };
    const show = (v: string) => void (values.at(-1) !== v && values.push(v));
    let m0!: () => number;
    const dispose = createRoot(dispose => {
      m0 = createMemo(() => ask("m0", f(latest(s), s())));
      const m1 = createMemo(() => ask("m1", 100 + m0()));
      const h = createMemo(() => (s() === 1 ? 1 : sleep(80).then(() => 1)));
      createLoadingBoundary(
        () => {
          if (reader === "pair")
            createRenderEffect(
              () => (h(), [isPending(m1), m1()] as const),
              ([, v]) => show(String(v))
            );
          else if (reader === "split") {
            createRenderEffect(
              () => (h(), isPending(m1)),
              () => {}
            );
            createRenderEffect(
              () => (h(), m1()),
              v => show(String(v))
            );
          } else
            createRenderEffect(
              () => (h(), m1()),
              v => show(String(v))
            );
          return null;
        },
        () => "L"
      );
      return dispose;
    });
    flush();
    await settle();
    asks.length = 0;
    await script(setS, m0);
    await settle();
    await settle();
    dispose();
    shown[reader] = values;
    asked[reader] = asks;
  }
  return { shown, asked };
}

it("held write: grouped shows m1's lane answer as a value read does", async () => {
  const { shown, asked } = await heldShapes(
    (l, v) => 1 + l + v,
    async setS => setS(2)
  );
  expect(shown.value).toEqual(["103", "104", "105"]);
  expect(shown.pair).toEqual(shown.value);
  expect(shown.split).toEqual(shown.value);
  for (const a of Object.values(asked)) expect(a).toEqual(["m0:4", "m1:104", "m0:5", "m1:105"]);
});

it("held write landing equal: grouped shows m1's lane answer as a value read does", async () => {
  const { shown } = await heldShapes(
    (l, v) => l - v + 3,
    async setS => setS(2)
  );
  expect(shown.value).toEqual(["103", "104", "103"]);
  expect(shown.pair).toEqual(shown.value);
  expect(shown.split).toEqual(shown.value);
});

it("held write, refresh after it settles: grouped shows m1's lane answer as a value read does", async () => {
  const { shown } = await heldShapes(
    (l, v) => 1 + l + v,
    async (setS, m0) => {
      setS(2);
      await settle();
      await settle();
      refresh(m0);
      flush();
    }
  );
  expect(shown.value).toEqual(["103", "104", "105"]);
  expect(shown.pair).toEqual(shown.value);
  expect(shown.split).toEqual(shown.value);
});

it("held write, refresh mid-hold: every shape shows m1's lane answer", async () => {
  const { shown, asked } = await heldShapes(
    (l, v) => 1 + l + v,
    async (setS, m0) => {
      setS(2);
      await sleep(12);
      flush();
      refresh(m0);
      flush();
    }
  );
  expect(shown.value).toEqual(["103", "104", "105"]);
  expect(shown.pair).toEqual(shown.value);
  expect(shown.split).toEqual(shown.value);
  for (const a of Object.values(asked))
    expect(a).toEqual(["m0:4", "m1:104", "m0:4", "m0:5", "m1:105"]);
});

// The `latest()` read extracted into a sync memo (D-22): `v` is a verdict
// memo, and `m1`, an async memo over `v()` and `s()`, reads its value, so it
// is a verdict reader itself (D-25, #4050), as the inline `latest(s)` makes
// it. The write's verdict lane asks `m1:120` (`v`'s lane value, the
// screen's `s()`), revealed ahead of the transaction (F-6: v120 then v220),
// and the landing asks `m1:220` — each once, as inline. Before: an async
// memo with no window of its own took no verdict role, so its pass at the
// write read the transaction's staging and asked `m1:220`, the lane
// re-derived it on the screen (`m1:120`), and the landing asked `m1:220`
// again (F-9: a re-ask of the same question is no new question). A later
// write before the landing is a new question, asked once.
async function extracted(reader: "value" | "pair" | "split", second: boolean, inline = false) {
  // Flights land only when the test lands them, so the later write always
  // comes while the write's flights are up, at any runner speed.
  const flights: (() => void)[] = [];
  const land = async () => {
    for (let i = 0; i < 8; i++) {
      flights.splice(0).forEach(f => f());
      await sleep(0);
      flush();
    }
  };
  const [s, setS] = createSignal(1);
  const [u, setU] = createSignal(0);
  const asks: string[] = [];
  const values: string[] = [];
  const show = (x: string) => void (values.at(-1) !== x && values.push(x));
  const dispose = createRoot(dispose => {
    const v = inline ? () => latest(s) : createMemo(() => latest(s));
    const m1 = createMemo(() => {
      const q = v() * 10 + s() * 100 + u();
      asks.push(`m1:${q}`);
      return new Promise<number>(r => flights.push(() => r(q)));
    });
    createLoadingBoundary(
      () => {
        if (reader === "pair")
          createRenderEffect(
            () => [isPending(m1), m1()] as const,
            ([, x]) => show(`v${x}`)
          );
        else if (reader === "split") {
          createRenderEffect(
            () => isPending(m1),
            () => {}
          );
          createRenderEffect(m1, x => show(`v${x}`));
        } else createRenderEffect(m1, x => show(`v${x}`));
        return null;
      },
      () => "L"
    );
    return dispose;
  });
  flush();
  await land();
  asks.length = 0;
  setS(2);
  flush();
  if (second) {
    await sleep(0);
    flush();
    setU(5);
    flush();
  }
  await land();
  dispose();
  return { asks, values };
}

for (const reader of ["value", "pair", "split"] as const)
  it(`${reader}: an async memo over a latest() memo asks each question once, as inline`, async () => {
    for (const inline of [false, true]) {
      const one = await extracted(reader, false, inline);
      expect(one.asks).toEqual(["m1:120", "m1:220"]);
      expect(one.values).toEqual(["v110", "v120", "v220"]);
      const two = await extracted(reader, true, inline);
      expect(two.asks).toEqual(["m1:120", "m1:125", "m1:225"]);
      expect(two.values).toEqual(["v110", "v125", "v225"]);
    }
  });

// A reader disposed and mounted again while the write's lane answer is in
// flight: mounted mid-hold, it shows what is on the screen and reveals with
// the hold (D-26), and grouping `[isPending(m1), m1()]` in one render effect
// holds like `m1()` alone (F-6). Before: `m1`, no verdict reader, kept the
// lane flight its reader had left, which landed after the lane ended — the
// grouped remount showed `true,5`, a lane answer the screen never showed.
async function remounted(reader: "value" | "pair" | "split", later: boolean) {
  const [s, setS] = createSignal(1);
  const [u, setU] = createSignal(0);
  const asks: string[] = [];
  const out: string[] = [];
  const ask = (n: string, v: number) => {
    asks.push(`${n}:${v}`);
    return sleep(10).then(() => v);
  };
  let unmount!: () => void;
  const mount = () =>
    createRoot(d => {
      unmount = d;
      createLoadingBoundary(
        () => {
          const push = (x: string) => void out.push(x);
          if (reader === "pair") createRenderEffect(() => `${isPending(m1)},${m1()}`, push);
          else if (reader === "split") {
            createRenderEffect(() => `p${isPending(m1)}`, push);
            createRenderEffect(() => `v${m1()}`, push);
          } else createRenderEffect(() => `v${m1()}`, push);
          return null;
        },
        () => "L"
      );
    });
  let m1!: () => number;
  const dispose = createRoot(dispose => {
    const m0 = createMemo(() => ask("m0", 1 + latest(s) + s()));
    m1 = createMemo(() => ask("m1", 1 + m0() + u()));
    createMemo(() => (s() === 1 ? 1 : sleep(80).then(() => 1)));
    mount();
    return dispose;
  });
  flush();
  await settle();
  asks.length = 0;
  setS(2);
  await sleep(12);
  flush();
  unmount();
  flush();
  await sleep(8);
  mount();
  flush();
  if (later) setU(5);
  await settle();
  await settle();
  unmount();
  dispose();
  return { asks, out };
}

// Timing decides whether the landing's `m1:6` is asked before the remount
// (and, with a later write, before it), in every shape alike: the pins are
// what holds either way. No question is asked twice; no shape shows the
// lane's `m1:5`, which the screen never showed; each ends on the landing.
for (const later of [false, true])
  it(`remounted mid-flight${later ? ", then a write" : ""}: every shape shows the screen, then the landing`, async () => {
    const last = later ? 11 : 6;
    for (const reader of ["value", "pair", "split"] as const) {
      const { asks, out } = await remounted(reader, later);
      expect(new Set(asks).size).toBe(asks.length);
      expect(asks.slice(0, 3)).toEqual(["m0:4", "m1:5", "m0:5"]);
      expect(asks.at(-1)).toBe(`m1:${last}`);
      const values = out
        .map(x => x.slice(x.indexOf(",") + 1).replace(/^[vp]/, ""))
        .filter(x => !/^(true|false)$/.test(x));
      expect(values).not.toContain("5");
      expect(values[0]).toBe("4");
      expect(values.at(-1)).toBe(String(last));
      if (reader === "pair") {
        expect(out[0]).toBe("false,4");
        expect(out.at(-1)).toBe(`false,${last}`);
      } else if (reader === "split") expect(out.filter(x => x[0] === "p").at(-1)).toBe("pfalse");
    }
  });
