// Plain-signal identities (deferred hydration's dependency edges). While on,
// a plain signal created under an id-bearing owner is named `<id>~<n>`, n
// counting the plain signals created under the nearest id-bearing owner;
// the count restarts when the owner re-runs, as child ids do. The pre-write
// hook receives the named node (none for a store or a derived signal), and the dev
// read watch sees it on every read.
import { afterEach, describe, expect, test } from "vitest";
import { setReadWatch, setSignalIdentities, setWriteHook, signalName } from "../src/core/index.js";
import { createMemo, createRoot, createSignal, createStore, flush } from "../src/index.js";

afterEach(() => {
  setWriteHook(null);
  setReadWatch(null);
  setSignalIdentities(false);
});

function hookedWrites() {
  const writes: (string | undefined)[] = [];
  setWriteHook(node => writes.push(signalName(node)));
  return writes;
}

describe("plain-signal identities", () => {
  test("named per id-bearing owner, in creation order; the hook receives the named node", () => {
    setSignalIdentities(true);
    const writes = hookedWrites();
    const [setA, setB, setD, setS] = createRoot(
      () =>
        [
          createSignal(0)[1],
          createSignal(0)[1],
          createSignal(() => 1)[1],
          createStore({ n: 0 })[1]
        ] as const,
      { id: "r" }
    );
    setA(1);
    setB(1);
    setD(2);
    setS(s => void (s.n = 1));
    // The derived signal and the store write carry no name.
    expect(writes).toEqual(["r~0", "r~1", undefined, undefined]);
  });

  test("the count restarts when the owner re-runs", () => {
    setSignalIdentities(true);
    const writes = hookedWrites();
    let set: ((v: number) => void) | undefined;
    const [n, setN] = createSignal(0);
    createRoot(
      () => {
        createMemo(() => {
          n();
          [, set] = createSignal(0);
        });
      },
      { id: "m" }
    );
    flush();
    set!(1);
    setN(1);
    flush();
    set!(2);
    // The signal the second pass made has the first one's name.
    const named = writes.filter(w => w !== undefined);
    expect(named.length).toBe(2);
    expect(named[0]).toBe(named[1]);
  });

  test("off: no names; signals outside an id-bearing owner are never named", () => {
    const writes = hookedWrites();
    const set = createRoot(() => createSignal(0)[1], { id: "off" });
    set(1);
    setSignalIdentities(true);
    const [, outside] = createSignal(0);
    outside(1);
    expect(writes).toEqual([undefined, undefined]);
  });

  test("dev: the read watch sees named reads", () => {
    setSignalIdentities(true);
    const reads: string[] = [];
    createRoot(
      () => {
        const [a] = createSignal(0);
        setReadWatch(node => {
          const sid = signalName(node);
          if (sid !== undefined) reads.push(sid);
        });
        a();
        setReadWatch(null);
        a();
      },
      { id: "w" }
    );
    expect(reads).toEqual(["w~0"]);
  });
});
