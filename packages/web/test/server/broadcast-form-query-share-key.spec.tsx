/**
 * A read whose query is not an `?args=` encoding reaches the function as a
 * lone URLSearchParams (parseArguments). A broadcast's share key ignores
 * that query, so two viewers of different queries share one source.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  broadcast,
  createServerReference,
  handleServerFunctionRequest,
  registerServerReference
} from "../../server-functions/src/server.js";
import { createJSONDeserializer } from "../../serialization/src/serializer-decode.js";

const RequestContext = Symbol.for("solid.RequestContext");
beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const tick = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

function tap(response: Response) {
  const values: any[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const decode = createJSONDeserializer();
  let buffer = "";
  let first = true;
  (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const lines = buffer.slice(0, end).split("\n");
        buffer = buffer.slice(end + 2);
        const data = lines
          .filter(l => l.startsWith("data: "))
          .map(l => l.slice(6))
          .join("\n");
        if (!data) continue;
        const decoded: any = decode(JSON.parse(data));
        if (first) {
          first = false;
          (async () => {
            for await (const v of decoded) values.push(v);
          })().catch(() => {});
        }
      }
    }
  })();
  return { values, cancel: () => reader.cancel() };
}

describe("broadcast share key and form-query reads", () => {
  it("viewers of different query parameters get their own source", async () => {
    broadcast(
      createServerReference(
        registerServerReference("broadcast-form-query-room", async (params: URLSearchParams) => {
          const room = params.get("room");
          return (async function* () {
            yield `room ${room}`;
            await new Promise(() => {});
          })();
        })
      )
    );
    const a = tap(
      await handleServerFunctionRequest(
        new Request("http://localhost/_server/live/broadcast-form-query-room?room=a", {
          method: "GET"
        })
      )
    );
    await tick();
    const b = tap(
      await handleServerFunctionRequest(
        new Request("http://localhost/_server/live/broadcast-form-query-room?room=b", {
          method: "GET"
        })
      )
    );
    await tick(30);
    expect(a.values).toEqual(["room a"]);
    expect(b.values).toEqual(["room b"]);
    a.cancel();
    b.cancel();
    await tick();
  });
  it("viewers of the same args share one source whatever else rides the query", async () => {
    let runs = 0;
    broadcast(
      createServerReference(
        registerServerReference("broadcast-form-query-args", async (room: string) => {
          const run = ++runs;
          return (async function* () {
            yield `room ${room} #${run}`;
            await new Promise(() => {});
          })();
        })
      )
    );
    const address = "http://localhost/_server/live/broadcast-form-query-args?args=%5B%22a%22%5D";
    const a = tap(await handleServerFunctionRequest(new Request(`${address}&x=1`)));
    await tick();
    const b = tap(await handleServerFunctionRequest(new Request(`${address}&x=2`)));
    await tick(30);
    expect(a.values).toEqual(["room a #1"]);
    expect(b.values).toEqual(["room a #1"]);
    a.cancel();
    b.cancel();
    await tick();
  });
});
