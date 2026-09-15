/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The client's records on `OBSERVE.records` (sentry-integration-plan C4,
// client half): the `"call"` record — one server-function call made from
// the browser, as the caller awaited it — and the client side of the
// `"frame"` record — one frame stream applied by `applyFrameResponse`.
// Each is the twin of a server record (`"invocation"`, the frame's server
// half) and joins it by `id`; the difference is the wire.
//
// Pinned against the real client runtime with a stubbed fetch and
// hand-framed responses (the same seam the frames client specs use):
//
//  - a call: id, method, status, timing, the settled result beside it;
//  - a call that failed: the error AS THROWN to the caller, the status when
//    a response arrived and none when the fetch itself rejected;
//  - a stream applied: the census as the wire had it, the consumer's remap
//    (`as`) and restamp (`version`) on the record, the wire id kept;
//  - a body that ended before `complete`: `truncated`; a read that failed:
//    `error` with the failure beside it; several streams in one response:
//    one record each;
//  - a listener cannot break the call or the stream; without one nothing is
//    read.
//
// The channel is the core's, reached by its registered symbol (this runtime
// imports no framework): `OBSERVE.records` from `solid-js` IS what the
// emitter found.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { OBSERVE, createMemo, createRoot, createSignal, flush } from "solid-js";
import { attribution, type InteractionEvent, type NavigationEvent } from "solid-js/attribution";
import type { CallEvent, CallLive, FrameEvent, FrameLive } from "@solidjs/web";
import { GET, createServerReference } from "../server-functions/src/client.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  createChunk
} from "../server-functions/src/shared.js";
import { applyFrameResponse } from "../frames/src/frame-transport.js";

const unsubscribes: Array<() => void> = [];
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off();
  attribution.disable();
  flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function calls() {
  const seen: Array<{ event: CallEvent; live: CallLive }> = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe("call", (event, live) => {
      seen.push({ event, live });
    })
  );
  return seen;
}

function frames() {
  const seen: Array<{ event: FrameEvent; live: FrameLive }> = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe("frame", (event, live) => {
      seen.push({ event, live });
    })
  );
  return seen;
}

/** A JSON-encoded server-function answer, as the runtime writes one. */
function jsonResponse(value: unknown, init: ResponseInit = {}, error = false) {
  const headers = new Headers(init.headers);
  headers.set(BODY_FORMAT_HEADER, BodyFormat.Json);
  if (error) headers.set(ERROR_HEADER, "thrown");
  return new Response(JSON.stringify(value), { ...init, headers });
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("the call record", () => {
  test("a call that settled: identity, method, status, timing, the result beside it", async () => {
    const seen = calls();
    let sent!: { address: string; init: RequestInit };
    vi.stubGlobal("fetch", async (address: string, init: RequestInit) => {
      sent = { address, init };
      await delay(5);
      return jsonResponse({ n: 42 });
    });
    const fn = createServerReference("records/double");
    const before = performance.now();
    expect(await fn(21)).toEqual({ n: 42 });
    const after = performance.now();

    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.id).toBe("records/double");
    expect(event.method).toBe("POST");
    expect(sent.init.method).toBe("POST");
    expect(event.outcome).toBe("ok");
    expect(event.status).toBe(200);
    expect(event.deferred).toBeUndefined();
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
    expect(event.durationMs).toBeGreaterThanOrEqual(4);
    expect(event.durationMs).toBeLessThanOrEqual(after - before);
    // Serializable — no handles on it; those ride beside.
    expect(Object.keys(event).sort()).toEqual([
      "at",
      "durationMs",
      "id",
      "method",
      "outcome",
      "status"
    ]);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    expect(live.args).toEqual([21]);
    expect(live.result).toEqual({ n: 42 });
    expect(live.response!.status).toBe(200);
    expect(live.error).toBeUndefined();
  });

  test("a GET-encoded read records method GET with the call's arguments", async () => {
    const seen = calls();
    vi.stubGlobal("fetch", async () => jsonResponse("read"));
    const read = GET(createServerReference("records/read"));
    expect(await read("a", 2)).toBe("read");
    expect(seen).toHaveLength(1);
    expect(seen[0].event.method).toBe("GET");
    expect(seen[0].event.id).toBe("records/read");
    expect(seen[0].live.args).toEqual(["a", 2]);
  });

  test("a call the server rejected: outcome error, the thrown value beside it, the status on the record", async () => {
    const seen = calls();
    vi.stubGlobal("fetch", async () => jsonResponse({ message: "nope" }, { status: 500 }, true));
    const fn = createServerReference("records/throws");
    let thrown: unknown;
    try {
      await fn();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event).toMatchObject({ id: "records/throws", outcome: "error", status: 500 });
    // As thrown to the caller — the same object.
    expect(live.error).toBe(thrown);
    expect(live.result).toBeUndefined();
    expect(live.response!.status).toBe(500);
  });

  test("a call whose fetch rejected: outcome error and no status — no response arrived", async () => {
    const seen = calls();
    const failure = new TypeError("network down");
    vi.stubGlobal("fetch", async () => {
      throw failure;
    });
    const fn = createServerReference("records/offline");
    await expect(fn()).rejects.toBe(failure);
    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.outcome).toBe("error");
    expect(event.status).toBeUndefined();
    expect(live.response).toBeUndefined();
    expect(live.error).toBe(failure);
  });

  test("a throwing listener is reported; the call and the other listeners are unaffected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        OBSERVE!.records.subscribe("call", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        OBSERVE!.records.subscribe("call", event => {
          seen.push(event.outcome);
        })
      );
      vi.stubGlobal("fetch", async () => jsonResponse(1));
      expect(await createServerReference("records/listener")()).toBe(1);
      expect(seen).toEqual(["ok"]);
      expect(error).toHaveBeenCalledTimes(1);
      expect((error.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      error.mockRestore();
    }
  });

  test("without a listener nothing is delivered, and the call is the same", async () => {
    const seen = calls();
    for (const off of unsubscribes.splice(0)) off();
    vi.stubGlobal("fetch", async () => jsonResponse("quiet"));
    expect(await createServerReference("records/quiet")()).toBe("quiet");
    expect(seen).toHaveLength(0);
  });
});

