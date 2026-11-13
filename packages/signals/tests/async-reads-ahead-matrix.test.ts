/**
 * S-51 (F-2, F-6, D-22, D-23, D-25): a pass that asks and reads ahead —
 * `latest()`, `isPending()` — runs on the screen as a sync pass does.
 *
 * `m` is an async memo over `id` and a read ahead of `id`; `setId(1)` is held
 * by an action, by another async reader of `id` (declared before `m` or
 * after it), or by nothing but `m` itself. Every row must show the same
 * three things:
 *
 * - the display: beside the screen's `id` (0), `m` answers the screen's
 *   question with the read ahead — `0/1`, `0/true` (F-6);
 * - the frame: `id` 1 never shows beside anything but the answer to the
 *   frame's question — `1/1`, `1/false` (F-1, F-2);
 * - the shape is not an input: the read ahead inline, before or after the
 *   plain read, extracted into a memo with the plain read or without it, or
 *   mixed with a plain read on either side (D-22: a window extracted into a
 *   memo reads as inline; D-25: either read order).
 *
 * The requests are pinned too. The frame's question is asked once: by the
 * pass that opens the hold (its flight is the one the landing adopts), or at
 * the landing when another hold was already up. The screen's question is
 * asked once beside it.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

const shapes = [
  "inline", // `${id()}/${ahead()}`
  "inlineAheadFirst", // the read ahead before the plain read
  "memo", // v = memo(`${id()}/${ahead()}`); m asks v()
  "memoOnly", // v = memo(ahead()); m asks v() — no plain read of id
  "plainPlusMemo", // `${id()}/${v()}`
  "memoPlusPlain" // v() read first
] as const;
const kinds = ["latest", "isPending"] as const;
const holds = ["action", "holderFirst", "holderLast", "self"] as const;

type Shape = (typeof shapes)[number];
type Kind = (typeof kinds)[number];
type Hold = (typeof holds)[number];

async function run(shape: Shape, kind: Kind, hold: Hold, sib: boolean, lifo: boolean) {
  const asks: string[] = [];
  const screen: { id?: number; m?: string } = {};
  const frames: string[] = [];
  const reqs: Array<() => void> = [];
  let go!: () => unknown;
  let done: () => void = () => {};
  const dispose = createRoot(dispose => {
    const [id, setId] = createSignal(0);
    const ahead = () => (kind === "latest" ? latest(id) : isPending(id));
    const holder = () => {
      const h = createMemo(() => (id() === 0 ? 0 : new Promise<number>(r => (done = () => r(1)))));
      createRenderEffect(h, () => {});
    };
    if (hold === "holderFirst") holder();
    const v =
      shape === "memo"
        ? createMemo(() => `${id()}/${ahead()}`)
        : shape === "memoOnly" || shape === "plainPlusMemo" || shape === "memoPlusPlain"
          ? createMemo(() => `${ahead()}`)
          : null;
    const m = createMemo(() => {
      let k: string;
      if (shape === "plainPlusMemo") k = `${id()}/${v!()}`;
      else if (shape === "memoPlusPlain") {
        const a = v!();
        k = `${id()}/${a}`;
      } else if (v) k = v();
      else if (shape === "inline") k = `${id()}/${ahead()}`;
      else {
        const a = ahead();
        k = `${id()}/${a}`;
      }
      asks.push(k);
      return new Promise<string>(r => reqs.push(() => r(k)));
    });
    createRenderEffect(id, v => void (screen.id = v));
    // A sync reader of the same read ahead beside it changes nothing.
    if (sib) createRenderEffect(ahead, () => {});
    createRenderEffect(m, v => void (screen.m = v));
    if (hold === "holderLast") holder();
    go =
      hold === "action"
        ? action(function* () {
            setId(1);
            yield new Promise<void>(r => (done = r));
          })
        : () => setId(1);
    return dispose;
  });
  const end =
    kind === "latest"
      ? shape === "memoOnly"
        ? "1"
        : "1/1"
      : shape === "memoOnly"
        ? "false"
        : "1/false";
  let torn = "";
  const snap = () => {
    const s = `${screen.id}|${screen.m}`;
    if (frames[frames.length - 1] !== s) frames.push(s);
    if (screen.id === 1 && screen.m !== end) torn = s;
  };
  const landAll = async () => {
    for (let n = 0; reqs.length && n < 10; n++) {
      (lifo ? reqs.pop()! : reqs.shift()!)();
      await tick();
      snap();
    }
  };
  flush();
  await landAll();
  asks.length = frames.length = 0;
  snap();
  go();
  flush();
  await tick();
  snap();
  await landAll();
  done();
  await tick();
  snap();
  await landAll();
  dispose();
  return { asks, frames, torn };
}

for (const shape of shapes)
  for (const kind of kinds)
    describe(`${shape}, ${kind}`, () => {
      const only = shape === "memoOnly";
      // The key `m` asks with: `${id}/${ahead}`, or the read ahead alone.
      const key = (id: number, a: number | boolean) => (only ? `${a}` : `${id}/${a}`);
      const start = key(0, kind === "latest" ? 0 : false),
        screens = key(0, kind === "latest" ? 1 : true),
        frame = key(1, kind === "latest" ? 1 : false);
      for (const hold of holds)
        for (const sib of [false, true])
          for (const lifo of [false, true])
            test(`${hold}${sib ? ", a sync reader beside it" : ""}${lifo ? ", answers in reverse" : ""}`, async () => {
              const r = await run(shape, kind, hold, sib, lifo);
              // F-1, F-2: the write never shows beside another question's answer.
              expect(r.torn).toBe("");
              // The display, then the frame. Self-held, the frame's answer
              // comes first unless the answers arrive in reverse: the hold
              // lands at once and the screen's question is moot. Without a
              // plain read of `id` nothing holds the write but `m`'s own
              // flight, and (`isPending`) nothing asks at all.
              const self = hold === "self";
              const shows = !(self && (only || !lifo));
              expect(r.frames).toEqual([
                `0|${start}`,
                ...(shows ? [`0|${screens}`] : []),
                `1|${frame}`
              ]);
              // The requests.
              let asks: string[];
              if (only) asks = kind === "latest" ? [frame] : self ? [] : [screens, frame];
              else if (hold === "holderLast" || self) {
                // `m`'s pass opened the hold (or ran before the holder's):
                // the frame's question first, adopted at the landing.
                asks = [frame, screens];
                // Today's cost (not ruled): a plain read mixed with the
                // extracted read ahead, run after another pass's pending
                // opened the hold, asks the screen's question a second time
                // — and never the frame's until the landing.
                if (!self && (shape === "plainPlusMemo" || shape === "memoPlusPlain"))
                  asks = [kind === "latest" ? screens : start, screens, frame];
              } else asks = [screens, frame];
              expect(r.asks).toEqual(asks);
            });
    });
