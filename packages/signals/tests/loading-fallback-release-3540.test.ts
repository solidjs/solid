/**
 * #3540 — the no-`on` analogue of `loading-on-rearm-reveal-3540.test.ts`.
 *
 * A boundary whose fallback reads a pending async source makes its output
 * pass pending on that source; an initialized ancestor holds its last frame.
 * When the boundary's content lands, the boundary is ready — but its output
 * pass derives from `_disabled`, not the tree, so only a sweep re-runs it,
 * and the commit sweep runs after the verdict that the output's own pending
 * keeps parking: the content waited for the fallback's flight. The boundary
 * is judged before the verdict instead (`_judgeHeld`): the output re-runs,
 * reads the tree, drops the fallback's read, and the ancestor reveals the
 * content NOW. It has nothing to do with re-arming; the second test is the
 * general form — a plain computed dropping a pending source — which always
 * released.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const microtask = () => Promise.resolve();

test("a fresh inner boundary with a pending fallback, mounted under an initialized outer, reveals when its content lands", async () => {
  const [show, setShow] = createSignal(false);
  const [asked, setAsked] = createSignal(0);
  const outer = { value: undefined as unknown, log: [] as unknown[] };
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const data = createMemo(async () => {
      const v = asked();
      await sleep(1000);
      return v;
    });
    const fallbackData = createMemo(async () => {
      const v = asked();
      await sleep(3000);
      return `loading ${v}`;
    });
    const innerMemo = createMemo(() =>
      show()
        ? createLoadingBoundary(
            () => `data ${data()}`,
            () => fallbackData()
          )
        : null
    );
    createRenderEffect(
      untrack(() =>
        createLoadingBoundary(
          () => {
            const b = innerMemo();
            return b ? b() : "nothing";
          },
          () => "OUTER FALLBACK"
        )
      ),
      v => {
        outer.value = v;
        outer.log.push(v);
      }
    );
  });
  flush();
  await vi.advanceTimersByTimeAsync(3000);
  flush();
  expect(outer.value).toBe("nothing");

  setAsked(1);
  flush();
  await microtask();
  flush();
  setShow(true);
  flush();
  await microtask();
  flush();
  // The inner fallback is pending; the initialized outer holds "nothing".
  expect(outer.value).toBe("nothing");

  // +1000ms: `data` lands, `fallbackData` still has 2000ms to go. The inner
  // output pass now reads the tree — the outer must reveal it at once.
  await vi.advanceTimersByTimeAsync(1000);
  flush();
  expect(outer.value).toBe("data 1");
  expect(outer.log).toEqual(["nothing", "data 1"]);
  dispose();
});

test("an initialized boundary whose content switches from a pending source to another reveals when the new one lands", async () => {
  const [flag, setFlag] = createSignal(true);
  const [asked, setAsked] = createSignal(0);
  const out = { value: undefined as unknown, log: [] as unknown[] };
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const a = createMemo(async () => {
      const v = asked();
      await sleep(1000);
      return `a ${v}`;
    });
    const b = createMemo(async () => {
      const v = asked();
      await sleep(3000);
      return `b ${v}`;
    });
    createRenderEffect(
      untrack(() =>
        createLoadingBoundary(
          () => (flag() ? b() : a()),
          () => "FALLBACK"
        )
      ),
      v => {
        out.value = v;
        out.log.push(v);
      }
    );
  });
  flush();
  await vi.advanceTimersByTimeAsync(3000);
  flush();
  expect(out.value).toBe("b 0");

  setAsked(1);
  flush();
  await microtask();
  flush();
  expect(out.value).toBe("b 0"); // held on b
  setFlag(false);
  flush();
  await microtask();
  flush();
  expect(out.value).toBe("b 0"); // still held, now on a

  await vi.advanceTimersByTimeAsync(1000);
  flush();
  expect(out.value).toBe("a 1");
  expect(out.log).toEqual(["FALLBACK", "b 0", "a 1"]);
  dispose();
});
