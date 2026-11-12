/**
 * #4793 follow-up (GabbeV): two guesses on one array that change its keys or
 * length write the list itself — the slot the other structural guess writes
 * (D-33: the list is the slot when its keys or length changed) — so they
 * entangle, and the survivor's frame holds the list until both settle. The
 * #4784 fall-through to a lending guess is for index writes that change no
 * keys and no length; applied here it served the truth's length (0) beside
 * the frame's rows when the lender ended.
 */
import { expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("two structural guesses on one array hold the list until both settle (D-33)", async () => {
  const ends: Record<string, () => void> = {};
  const wait = (k: string) => new Promise<void>(r => (ends[k] = r));
  const seen: string[] = [];
  let A!: () => any, B!: () => any;
  createRoot(() => {
    const [items, guess] = createOptimisticStore<number[]>([]);
    createRenderEffect(
      () => `len=${items.length} i0=${items[0]} arr=${JSON.stringify(Array.from(items))}`,
      v => void seen.push(v)
    );
    B = action(function* () {
      guess(d => {
        d[1] = 2;
      });
      yield wait("B");
    });
    A = action(function* () {
      guess(d => {
        d[0] = 1;
      });
      yield wait("A");
    });
  });
  flush();
  B();
  await tick();
  A();
  await tick();
  expect(seen.at(-1)).toBe("len=2 i0=1 arr=[1,2]");
  ends.B();
  await tick();
  expect(seen.at(-1)).toBe("len=2 i0=1 arr=[1,2]");
  ends.A();
  await tick();
  expect(seen.at(-1)).toBe("len=0 i0=undefined arr=[]");
});
