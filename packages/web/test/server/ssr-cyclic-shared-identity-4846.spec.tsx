/**
 * #4846: a cycle in a shallow derived store must not break the identity of a
 * value that store also shares with another async source. The bug was in
 * `rewriteTree`'s cycle fallback: it always cloned, so the store's copy of the
 * shared object was a different reference than the memo's record and hydration
 * could not dedupe them.
 */
import { describe, expect, test } from "vitest";
import { createMemo, createStore, Loading } from "solid-js";
import { createContext, runInContext } from "node:vm";
import { pipeSettle } from "./stream-settle-harness.js";

async function serializeShared(cyclic: boolean) {
  const { state: streamState, html } = await pipeSettle(() => {
    const key = createMemo(async () => ({ id: 1 }));
    const [state] = createStore(
      async draft => {
        draft.key = key();
        const value: any = {};
        if (cyclic) value.self = value;
        draft.value = value;
      },
      { key: undefined, value: undefined },
      { shallow: true, deferStream: true }
    );
    return Loading({
      fallback: "loading",
      get children() {
        return `server identity: ${state.key === key()}`;
      }
    });
  });
  expect(streamState).toBe("settled");

  const client = createContext({ _$HY: { r: {} } });
  (client as any).self = client;
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    runInContext(script, client);
  }
  const key = await (client as any)._$HY.r["0"];
  const state = await (client as any)._$HY.r["1"];
  return {
    serverIdentity: html.includes("server identity: true"),
    serializedIdentity: state.key === key,
    cyclePreserved: !cyclic || state.value.self === state.value
  };
}

describe("#4846 shared identity beside a serialized cycle", () => {
  test("without a cycle, the shared key stays one object across records", async () => {
    const r = await serializeShared(false);
    expect(r).toEqual({
      serverIdentity: true,
      serializedIdentity: true,
      cyclePreserved: true
    });
  });

  test("with a cycle, the shared key still stays one object across records", async () => {
    const r = await serializeShared(true);
    expect(r).toEqual({
      serverIdentity: true,
      serializedIdentity: true,
      cyclePreserved: true
    });
  });
});
