/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * errored.spec's "no infinite loop when the source fails again after reset"
 * with the fallback's gate written as a ternary instead of `<Show>`: the
 * second error shows after the reset (the ternary's truthiness memo is a
 * verdict reader, read by its own binding).
 */
import { expect, test } from "vitest";
import { createMemo, Errored, flush, isPending, Loading, Show } from "solid-js";
import { render } from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}
const ticks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

for (const shape of ["Show", "ternary"] as const)
  test(`an Errored fallback shows the second error after a reset (${shape})`, async () => {
    const div = document.createElement("div");
    let current = deferred<string>();
    let resetFn!: () => void;
    const data = createMemo(async () => {
      await current.promise;
      return "ok";
    });
    const dispose = render(
      () => (
        <Loading fallback={<div>loading</div>}>
          <Errored
            fallback={(err, reset) => {
              resetFn = reset;
              return (
                <div>
                  <span>err:{String((err() as Error).message)}</span>
                  {shape === "Show" ? (
                    <Show when={isPending(data)}>
                      <span>resetting</span>
                    </Show>
                  ) : null}
                  {shape === "ternary" && isPending(data) ? <span>resetting</span> : undefined}
                </div>
              );
            }}
          >
            <div>{data()}</div>
          </Errored>
        </Loading>
      ),
      div
    );
    flush();
    expect(div.textContent).toBe("loading");
    current.reject(new Error("boom1"));
    await ticks();
    expect(div.textContent).toBe("err:boom1");
    current = deferred<string>();
    resetFn();
    flush();
    current.reject(new Error("boom2"));
    await ticks();
    await ticks();
    expect(div.textContent).toBe("err:boom2");
    dispose();
  });
