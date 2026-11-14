// #4846: an object an async memo answers with and a shallow derived store
// holds is one object on the server, and must be one in the hydration data.
// When the store's value also held a cycle, the serialization-border walk
// (`rewriteTree`) fell back to cloning the whole graph, though it replaced
// nothing: the store's record carried a copy of the memo's answer, and the
// client decoded two objects. The clone pass is copy-on-write now.
import { describe, expect, test } from "vitest";
import { createMemo, createStore, Loading } from "solid-js";
import { renderToStream } from "@solidjs/web";
import { createContext, runInContext } from "node:vm";

async function decode(cyclic: boolean) {
  const html: string = await (renderToStream(() => {
    const key = createMemo(async () => ({ id: 1 }));
    const [state] = createStore<any>(
      async (draft: any) => {
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
  }) as any);
  const client: any = createContext({ _$HY: { r: {} } });
  client.self = client;
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))
    runInContext(script, client);
  const key = await client._$HY.r["0"];
  const state = await client._$HY.r["1"];
  return {
    serverIdentity: html.includes("server identity: true"),
    serializedIdentity: state.key === key,
    cyclePreserved: !cyclic || state.value.self === state.value
  };
}

describe("#4846 a cycle in a store does not split a reference it shares with another record", () => {
  test.each([false, true])("cyclic: %s", async cyclic => {
    expect(await decode(cyclic)).toEqual({
      serverIdentity: true,
      serializedIdentity: true,
      cyclePreserved: true
    });
  });
});
