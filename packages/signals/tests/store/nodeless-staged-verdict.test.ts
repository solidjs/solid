import { afterEach, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest,
  resetErrorHalt,
  untrack
} from "../../src/index.js";

afterEach(() => {
  resetErrorHalt();
  flush();
});

for (const reader of ["render", "memo"] as const) {
  for (const tracked of [false, true]) {
    it(`${reader}: latest beside a ${tracked ? "tracked" : "node-less untracked"} store read settles and keeps updating`, async () => {
      const requests = [Promise.withResolvers<number>(), Promise.withResolvers<number>()];
      let screen: number[] = [];
      const app = createRoot(dispose => {
        const [step, setStep] = createSignal(0);
        const [state, setState] = createStore({ count: 0 });
        const data = createMemo(() => {
          const current = step();
          return current === 0 ? current : requests[current - 1].promise;
        });
        // An untracked first read leaves the store without a container node.
        const read = () => [latest(data), tracked ? state.count : untrack(() => state.count)];
        const value = reader === "memo" ? createMemo(read) : read;
        createRenderEffect(value, result => {
          screen = result;
        });
        return { dispose, setStep, setState };
      });

      try {
        flush();
        expect(screen).toEqual([0, 0]);
        for (const current of [1, 2]) {
          app.setStep(current);
          app.setState(draft => {
            draft.count = current;
          });
          // Before the fix, stagedScreen forwards an absent signal to
          // holdStaging and this flush throws while dereferencing its _x.
          expect(() => flush()).not.toThrow();
          requests[current - 1].resolve(current);
          await requests[current - 1].promise;
          flush();
          expect(screen).toEqual([current, current]);
        }
      } finally {
        app.dispose();
      }
    });
  }
}
