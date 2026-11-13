/**
 * S-51 (F-1, F-2, F-9, D-22): a second write while an async reader that
 * reads ahead holds the first.
 *
 * `data` is async over `source` and a read ahead of it; nothing else holds
 * the writes. `setSource("/slow1")`, then `setSource("/slow2")` before the
 * first answers. The reader's pass that opened the hold asked the frame's
 * question (`/slow1`); the second write supersedes it, so the reader's pass
 * is the frame's again and asks `/slow2` at once — not at the landing, with
 * the hold waiting on an answer nobody will read. Every row:
 *
 * - ends on `/slow2`'s answer, shown in one frame with `source`;
 * - never shows `/slow1`'s answer, and never lands before `/slow2`'s;
 * - reads `isPending(source)` true from outside until that landing.
 *
 * Before this (2026-11-07 to 2026-11-12, the producer clause) the `latest`
 * row with the read ahead extracted into a memo asked `/slow1` only and
 * ended with its answer beside `source` `/slow2`.
 *
 * The second half is a second async reader over a memo that reads ahead: it
 * reads the memo's answer for this frame, as it would the window inline.
 */
import { describe, expect, test } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const kinds = ["none", "isPending", "latest"] as const;
// Where the read ahead sits: inline before or after the plain read, or
// extracted into a memo read before or after it.
const orders = ["plainFirst", "aheadFirst", "memoFirst", "memoLast"] as const;
// `cond`: only a `/slow…` source is a request (the screen's question
// answers synchronously). `always`: every pass asks.
const shapes = ["cond", "always"] as const;

async function run(
  kind: (typeof kinds)[number],
  order: (typeof orders)[number],
  shape: (typeof shapes)[number]
) {
  const log: string[] = [];
  const asks: string[] = [];
  const gates: Record<string, { promise: Promise<string>; resolve: (v: string) => void }> = {};
  const gate = (k: string) => {
    asks.push(k);
    if (!gates[k]) {
      let resolve!: (v: string) => void;
      gates[k] = { promise: new Promise<string>(r => (resolve = r)), resolve };
    }
    return gates[k].promise;
  };
  const [source, setSource] = createSignal("/");
  const dispose = createRoot(dispose => {
    const ahead = () =>
      kind === "isPending" ? isPending(source) : kind === "latest" ? latest(source) : "";
    const extracted = createMemo(ahead);
    const data = createMemo(() => {
      let p: unknown = "";
      const read = () => (p = order.startsWith("memo") ? extracted() : ahead());
      if (order === "aheadFirst" || order === "memoFirst") read();
      const v = source();
      if (order === "plainFirst" || order === "memoLast") read();
      const k = `${v}|${p}`;
      return shape === "always" || v.startsWith("/slow") ? gate(k) : k;
    });
    createRenderEffect(data, v => void log.push(`data: ${v}`));
    createRenderEffect(source, v => void log.push(`src: ${v}`));
    // An indicator beside it, as an app has.
    createRenderEffect(
      () => (isPending(source) ? latest(source) : "-"),
      v => void log.push(`ind: ${v}`)
    );
    return dispose;
  });
  flush();
  const answer = async (m: RegExp) => {
    for (const k in gates) if (m.test(k)) gates[k].resolve("=" + k);
    await tick();
    flush();
  };
  await answer(/^\/\|/);
  log.length = asks.length = 0;
  const outside: Record<string, boolean> = {};
  const mark = (at: string) => (log.push(`| ${at}`), (outside[at] = isPending(source)));
  setSource("/slow1");
  flush();
  mark("first write");
  await tick();
  setSource("/slow2");
  flush();
  mark("second write");
  await tick();
  await answer(/slow1/);
  mark("first answered");
  await answer(/^\/\|/);
  mark("screen's answered");
  await answer(/slow2/);
  mark("second answered");
  await answer(/./);
  mark("all answered");
  dispose();
  return { log, asks, outside };
}

