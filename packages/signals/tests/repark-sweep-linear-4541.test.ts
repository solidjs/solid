import { expect, it } from "vitest";
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

// #4541 review: the re-park sweep asks, per carried source, whether a
// dependency still reaches it (`retryReaches`, a walk of the deps). A reader
// of S async sources that all went pending re-parks on every write while
// carrying all S; asking for each one walks its D deps — S×D per write. A
// source that is still pending has not landed, so its own settle walk is
// still to come: the sweep leaves it alone without asking. Counted as
// `Set#has` calls during the writes (deterministic).
it("#4541: a re-park carrying many still-pending sources sweeps them without walking deps per source", () => {
  const S = 300;
  const K = 20;
  const [v, setV] = createSignal(0);
  const [off, setOff] = createSignal(0);
  const dispose = createRoot(d => {
    const sources = Array.from({ length: S }, (_, i) =>
      createMemo(() => (v() === 0 ? i : new Promise<number>(() => {})))
    );
    const sum = createMemo(() => {
      const o = off();
      let s = 0;
      for (let k = 0; k < S; k++) s += sources[(o + k) % S]();
      return s;
    });
    createRenderEffect(sum, () => {});
    return d;
  });
  flush();
  setV(1);
  flush();
  const proto = Set.prototype as any;
  const has = proto.has;
  let steps = 0;
  proto.has = function (this: Set<unknown>, x: unknown) {
    steps++;
    return has.call(this, x);
  };
  try {
    for (let k = 1; k <= K; k++) {
      setOff(k);
      flush();
    }
  } finally {
    proto.has = has;
  }
  expect(steps).toBeLessThan(4 * K * S);
  dispose();
});