// The record's provenance: what the call ran for, read at dispatch from the
// attribution engine (`OBSERVE.attribution.currentOrigin`, reached by the
// engine's registered symbol — this runtime imports no framework). The
// object is the engine's own frame, so an observer joins the call to the
// interaction or navigation record by identity, not by a time window.
describe("the call record's origin", () => {
  const CLICK = { type: "click", target: 'button#save "Save"' };

  function arm() {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
    const interactions: InteractionEvent[] = [];
    const navigations: NavigationEvent[] = [];
    attribution.subscribe("interaction", e => interactions.push(e));
    attribution.subscribe("navigation", e => navigations.push(e));
    return { interactions, navigations };
  }

  test("a call made in a handler carries the interaction — the interaction record's own origin object", async () => {
    const seen = calls();
    const { interactions } = arm();
    vi.stubGlobal("fetch", async () => jsonResponse("saved"));
    const save = createServerReference("records/save");
    // An `async` handler runs synchronously up to its first await: the
    // dispatch happens inside the frame, as a write there would.
    const pending = OBSERVE!.attribution.withInteraction(CLICK, () => save("draft"));
    flush();
    expect(await pending).toBe("saved");

    expect(seen).toHaveLength(1);
    const { event } = seen[0];
    expect(event.origin).toMatchObject({
      kind: "interaction",
      name: "click",
      target: CLICK.target
    });
    expect(interactions).toHaveLength(1);
    expect(event.origin).toBe(interactions[0].origin);
    // Still a plain record: the origin is the engine's serializable face.
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  test("a call made inside a recompute the navigation's write caused carries the navigation, under its click", async () => {
    const seen = calls();
    const { navigations } = arm();
    vi.stubGlobal("fetch", async () => jsonResponse("page"));
    const load = createServerReference("records/page");
    const [location, setLocation] = createSignal("/users", { name: "location" });
    let pending: Promise<unknown> | undefined;
    createRoot(() => {
      // What `createAsync(() => load(location()))` does: the call is made
      // inside the compute, and the record is stamped there.
      const page = createMemo(
        () => {
          const l = location();
          if (l !== "/users") pending = load(l);
          return l;
        },
        { name: "page" }
      );
      page();
    });
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(
        { kind: "navigation", name: "/users/:id", to: "/users/42", from: "/users" },
        () => setLocation("/users/42")
      )
    );
    flush();
    expect(await pending).toBe("page");

    expect(seen).toHaveLength(1);
    const { event } = seen[0];
    expect(event.origin).toMatchObject({
      kind: "navigation",
      name: "/users/:id",
      to: "/users/42",
      interaction: { kind: "interaction", name: "click" }
    });
    expect(navigations).toHaveLength(1);
    expect(event.origin).toBe(navigations[0].origin);
  });

  test("a call after the handler's first await, or with no engine, carries none", async () => {
    const seen = calls();
    vi.stubGlobal("fetch", async () => jsonResponse("ok"));
    const fn = createServerReference("records/bare");
    // No engine: the record is the same as before this field existed.
    expect(await fn()).toBe("ok");
    expect(seen[0].event.origin).toBeUndefined();
    expect("origin" in seen[0].event).toBe(false);

    arm();
    // The documented escape: after an await the frame is gone, as it is
    // for a write there.
    const late = OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await delay(1);
      return fn();
    });
    flush();
    expect(await late).toBe("ok");
    expect(seen).toHaveLength(2);
    expect(seen[1].event.origin).toBeUndefined();
  });
});

