/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

import { expect, test } from "vitest";
import { createMemo, createRenderEffect, createSignal, flush, Loading, Show } from "solid-js";
import { Portal, render } from "../src/index.js";

// Manual clock: async memos resolve when the clock passes their due time, in
// due-time order, with a full settle between landings.
let now = 0;
let timers: { at: number; run: () => void }[] = [];
function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise<T>(r => timers.push({ at: now + ms, run: () => r(value) }));
}
async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}
async function advanceTo(t: number) {
  while (true) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > t) break;
    timers.shift();
    now = next.at;
    next.run();
    await settle();
  }
  now = t;
  await settle();
}

test("a nested render effect reading a downstream async value is not cleaned up mid-hold (#3404)", async () => {
  now = 0;
  timers = [];
  const root = document.createElement("div");
  const target = document.createElement("div");
  const log: string[] = [];
  let bump!: () => void;

  const dispose = render(
    () => (
      <Loading>
        {(() => {
          const [a, setA] = createSignal(1);
          bump = () => setA(x => x + 1);
          const b = createMemo(() => delay(500, a()));
          const c = createMemo(() => delay(1000, b()));

          createRenderEffect(
            () => {
              b();
              createRenderEffect(c, v => {
                log.push(`run ${v}@${now}`);
                return () => log.push(`cleanup ${v}@${now}`);
              });
            },
            () => {}
          );

          return (
            <Loading fallback="Loading...">
              <Show keyed when={b()}>
                <Portal mount={target}>
                  <div>{c()}</div>
                </Portal>
              </Show>
            </Loading>
          );
        })()}
      </Loading>
    ),
    root
  );

  await advanceTo(2000);
  expect(target.innerHTML).toBe("<div>1</div>");
  expect(log).toEqual(["run 1@1500"]);

  bump();
  flush();
  // b lands at 2500 while c is still in flight until 3500: the portal must
  // keep showing the previous frame until the whole update can reveal.
  await advanceTo(3000);
  expect(target.innerHTML).toBe("<div>1</div>");
  expect(log).toEqual(["run 1@1500"]);

  await advanceTo(4000);
  expect(target.innerHTML).toBe("<div>2</div>");
  expect(log).toEqual(["run 1@1500", "cleanup 1@3500", "run 2@3500"]);

  dispose();
});