describe("a second write supersedes the frame's question (S-51)", () => {
  for (const kind of kinds)
    for (const order of kind === "none" ? (["plainFirst"] as const) : orders)
      for (const shape of shapes)
        test(`${kind}, ${order}, ${shape}`, async () => {
          const { log, asks, outside } = await run(kind, order, shape);
          const p = kind === "none" ? "" : kind === "isPending" ? "false" : "/slow2";
          // The frame: `/slow2`'s answer and `source` together, once it
          // answered — never earlier, never `/slow1`'s.
          const shown = log.filter(x => x.startsWith("data: =/slow") || x.startsWith("src: "));
          expect(shown).toEqual([`data: =/slow2|${p}`, "src: /slow2"]);
          const at = (x: string) => log.indexOf(x);
          expect(at("data: =/slow2|" + p)).toBeGreaterThan(at("| screen's answered"));
          expect(at("src: /slow2")).toBeLessThan(at("| second answered"));
          // The indicator ends off, in that frame.
          expect(log.filter(x => x.startsWith("ind: ")).pop()).toBe("ind: -");
          expect(log.lastIndexOf("ind: -")).toBeLessThan(at("| second answered"));
          expect(outside).toEqual({
            "first write": true,
            "second write": true,
            "first answered": true,
            "screen's answered": true,
            "second answered": false,
            "all answered": false
          });
          // The requests: each write's question once, and (`always`) the
          // screen's beside it.
          const q = (v: string) =>
            `${v}|${kind === "none" ? "" : kind === "isPending" ? "false" : v}`;
          const screens = `/|${kind === "isPending" ? "true" : ""}`;
          const want =
            shape === "cond" || kind === "none"
              ? [q("/slow1"), q("/slow2")]
              : kind === "latest"
                ? [q("/slow1"), "/|/slow1", q("/slow2"), "/|/slow2"]
                : [q("/slow1"), screens, q("/slow2"), screens];
          expect(asks).toEqual(want);
        });
});

describe("a second async reader over a memo that reads ahead (S-51, D-22)", () => {
  // `r1 = async(s())` holds the write; `r2` asks with `latest(s) * 10`,
  // inline or through `m = memo(latest(s) * 10)`. Whichever pass runs first
  // and whichever answers first, `r2` asks 20 for the write and never the
  // 10 it already has, and `s` 2 shows only beside both answers. (Served
  // the screen's `m` because `r1`'s pending had opened the hold first, `r2`
  // asked 10 again and the landing showed `2 a2 b10` before asking 20.)
  for (const form of ["inline", "memo"] as const)
    for (const [d1, d2] of [
      [10, 10],
      [10, 30],
      [30, 10]
    ])
      for (const first of ["r1", "r2"] as const)
        test(`${form}, r1 ${d1}ms, r2 ${d2}ms, ${first} declared first`, async () => {
          const shown: string[] = [];
          const asked: number[] = [];
          let setS!: (v: number) => void;
          const dispose = createRoot(dispose => {
            const [s, set] = createSignal(1);
            setS = set;
            const m = createMemo(() => latest(s) * 10);
            const mk1 = () =>
              createMemo(async () => {
                const v = s();
                await sleep(d1);
                return `a${v}`;
              });
            const mk2 = () =>
              createMemo(async () => {
                const v = form === "inline" ? latest(s) * 10 : m();
                asked.push(v);
                await sleep(d2);
                return `b${v}`;
              });
            let r1: () => string, r2: () => string;
            if (first === "r1") ((r1 = mk1()), (r2 = mk2()));
            else ((r2 = mk2()), (r1 = mk1()));
            createRenderEffect(
              () => [s(), r1(), r2()].join(" "),
              v => void shown.push(v)
            );
            return dispose;
          });
          flush();
          await sleep(60);
          flush();
          shown.length = asked.length = 0;
          setS(2);
          flush();
          for (let i = 0; i < 12; i++) {
            await sleep(10);
            flush();
          }
          dispose();
          // `b20` may show ahead beside `1 a1` (F-6) when it answers first.
          expect(shown).toEqual(d2 < d1 ? ["1 a1 b20", "2 a2 b20"] : ["2 a2 b20"]);
          expect(new Set(asked)).toEqual(new Set([20]));
          // The memo form asks once. Inline, declared first, `r2`'s pass
          // opens the hold and the screen's pass asks the same 20 again.
          expect(asked.length).toBe(form === "inline" && first === "r2" ? 2 : 1);
        });
});
