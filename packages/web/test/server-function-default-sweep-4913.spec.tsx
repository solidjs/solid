/**
 * @vitest-environment jsdom
 */
// #4913: a query whose fetcher calls a plain POST server function refetched
// forever after #4894. Every non-read call was a mutation, so its response
// reached the flight consumers, the router applied its default (revalidate
// every query) and the query that made the call refetched, which made the
// call again. A call is a mutation only when an action makes it: only then
// does the transport ask for the fold and deliver the default. Explicit
// metadata (X-Revalidate, a redirect) still reaches the consumers wherever the
// call was made, and a GET never asks.
import { afterEach, describe, expect, test } from "vitest";
import { action, createEffect, createMemo, createRoot, flush, refresh } from "solid-js";
import { GET, createServerReference } from "../server-functions/src/client.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  SINGLE_FLIGHT_HEADER,
  subscribeFlightData
} from "../server-functions/src/shared.js";
import { REVALIDATE_HEADER } from "../src/response.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("the default revalidation belongs to an action's calls (#4913)", () => {
  const originalFetch = globalThis.fetch;
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    globalThis.fetch = originalFetch;
  });

  // The server: answers every call with a plain value, recording what each
  // request asked for. `headers` are added to every answer.
  function server(headers: Record<string, string> = {}) {
    const asks: { method: string; flight: string | null }[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      asks.push({
        method: init?.method ?? "GET",
        flight: new Headers(init?.headers).get(SINGLE_FLIGHT_HEADER)
      });
      return new Response(JSON.stringify("post"), {
        headers: { [BODY_FORMAT_HEADER]: BodyFormat.Json, ...headers }
      });
    }) as typeof fetch;
    return asks;
  }

  // A router's consumer: no keys means revalidate every query.
  function router(queries: (() => unknown)[]) {
    const seen: (string | null)[] = [];
    cleanups.push(
      subscribeFlightData((_data, { response }) => {
        const keys = response.headers.get(REVALIDATE_HEADER);
        seen.push(keys);
        if (keys === null) for (const q of queries) refresh(q as any);
      })
    );
    return seen;
  }

  function query(fetcher: () => Promise<unknown>) {
    let post!: () => unknown;
    const values: unknown[] = [];
    cleanups.push(
      createRoot(dispose => {
        post = createMemo(fetcher);
        createEffect(post, v => {
          values.push(v);
        });
        return dispose;
      })
    );
    return { post, values };
  }

  for (const awaitsFirst of [false, true])
    test(`a query's own POST call gets no default sweep (${awaitsFirst ? "the fetcher awaits first" : "a sync fetcher"})`, async () => {
      const asks = server();
      const getPost = createServerReference("get-post-4913");
      const fetcher = awaitsFirst
        ? async () => {
            await Promise.resolve();
            return getPost("1");
          }
        : () => getPost("1");
      const queries: (() => unknown)[] = [];
      const seen = router(queries);
      const { post, values } = query(fetcher);
      queries.push(post);
      await tick();
      expect(values).toEqual(["post"]);
      expect(asks).toEqual([{ method: "POST", flight: null }]);
      expect(seen).toEqual([]);
    });

  test("a POST call an action makes after a yield is a mutation: it asks and sweeps", async () => {
    const asks = server();
    const save = createServerReference("save-4913");
    const queries: (() => unknown)[] = [];
    const seen = router(queries);
    const run = action(function* () {
      yield Promise.resolve();
      return yield save("x");
    });
    expect(await run()).toBe("post");
    expect(asks).toEqual([{ method: "POST", flight: "true" }]);
    expect(seen).toEqual([null]);
  });

  test("a GET call an action makes is a read: no ask, no sweep", async () => {
    const asks = server();
    const read = GET(createServerReference("read-4913"));
    const seen = router([]);
    const run = action(function* () {
      return yield read("1");
    });
    expect(await run()).toBe("post");
    expect(asks).toEqual([{ method: "GET", flight: null }]);
    expect(seen).toEqual([]);
  });

  test("explicit revalidation keys reach the consumers from a call outside an action", async () => {
    const asks = server({ [REVALIDATE_HEADER]: "posts" });
    const seen = router([]);
    const value = await createServerReference("lookup-4913")("1");
    // The keys are the caller's answer: delivered, nothing folded for them.
    expect(value).toBe("post");
    expect(asks).toEqual([{ method: "POST", flight: null }]);
    expect(seen).toEqual(["posts"]);
  });
});
