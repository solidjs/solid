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

// Flights land only when the test lands them, so each step of a pin comes
// at the same point of the write's flights at any runner speed. `land(n)`
// lands what is up, `n` times over (what a landing asks is up next round).
function inFlight() {
  const up: (() => void)[] = [];
  const land = async (rounds = 8) => {
    for (let i = 0; i < rounds; i++) {
      up.splice(0).forEach(f => f());
      await sleep(0);
      flush();
    }
  };
  const fly = <T>(v: T) => new Promise<T>(r => up.push(() => r(v)));
  return { land, fly };
}

// A memo that holds the write's frame (the boundary's content reads it) until
// the test releases it, after the write's other flights have landed.
function holder(s: () => number) {
  let release = () => {};
  const h = createMemo(() =>
    s() === 1 ? 1 : new Promise<number>(r => void (release = () => r(1)))
  );
  return { h, release: () => release() };
}

const expected = {
  // The verdict lane answers m0's display-ahead intermediate (`latest(s)` = 2
  // beside the screen's `s()` = 1) and m1 over it while `h` holds the write
  // (F-6: async derived from a display-ahead read is the lane's), then the
  // landing asks each memo once.
  "latest held": ["m0:4", "m1:5", "m0:5", "m1:6"],
  // Unheld too: `m1` never resolved (`m0:3` rejected), so `isPending(m1)` of
  // the lane node throws NotReady (A19 exc. 1, #4362) and the Loading holds
  // the write like `h` does.
  "latest unheld": ["m0:4", "m1:5", "m0:5", "m1:6"],
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
// its next question asked once. Before: `m1:5` was asked three times
// (F-9; D-25, verdict.ts `holdWork`).
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

// Before: grouped and split alike asked the t lane's `m1:15` four times
// (F-9; D-25, verdict.ts `holdWork`).
it("two verdict memos into one async memo: no question asked twice, grouped or split", async () => {
  const grouped = await twoVerdicts(true);
  const split = await twoVerdicts(false);
  for (const { asks } of [grouped, split]) expect(new Set(asks).size).toBe(asks.length);
  expect(grouped.shown).toEqual({ pending: "false", value: "26" });
  expect(split.shown).toEqual(grouped.shown);
});

// Lane merge (#4398): whether a later write merges into an open transaction
// or opens its own lane must not depend on grouping (D-25, D-26; F-6:
// `[isPending(x), x()]` in one render effect holds like `x()` alone). Holds
// on next: grouped and split ask the same questions, the t lane's views of
// `m1` among them. Fails here (#4398): with the grouped reader, `m1` is
// pending in the s write's transaction and the render effect reading
// `isPending(m1)` beside `m1()` is held there, so the t write merges into
// that transaction and the t lane's `m1:15`/`m1:16` are never asked.
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
// reader reads `h` as a stale reader of the transaction (A15) and the
// verdict lane's reveal re-derives it; the transaction's landing must re-run
// it (the reveal leaves the frame-read mark to the transaction), and a pass
// served a held node's committed value does not wait on its flight: a reader
// that went pending on a `refresh()` of `m0` mid-hold wakes when the re-ask
// lands, without waiting on `h` too, and shows `m1`'s lane answer. `h` holds
// until the write's other flights have landed.
type Hold = { land: (rounds?: number) => Promise<void>; release: () => void };
async function heldShapes(
  f: (l: number, v: number) => number,
  script: (setS: (v: number) => void, m0: () => number, hold: Hold) => Promise<void>
) {
  const shown: Record<string, string[]> = {};
  const asked: Record<string, string[]> = {};
  for (const reader of ["value", "pair", "split"] as const) {
    const { land, fly } = inFlight();
    const [s, setS] = createSignal(1);
    const asks: string[] = [];
    const values: string[] = [];
    const ask = (n: string, v: number) => {
      asks.push(`${n}:${v}`);
      return fly(v);
    };
    const show = (v: string) => void (values.at(-1) !== v && values.push(v));
    let m0!: () => number;
    let release!: () => void;
    const dispose = createRoot(dispose => {
      m0 = createMemo(() => ask("m0", f(latest(s), s())));
      const m1 = createMemo(() => ask("m1", 100 + m0()));
      const hold = holder(s);
      const h = hold.h;
      release = hold.release;
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
    await land();
    asks.length = 0;
    await script(setS, m0, { land, release });
    await land();
    release();
    await land();
    dispose();
    shown[reader] = values;
    asked[reader] = asks;
  }
  return { shown, asked };
}

// Before: `m1:104` was asked three times (F-9; D-25, verdict.ts
// `holdWork`).
it("held write: grouped shows m1's lane answer as a value read does", async () => {
  const { shown, asked } = await heldShapes(
    (l, v) => 1 + l + v,
    async setS => {
      setS(2);
      flush();
    }
  );
  expect(shown.value).toEqual(["103", "104", "105"]);
  expect(shown.pair).toEqual(shown.value);
  expect(shown.split).toEqual(shown.value);
  for (const a of Object.values(asked)) expect(a).toEqual(["m0:4", "m1:104", "m0:5", "m1:105"]);
});

it("held write landing equal: grouped shows m1's lane answer as a value read does", async () => {
  const { shown } = await heldShapes(
    (l, v) => l - v + 3,
    async setS => {
      setS(2);
      flush();
    }
  );
  expect(shown.value).toEqual(["103", "104", "103"]);
  expect(shown.pair).toEqual(shown.value);
  expect(shown.split).toEqual(shown.value);
});

it("held write, refresh after it settles: grouped shows m1's lane answer as a value read does", async () => {
  const { shown } = await heldShapes(
    (l, v) => 1 + l + v,
    async (setS, m0, { land, release }) => {
      setS(2);
      flush();
      await land();
      release();
      await land();
      refresh(m0);
      flush();
    }
  );
  expect(shown.value).toEqual(["103", "104", "105"]);
  expect(shown.pair).toEqual(shown.value);
  expect(shown.split).toEqual(shown.value);
});

// The refresh comes once `m0:4` has landed, with the lane's `m1:104` up.
// Before: `m1:104` was asked four times (F-9; D-25, verdict.ts
// `holdWork`).
it("held write, refresh mid-hold: every shape shows m1's lane answer", async () => {
  const { shown, asked } = await heldShapes(
    (l, v) => 1 + l + v,
    async (setS, m0, { land }) => {
      setS(2);
      flush();
      await land(1);
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
// and the landing asks `m1:220` — each once, as inline (F-9: a re-ask of the
// same question is no new question). A later write before the landing is a
// new question, asked once.
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
// holds like `m1()` alone (F-6): no shape shows a lane answer the screen
// never showed. The unmount and the remount come once `m0:4` has landed,
// with the lane's `m1:5` up; a later write comes right after the remount.
async function remounted(reader: "value" | "pair" | "split", later: boolean) {
  const { land, fly } = inFlight();
  const [s, setS] = createSignal(1);
  const [u, setU] = createSignal(0);
  const asks: string[] = [];
  const out: string[] = [];
  const ask = (n: string, v: number) => {
    asks.push(`${n}:${v}`);
    return fly(v);
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
  let release!: () => void;
  const dispose = createRoot(dispose => {
    const m0 = createMemo(() => ask("m0", 1 + latest(s) + s()));
    m1 = createMemo(() => ask("m1", 1 + m0() + u()));
    release = holder(s).release;
    mount();
    return dispose;
  });
  flush();
  await land();
  asks.length = 0;
  setS(2);
  flush();
  await land(1);
  unmount();
  flush();
  mount();
  flush();
  if (later) setU(5);
  await land();
  release();
  await land();
  unmount();
  dispose();
  return { asks, out };
}

// No question is asked twice; no shape shows the lane's `m1:5`, which the
// screen never showed; each ends on the landing.
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

// Own windows. A memo that calls `isPending()`/`latest()` itself is a verdict
// reader (D-25), whatever it returns: `m1`, async, over
// `${isPending(m0)}:${latest(m0)}` asks at the write with `m0`'s flight up
// (`true:1`), when it lands with the write still pending (`true:2`) and at
// the landing (`false:2`), and the lane's `true:2` shows ahead of the
// landing's `false:2` (F-6: async derived from a display-ahead read is the
// lane's).
it("own window: an async memo over isPending() and latest() of an async memo shows the lane's answer ahead", async () => {
  const { land, fly } = inFlight();
  const [s, setS] = createSignal(1);
  const asks: string[] = [];
  const out: string[] = [];
  const dispose = createRoot(dispose => {
    const m0 = createMemo(() => (asks.push(`m0:${s()}`), fly(s())));
    const m1 = createMemo(() => {
      const q = `${isPending(m0)}:${latest(m0)}`;
      asks.push(q);
      return fly(q);
    });
    createLoadingBoundary(
      () => {
        createRenderEffect(m1, v => void out.push(v));
        return null;
      },
      () => "L"
    );
    return dispose;
  });
  flush();
  await land();
  expect(asks).toEqual(["m0:1", "false:1"]);
  expect(out).toEqual(["false:1"]);
  asks.length = 0;
  setS(2);
  flush();
  await land();
  dispose();
  expect(asks).toEqual(["m0:2", "true:1", "true:2", "false:2"]);
  expect(out).toEqual(["false:1", "true:2", "false:2"]);
});

// `m1`, async, over `latest(m0)` opens a window of its own (D-25): it asks
// `l1` at the write, `m0`'s flight up, and `l2` once it lands, and
// `[isPending(m1), m1()]` in one render effect shows the screen, then `l2`'s
// answer, never pending — `l1`'s answer is the screen's (F-6).
it("own window: an async memo over latest() of an async memo, read with isPending() beside it", async () => {
  const { land, fly } = inFlight();
  const [s, setS] = createSignal(1);
  const asks: string[] = [];
  const out: string[] = [];
  const dispose = createRoot(dispose => {
    const m0 = createMemo(() => (asks.push(`m0:${s()}`), fly(s())));
    const m1 = createMemo(() => {
      const l = latest(m0);
      asks.push(`l${l}`);
      return fly(l);
    });
    createLoadingBoundary(
      () => {
        createRenderEffect(
          () => [isPending(m1), m1()] as const,
          ([p, v]) => void out.push(`${p},${v}`)
        );
        return null;
      },
      () => "L"
    );
    return dispose;
  });
  flush();
  await land();
  expect(asks).toEqual(["m0:1", "l1"]);
  expect(out).toEqual(["false,1"]);
  asks.length = 0;
  setS(2);
  flush();
  await land();
  dispose();
  expect(asks).toEqual(["m0:2", "l1", "l2"]);
  expect(out).toEqual(["false,1", "false,2"]);
});
