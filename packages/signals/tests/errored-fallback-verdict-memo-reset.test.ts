/**
 * An Errored fallback whose gate is a memo that reads `isPending` directly —
 * `{isPending(data) ? <span>resetting</span> : undefined}` compiles to one —
 * read by its own render effect. A reset re-asks `data`, which has no answer
 * (its first load errored), so the probe goes pending and the pending reaches
 * the effect through the memo. When the re-ask errors again, the memo is a
 * verdict reader and re-derives (`isPending` of an errored source is false,
 * the value it had), and only its own entry was retired: the effect stayed
 * pending on `data` and held the frame, so the fallback kept the first
 * error's text for good. `<Show>`'s extra hop hid it. F-2's frame waits only
 * on what is still pending; liveness.
 */
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  flush,
  isPending
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}
const sync = { sync: true } as const;
const binding = { transparent: true, sync: true } as const;
const ticks = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
};

for (const shape of ["<Show>", "truthiness memo", "one memo", "no gate"] as const)
  it(`an Errored fallback shows the second error after a reset (${shape})`, async () => {
    let current = deferred<string>();
    let reset!: () => void;
    const data = createMemo(async () => {
      await current.promise;
      return "ok";
    });
    let screen: { toString(): string } | string = "";
    const dispose = createRoot(d => {
      const out = createLoadingBoundary(
        () =>
          createErrorBoundary(
            () => () => data(),
            (err, r) => {
              reset = r;
              const el = {
                msg: "",
                gate: "" as unknown,
                toString: () => `${el.msg}${el.gate ?? ""}`
              };
              createRenderEffect(
                () => `err:${(err() as Error).message}`,
                v => void (el.msg = v),
                binding
              );
              if (shape === "no gate") return el;
              let gate: () => unknown;
              if (shape === "truthiness memo") {
                const c = createMemo(() => !!isPending(data), sync);
                gate = () => (c() ? "resetting" : undefined);
              } else if (shape === "one memo") {
                gate = createMemo(() => (isPending(data) ? "resetting" : undefined), sync);
              } else {
                const value = createMemo(() => isPending(data));
                const c = createMemo(value, { equals: (a, b) => !a === !b, sync: true });
                gate = createMemo(() => (c() ? "resetting" : undefined), sync);
              }
              createRenderEffect(
                () => gate(),
                v => void (el.gate = v),
                binding
              );
              return el;
            }
          ),
        () => "loading"
      );
      createRenderEffect(
        () => {
          let v: unknown = out();
          while (typeof v === "function") v = v();
          return v as typeof screen;
        },
        v => void (screen = v),
        binding
      );
      return d;
    });
    try {
      flush();
      expect(String(screen)).toBe("loading");
      current.reject(new Error("boom1"));
      await ticks();
      expect(String(screen)).toBe("err:boom1");
      current = deferred<string>();
      reset();
      flush();
      current.reject(new Error("boom2"));
      await ticks();
      expect(String(screen)).toBe("err:boom2");
    } finally {
      dispose();
    }
  });