function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? createChunk(chunk) : createChunk(JSON.stringify(chunk))
        );
      }
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

/** A host that records what it was handed. */
function recordingHost() {
  const applied: any[] = [];
  return { applied, host: { apply: (chunk: any) => applied.push(chunk) } as any };
}

describe("the frame record, client side", () => {
  test("a stream applied: identity from the wire, the consumer's remap and restamp, the census", async () => {
    const seen = frames();
    const { applied, host } = recordingHost();
    const chunks = [
      { type: "start", id: "srv", version: 1 },
      { type: "slot", id: "srv", version: 1, key: "comment#0", args: { text: "hi" } },
      // A nested server-content region: html addressed to a child frame.
      { type: "html", id: "srv/arg:comment#0:body", version: 1, html: "<em>region</em>" },
      { type: "html", id: "srv", version: 1, html: "<article/>" },
      { type: "fragment", id: "srv", version: 1, key: "f0", html: "<p>late</p>" },
      { type: "error", id: "srv", version: 1, key: "f1", error: "boom" },
      { type: "complete", id: "srv", version: 1 }
    ];
    const before = performance.now();
    const address = await applyFrameResponse(frameResponse("srv", chunks), host, {
      as: "local-1",
      version: 7
    });
    const after = performance.now();
    expect(address).toBe("local-1");
    expect(applied).toHaveLength(chunks.length);

    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.side).toBe("client");
    // The wire id is the record's id (what the server's half carries); the
    // remap is beside it.
    expect(event.id).toBe("srv");
    if (event.side === "client") expect(event.address).toBe("local-1");
    // The version is the consumer's restamp — the number the stale-guard saw.
    expect(event.version).toBe(7);
    expect(event.outcome).toBe("complete");
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
    expect(event.shellMs).toBeGreaterThanOrEqual(0);
    expect(event.shellMs!).toBeLessThanOrEqual(event.durationMs);
    expect(event.durationMs).toBeLessThanOrEqual(after - before);
    // The census is the wire, between `start` and `complete`.
    expect(event.chunks).toBe(chunks.length - 2);
    expect(event.slots).toBe(1);
    expect(event.regions).toBe(1);
    expect(event.fragments).toBe(1);
    expect(event.errors).toBe(1);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    expect(live.response).toBeInstanceOf(Response);
    expect(live.error).toBeUndefined();
  });

  test("applied under the wire id: no address; the wire's version stands", async () => {
    const seen = frames();
    const { host } = recordingHost();
    await applyFrameResponse(
      frameResponse("srv", [
        { type: "start", id: "srv", version: 3 },
        { type: "html", id: "srv", version: 3, html: "<p/>" },
        { type: "complete", id: "srv", version: 3 }
      ]),
      host
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toMatchObject({ side: "client", id: "srv", version: 3, chunks: 1 });
    expect("address" in seen[0].event).toBe(false);
  });

  test("a body that ended before complete records truncated", async () => {
    const seen = frames();
    const { host } = recordingHost();
    await applyFrameResponse(
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: "<p/>" }
      ]),
      host
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toMatchObject({ outcome: "truncated", chunks: 1 });
    expect(seen[0].event.shellMs).toBeDefined();
    expect(seen[0].live.error).toBeUndefined();
  });

  test("a read that failed records error with the failure beside it, and still throws", async () => {
    const seen = frames();
    const { host } = recordingHost();
    let thrown: unknown;
    try {
      await applyFrameResponse(
        frameResponse("srv", [{ type: "start", id: "srv", version: 1 }, "{not json"]),
        host
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(seen).toHaveLength(1);
    expect(seen[0].event.outcome).toBe("error");
    expect(seen[0].live.error).toBe(thrown);
  });

  test("a single-flight response with several streams: one record each, in sequence", async () => {
    const seen = frames();
    const { host } = recordingHost();
    const versions: string[] = [];
    await applyFrameResponse(
      frameResponse("a", [
        { type: "start", id: "a", version: 1 },
        { type: "html", id: "a", version: 1, html: "<p>a</p>" },
        { type: "complete", id: "a", version: 1 },
        { type: "start", id: "b", version: 1 },
        { type: "html", id: "b", version: 1, html: "<p>b</p>" },
        { type: "fragment", id: "b", version: 1, key: "f", html: "<p/>" },
        { type: "complete", id: "b", version: 1 },
        // The response-scoped envelope is not a stream chunk.
        { type: "outcome", payload: "{}" }
      ]),
      host,
      { version: id => (versions.push(id), versions.length * 10) }
    );
    expect(seen.map(s => s.event.id)).toEqual(["a", "b"]);
    expect(seen.map(s => s.event.version)).toEqual([10, 20]);
    expect(seen.map(s => s.event.chunks)).toEqual([1, 2]);
    expect(seen.map(s => s.event.outcome)).toEqual(["complete", "complete"]);
  });

  test("a throwing listener is reported; the stream and the other listeners are unaffected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        OBSERVE!.records.subscribe("frame", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        OBSERVE!.records.subscribe("frame", event => {
          seen.push(event.outcome);
        })
      );
      const { applied, host } = recordingHost();
      await applyFrameResponse(
        frameResponse("srv", [
          { type: "start", id: "srv", version: 1 },
          { type: "complete", id: "srv", version: 1 }
        ]),
        host
      );
      expect(applied).toHaveLength(2);
      expect(seen).toEqual(["complete"]);
      expect(error).toHaveBeenCalledTimes(1);
      expect((error.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      error.mockRestore();
    }
  });

  test("without a listener nothing is delivered", async () => {
    const seen = frames();
    for (const off of unsubscribes.splice(0)) off();
    const { applied, host } = recordingHost();
    await applyFrameResponse(
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "complete", id: "srv", version: 1 }
      ]),
      host
    );
    expect(applied).toHaveLength(2);
    expect(seen).toHaveLength(0);
  });
});

