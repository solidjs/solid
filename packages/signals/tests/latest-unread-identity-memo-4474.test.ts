/**
 * #4474: laziness is never observable (D-22, ruled 2026-10-30; #3078, #4366).
 *
 * An async memo `m` and an identity memo `id = createMemo(() => m())`. Nothing reads `id`. `m`'s
 * first answer (2) lands in its own flush. A write then re-asks `m` and, in the same flush, mounts
 * content that reads `latest(id)` and `isPending(id)`. Before, the unread `id` was released at the
 * landing without re-running (#2934) and woke in the mount with no value: `latest(id)` returned
 * `undefined` beside `isPending(id) === true`.
 *
 * Ruled and built: a memo nobody has read has still produced what the flushes it missed would have given it.
 * The verdict read catches `id` up on the committed world (2), then it waits on the re-ask like any
 * dependent: `l:2 p:true`, then `l:3 p:false` at the landing. The screen is the same program's with
 * an unrelated prior reader of `id` (a user effect, which holds nothing). A plain `id()` in the
 * same mount is not display-ahead (D-27): its reader is born held (D-2) and shows at 3.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const task = () => new Promise<void>(r => setTimeout(r, 0));

type Shape = "outside the root" | "in a root" | "an identity of an identity";
type Plain = "none" | "before" | "after";

async function run(shape: Shape, plain: Plain, prior: boolean) {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const [s, setS] = createSignal(1);
  let id!: () => number;
  const make = () => {
    const m = createMemo(() => {
      const v = 1 + s();
      return new Promise<number>(resolve => asks.push({ v, resolve }));
    });
    const inner = createMemo(() => m());
    id = shape === "an identity of an identity" ? createMemo(() => inner()) : inner;
  };
  if (shape === "in a root") createRoot(make);
  else make();
  if (prior)
    createRoot(() =>
      createEffect(
        () => id(),
        () => {}
      )
    );
  const leaves: string[] = [];
  const plains: string[] = [];
  const plainRead = () =>
    createRenderEffect(
      () => `p:${id()}`,
      v => void plains.push(v)
    );
  createRoot(() => {
    const b = createLoadingBoundary(
      () => {
        const gate = createMemo(() => s() > 1);
        return createMemo(() => {
          if (!gate()) return "off";
          if (plain === "before") plainRead();
          createRenderEffect(
            () => `l:${latest(id)} p:${isPending(id)}`,
            v => void leaves.push(v)
          );
          if (plain === "after") plainRead();
          return "on";
        });
      },
      () => "fallback"
    );
    createRenderEffect(
      () => {
        let v: any = b;
        while (typeof v === "function") v = v();
        return v;
      },
      () => {}
    );
  });
  flush();
  await task();
  flush();
  const first = asks.shift()!;
  first.resolve(first.v);
  await task();
  flush(); // m's answer (2) lands on its own
  setS(2);
  await task();
  flush(); // re-ask m and mount the content
  const reasked = { leaves: [...leaves], plains: [...plains] };
  const second = asks.shift()!;
  second.resolve(second.v);
  await task();
  flush();
  return { reasked, landed: { leaves, plains } };
}

describe("#4474: latest() of an unread memo is what the flushes it missed gave it", () => {
  for (const shape of ["outside the root", "in a root", "an identity of an identity"] as const)
    for (const plain of ["none", "before", "after"] as const)
      // Built (D-22, `wake` in core.ts): the released memo's wake pass computes on the committed
      // world and then waits on the re-ask, in every read order. (A memo in a root is never
      // released: it re-runs at the landing — the control the released one must match.)
      it(`${shape}, plain read ${plain}: l:2 p:true, then l:3 p:false — as with a prior reader`, async () => {
        const screen = await run(shape, plain, false);
        expect(screen.reasked.leaves).toEqual(["l:2 p:true"]);
        expect(screen.landed.leaves).toEqual(["l:2 p:true", "l:3 p:false"]);
        expect(screen.reasked.plains).toEqual([]);
        expect(screen.landed.plains).toEqual(plain === "none" ? [] : ["p:3"]);
        expect(screen).toEqual(await run(shape, plain, true));
      });
});
