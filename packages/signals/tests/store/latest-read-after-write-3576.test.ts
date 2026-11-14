import { createStore, flush, latest } from "../../src/index.js";

// #3576: one `latest()` read of a projection key must not change what later
// untracked reads of it serve (an orphan override opened a transaction
// nobody started, and every later write in the tick was held by it). The
// pin is parity with and without the `latest()` read. What a read serves
// follows F-10: a write is visible from the flush that carries it.
function writeAndReadBack(withLatest: boolean, flushEach: boolean): number[] {
  const [store, setStore] = createStore(() => ({ value: 0 }), { value: 0 });
  flush();
  if (withLatest) latest(() => store.value);
  const reads = [store.value];
  for (let i = 1; i < 5; i++) {
    setStore(v => {
      v.value = i;
    });
    if (flushEach) flush();
    reads.push(store.value);
  }
  flush();
  reads.push(store.value);
  return reads;
}

// The current deep engine serves a projection's pending backing to an
// untracked read before the flush (an F-10 deviation, ruled 2026-11-13: F-10
// holds). The thin engine (spike) follows F-10.
((globalThis as any).THIN_STORE ? it : it.fails)(
  "unflushed writes stay invisible to untracked reads, with or without latest() (#3576, F-10)",
  () => {
    expect(writeAndReadBack(false, false)).toEqual([0, 0, 0, 0, 0, 4]);
    expect(writeAndReadBack(true, false)).toEqual([0, 0, 0, 0, 0, 4]);
  }
);

it("flushed writes show to untracked reads, with or without latest() (#3576)", () => {
  expect(writeAndReadBack(false, true)).toEqual([0, 1, 2, 3, 4, 4]);
  expect(writeAndReadBack(true, true)).toEqual([0, 1, 2, 3, 4, 4]);
});
