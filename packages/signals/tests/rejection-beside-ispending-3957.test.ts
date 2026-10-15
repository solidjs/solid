// #3957: an async memo's rejection reaches Errored whether or not a separate
// render effect probes isPending of it (a probe alone holds nothing, F-6).
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

for (const withProbe of [false, true])
  it(`a rejection reaches Errored ${withProbe ? "with" : "without"} a separate isPending reader (#3957)`, async () => {
    let start!: (v: boolean) => void, reject!: (e: unknown) => void;
    let screen: unknown,
      text: unknown,
      fallbackCalls = 0;
    createRoot(() => {
      const [running, setRunning] = createSignal(false);
      start = setRunning;
      const data = createMemo<any>(() =>
        running()
          ? {
              [Symbol.asyncIterator]() {
                return {
                  next: () =>
                    new Promise((_, fail) => {
                      reject = fail;
                    }),
                  return: async () => ({ done: true })
                };
              }
            }
          : []
      );
      const b = createErrorBoundary(
        () => {
          createRenderEffect(
            () => latest(data).length,
            v => {
              text = v;
            }
          );
          if (withProbe)
            createRenderEffect(
              () => isPending(data),
              () => {}
            );
          return "content";
        },
        e => {
          fallbackCalls++;
          return "ERROR: " + (e() as Error).message;
        }
      );
      createRenderEffect(b, v => {
        screen = v;
      });
    });
    flush();
    start(true);
    flush();
    reject(new Error("Search failed"));
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect([screen, fallbackCalls]).toEqual(["ERROR: Search failed", 1]);
  });
