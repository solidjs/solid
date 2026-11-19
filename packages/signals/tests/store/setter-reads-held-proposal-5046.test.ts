/**
 * #5046 — a setter that copies another update's held proposal out of its
 * draft entangles with that update.
 *
 * The draft shows a held key's proposal (F-1: a store setter's draft is the
 * writer's composition channel). A setter that reads it and writes it to
 * another key derives from the held write, so its tick joins that hold, the
 * same way a guess written after reading another hold's guess does (D-33,
 * #4788). Otherwise the copy reveals the held value before its source:
 * `score 0, copy 1`. A setter that does not read the held key still
 * publishes on its own tick (D-8).
 */
import { describe, expect, it } from "vitest";
import { action, createRenderEffect, createRoot, createStore, flush } from "../../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
};

function setup() {
  const [state, setState] = createStore({ score: 0, copy: 0 });
  const seen: string[] = [];
  const dispose = createRoot(d => {
    createRenderEffect(
      () => `${state.score}/${state.copy}`,
      v => void seen.push(v)
    );
    return d;
  });
  flush();
  const gate = deferred();
  const update = action(function* () {
    setState(d => {
      d.score += 1;
    });
    yield gate.promise;
  });
  return { state, setState, seen, dispose, gate, update };
}

describe("#5046 a setter that reads a held proposal", () => {
  it("copying the held value waits for the hold", async () => {
    const { setState, seen, dispose, gate, update } = setup();
    update();
    await settle();
    setState(d => {
      d.copy = d.score;
    });
    await settle();
    expect(seen).toEqual(["0/0"]);
    gate.resolve();
    await settle();
    expect(seen).toEqual(["0/0", "1/1"]);
    dispose();
  });

  it("a setter that does not read the held key publishes on its own", async () => {
    const { setState, seen, dispose, gate, update } = setup();
    update();
    await settle();
    setState(d => {
      d.copy = 5;
    });
    await settle();
    expect(seen).toEqual(["0/0", "0/5"]);
    gate.resolve();
    await settle();
    expect(seen).toEqual(["0/0", "0/5", "1/5"]);
    dispose();
  });
});