describe("tiers, in the built artifacts", () => {
  // Requires a prior `pnpm build`. The strings that survive minification:
  // the registered names the emitters reach the channel and the engine by.
  const marker = "@solidjs/signals/observe/records";
  const engine = "@solidjs/signals/observe/attribution";
  const read = (file: string) => readFileSync(resolve(import.meta.dirname, "..", file), "utf8");

  test("the emitters fold out of the prod client artifacts and ride the observe and dev ones", () => {
    for (const entry of ["server-functions/dist", "frames/dist"]) {
      expect(read(`${entry}/client.js`), `${entry}/client.js`).not.toContain(marker);
      expect(read(`${entry}/client.js`), `${entry}/client.js`).not.toContain(engine);
      expect(read(`${entry}/client.observe.js`), `${entry}/client.observe.js`).toContain(marker);
      expect(read(`${entry}/client.dev.js`), `${entry}/client.dev.js`).toContain(marker);
    }
    // The call record's provenance reach rides with the call emitter.
    expect(read("server-functions/dist/client.observe.js")).toContain(engine);
    expect(read("server-functions/dist/client.dev.js")).toContain(engine);
    // The main client entry emits no record of its own.
    for (const tier of ["web.js", "web.observe.js", "web.dev.js"]) {
      expect(read(`dist/${tier}`), tier).not.toContain(marker);
    }
  });

  test("every client artifact had its flags replaced — an unreplaced literal is a truthy string", () => {
    for (const file of [
      "server-functions/dist/client.js",
      "server-functions/dist/client.observe.js",
      "server-functions/dist/client.dev.js",
      "frames/dist/client.js",
      "frames/dist/client.observe.js",
      "frames/dist/client.dev.js"
    ]) {
      const code = read(file);
      expect(code, file).not.toContain('"_SOLID_OBSERVE_"');
      expect(code, file).not.toContain('"_SOLID_DEV_"');
    }
  });

  test("the removed observer API is gone from both server-function entries", () => {
    for (const file of ["server-functions/dist/client.js", "server-functions/dist/server.js"]) {
      expect(read(file), file).not.toContain("observeServerFunctionCalls");
    }
  });
});
