// When a frame's cleanups run, for an async memo (#4222). A frame's resources
// live until something replaces it on screen: a run that never committed is
// cleaned up when it's superseded, the committed run when its replacement
// publishes an answer — a value, or an error.
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  onCleanup
} from "../src/index.js";

type Gate = { resolve(v: string): void; reject(e: unknown): void };

function setup() {
  const log: string[] = [];
  const gates: Record<string, Gate> = {};
  const [q, setQ] = createSignal("a");
  createRoot(() => {
    const m = createMemo(async () => {
      const v = q();
      log.push("start " + v);
      onCleanup(() => log.push("cleanup " + v));
      createMemo(() => onCleanup(() => log.push("child " + v)));
      return await new Promise<string>((resolve, reject) => (gates[v] = { resolve, reject }));
    });
    createEffect(m, {
      effect: v => {
        log.push("show " + v);
      },
      error: e => {
        log.push("error " + (e as Error).message);
      }
    });
  });
  flush();
  return { log, gates, setQ };
}

const settle = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

it("a run that never committed is cleaned up when superseded; the committed one when the replacement lands", async () => {
  const { log, gates, setQ } = setup();
  gates.a.resolve("A");
  await settle();
  setQ("b");
  flush();
  setQ("c");
  flush();
  expect(log).toEqual(["start a", "show A", "start b", "child b", "cleanup b", "start c"]);
  log.length = 0;
  gates.c.resolve("C");
  await settle();
  expect(log).toEqual(["child a", "cleanup a", "show C"]);
});

it("a rejected replacement retires the frame it replaces", async () => {
  const { log, gates, setQ } = setup();
  gates.a.resolve("A");
  await settle();
  setQ("b");
  flush();
  log.length = 0;
  gates.b.reject(new Error("B"));
  await settle();
  // The error replaces the shown frame, as a value would: the old frame's
  // cleanups don't wait for a later success.
  expect(log).toEqual(["child a", "cleanup a", "error B"]);
  log.length = 0;
  setQ("c");
  flush();
  // The errored run never committed a value, so it goes before c's body,
  // like any uncommitted run.
  expect(log).toEqual(["child b", "cleanup b", "start c"]);
  log.length = 0;
  gates.c.resolve("C");
  await settle();
  expect(log).toEqual(["show C"]);
});
