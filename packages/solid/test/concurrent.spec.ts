import {
  createRoot,
  createSignal,
  useTransition,
  createMemo,
  createRenderEffect,
  createResource,
  createComputed
} from "../src";

describe("concurrent transitions", () => {
  test("compounding memos", done => {
    function delay(num: number) {
      return () => new Promise<number>(res => setTimeout(() => res(num / 2), 500));
    }
    let count = 0;
    createRoot(() => {
      const [, start] = useTransition(),
        [s, set] = createSignal(0),
        [r, load] = createResource(0),
        d = createMemo((p: number = 0) => s() * p + 1);
      createComputed(() => s() && load(delay(s())));
      setTimeout(() => start(() => set(2)), 200);
      setTimeout(() => set(4), 400);
      createRenderEffect(() => {
        if (++count === 1) {
          expect(d()).toBe(1);
          expect(r()).toBe(0);
        }
        if (count === 2) {
          expect(d()).toBe(5);
          expect(r()).toBe(0);
        }
        if (count === 3) {
          expect(d()).toBe(13);
          expect(r()).toBe(2);
          done();
        }
      });
    });
  });
});
