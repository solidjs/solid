/**
 * #5007 — a $TRACK-only reader must see optimistic structural guesses and
 * re-run on revert. Key / length / ownKeys / for…of / .map paths already
 * link the carrier via enumerationSource → optHooks.frame; $TRACK alone did
 * not after #4729.
 */
import { describe, expect, test } from "vitest";
import {
  $TRACK,
  action,
  createEffect,
  createOptimisticStore,
  createRoot,
  createStore,
  flush,
  untrack
} from "../src/index.js";

describe("#5007 $TRACK-only optimistic structural guesses", () => {
  test("push is visible under $TRACK and revert re-runs the effect", async () => {
    const [base] = createStore([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const seen: string[] = [];
    const setView = createRoot(() => {
      const [view, setView] = createOptimisticStore(base);
      createEffect(
        () => {
          void (view as any)[$TRACK];
          return untrack(() => view.map(r => r.id).join(""));
        },
        ids => void seen.push(ids)
      );
      return setView;
    });
    flush();

    const server = Promise.withResolvers<void>();
    const pending = action(function* () {
      setView(d => void d.push({ id: "n" }));
      yield server.promise;
    })().catch(() => "failed");
    flush();
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(["abc", "abcn"]);

    server.reject(new Error("boom"));
    await pending;
    flush();
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(["abc", "abcn", "abc"]);
  });

  test("field writes stay silent under $TRACK-only subscription", async () => {
    const [base] = createStore([{ id: "a", n: 0 }]);
    const seen: string[] = [];
    const setView = createRoot(() => {
      const [view, setView] = createOptimisticStore(base);
      createEffect(
        () => {
          void (view as any)[$TRACK];
          return untrack(() => view.map(r => `${r.id}:${r.n}`).join(","));
        },
        v => void seen.push(v)
      );
      return setView;
    });
    flush();
    expect(seen).toEqual(["a:0"]);

    const server = Promise.withResolvers<void>();
    const pending = action(function* () {
      setView(d => {
        d[0].n = 1;
      });
      yield server.promise;
    })();
    flush();
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(["a:0"]);

    server.resolve();
    await pending;
    flush();
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(["a:0"]);
  });
});
