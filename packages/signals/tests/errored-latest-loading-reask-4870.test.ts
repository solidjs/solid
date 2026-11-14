// #4870: a failed async memo under an error boundary, read directly (a
// `<Show>` condition) and, under a loading boundary beside it, through
// `latest()`. Once it failed it was re-asked on every flush: its retry made
// the `latest()` reader pending, the loading boundary (re-armed behind the
// error fallback, #4634) caught it, the rejection revealed it again, and the
// reveal re-derived the error boundary's content, whose re-read retried the
// memo. Behind an error fallback, a reader that answered with an error keeps
// the loading boundary's fallback: nothing to reveal, the error shows above.
// The DOM version is packages/web/test/errored-latest-loading-reask-4870.spec.tsx.
import { expect, test } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  flush,
  latest
} from "../src/index.js";

const wait = async (ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, 1));
    flush();
  }
};

for (const sync of [false, true])
  test(`#4870 a failed memo beside latest() under a loading boundary is not re-asked forever${sync ? " (rejects at once)" : ""}`, async () => {
    let requests = 0;
    let answer: ((v: string) => void) | null = null;
    let recover = false;
    const fetchUser = () => {
      requests++;
      if (recover) return new Promise<string>(r => (answer = r));
      if (requests > 50) return new Promise<string>(() => {});
      return sync
        ? Promise.reject(new Error("404"))
        : new Promise<string>((_, reject) => setTimeout(() => reject(new Error("404")), 10));
    };
    let shown: any;
    let text: any;
    let reset!: () => void;
    const dispose = createRoot(dispose => {
      const user = createMemo(() => fetchUser());
      const view = createErrorBoundary(
        () => {
          const cond = createMemo(() => user() === "admin");
          const show = createMemo(() => (cond() ? "admin" : null));
          const inner = createLoadingBoundary(
            () => {
              createRenderEffect(
                () => latest(user),
                v => void (text = v)
              );
              return "content";
            },
            () => "loading"
          );
          return [show, inner];
        },
        (_, r) => ((reset = r), "error")
      );
      createRenderEffect(
        () => {
          const v = view();
          return Array.isArray(v) ? v.join("|") : v;
        },
        v =>
          void ((shown = v),
          (globalThis as any).process.stderr.write("SHOWN " + v + " req=" + requests + "\n"))
      );
      return dispose;
    });
    flush();
    await wait(100);
    const at100 = requests;
    await wait(200);
    expect(shown).toBe("error");
    expect(requests).toBe(at100);
    expect(requests).toBeLessThanOrEqual(2);
    // The boundary is reset and the retry answers: the error stays until the
    // answer (a pending is not a value, D-41), then the content shows it.
    recover = true;
    reset();
    await wait(20);
    expect(requests).toBe(at100 + 1);
    expect(shown).toBe("error");
    answer!("admin");
    await wait(20);
    expect(shown).toBe("admin|content");
    expect(text).toBe("admin");
    expect(requests).toBe(at100 + 1);
    dispose();
  });

// An error caught by a boundary inside the loading boundary is that
// boundary's content, not the outer fallback's: when the outer error
// recovers, the inner error fallback shows with it, never the loading
// fallback between.
test("#4870 an error caught inside the loading boundary shows with the outer recovery", async () => {
  const tick = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 0));
      flush();
    }
  };
  let failA = true;
  let answerA!: (v: string) => void;
  const log: string[] = [];
  let reset!: () => void;
  const dispose = createRoot(dispose => {
    const a = createMemo(() =>
      failA ? Promise.reject(new Error("a")) : new Promise<string>(r => (answerA = r))
    );
    const x = createMemo(() => new Promise((_, rej) => setTimeout(() => rej(new Error("x")), 5)));
    const view = createErrorBoundary(
      () => {
        const ra = createMemo(() => a());
        const inner = createLoadingBoundary(
          () =>
            createErrorBoundary(
              () => {
                createRenderEffect(
                  () => latest(x),
                  () => {}
                );
                return "x";
              },
              () => "x-error"
            ),
          () => "loading"
        );
        return [ra, inner];
      },
      (_, r) => ((reset = r), "error")
    );
    createRenderEffect(
      () => {
        const v = view();
        return Array.isArray(v) ? v.join("|") : (v as string);
      },
      v => void log.push(v)
    );
    return dispose;
  });
  flush();
  await wait(30);
  expect(log.at(-1)).toBe("error");
  failA = false;
  reset();
  await tick();
  answerA("A");
  await tick();
  expect(log.slice(log.lastIndexOf("error") + 1)).toEqual(["A|x-error"]);
  dispose();
});
