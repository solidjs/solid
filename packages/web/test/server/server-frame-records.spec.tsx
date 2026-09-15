/**
 * @jsxImportSource @solidjs/web
 */
// The `"frame"` record on `OBSERVE.records`, server side (sentry-integration-plan
// C4, server half): one record per frame stream produced — a server component
// rendered to the frame transport — from its `start` chunk to its `complete`,
// with the time to the shell, the whole duration, and a census of what the
// stream carried (fragments, slots, regions, errors). The `"invocation"`
// record's neighbour: a server-function response that is a frame stream
// yields both, joined by `id`.
//
// Pinned here against the real producers (`renderServerComponent`,
// `renderToFrameStream`, and the handler path through `frameTransformResult`):
//
//  - a stream that completed: identity from the `frame` option, timing,
//    the chunk census matching the wire;
//  - the synchronous failure path: `outcome: "error"`, the thrown value
//    beside the record, the stream still completing;
//  - a fragment that failed: counted in `errors`, the stream `complete`;
//  - the handler path: the frame record's `id` is the invocation's;
//  - a listener cannot break the stream; without one nothing is read.
//
// This suite imports source (the dev tier).
import { afterEach, describe, expect, test, vi } from "vitest";
import { OBSERVE, createMemo } from "solid-js";
import { Loading } from "@solidjs/web";
import type { FrameEvent, FrameLive, InvocationEvent } from "@solidjs/web";
import {
  frameTransformResult,
  renderServerComponent,
  renderToFrameStream
} from "../../frames/src/frame-sink.js";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "../../server-functions/src/server.js";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

type Record = { event: FrameEvent; live: FrameLive };

const unsubscribes: Array<() => void> = [];
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off();
});

function records(): Record[] {
  const seen: Record[] = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe("frame", (event, live) => {
      seen.push({ event, live });
    })
  );
  return seen;
}

/** Awaits the stream (its thenable collects every chunk). */
const collect = (stream: any): Promise<any[]> => stream;

/** An async read that answers `value` after `ms`. */
function Slow(props: { ms: number; value: string }) {
  const data = createMemo(async () => {
    await delay(props.ms);
    return props.value;
  });
  return <p>{data()}</p>;
}

describe("a stream that completed", () => {
  test("identity, timing and the chunk census — delivered once, at complete", async () => {
    const seen = records();
    const ServerComp = (props: any) => (
      <section>
        <h1>Story</h1>
        <props.comment id={1} />
        <props.comment id={2} body={<em>server-owned</em>} />
        <Loading fallback={<i>loading</i>}>
          <Slow ms={10} value="late" />
        </Loading>
      </section>
    );
    const before = performance.now();
    const chunks = await collect(
      renderServerComponent(ServerComp, { frame: { id: "f0", version: 3 } })
    );
    const after = performance.now();

    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    expect(event.side).toBe("server");
    expect(event.id).toBe("f0");
    expect(event.version).toBe(3);
    expect(event.outcome).toBe("complete");
    expect(live).toEqual({});
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
    // The shell went out before the fragment; the stream ran at least the wait.
    expect(event.shellMs).toBeGreaterThanOrEqual(0);
    expect(event.shellMs!).toBeLessThanOrEqual(event.durationMs);
    expect(event.durationMs).toBeGreaterThanOrEqual(5);
    expect(event.durationMs).toBeLessThanOrEqual(after - before);
    // The census is the wire, between `start` and `complete`.
    const body = chunks.filter(c => c.type !== "start" && c.type !== "complete");
    expect(event.chunks).toBe(body.length);
    expect(event.fragments).toBe(chunks.filter(c => c.type === "fragment").length);
    expect(event.fragments).toBe(1);
    expect(event.slots).toBe(2);
    // The server JSX slot arg went out as a nested region: an html chunk
    // addressed to a child frame id — counted as a region, not as the shell.
    const regions = chunks.filter(c => c.type === "html" && c.id !== "f0");
    expect(regions).toHaveLength(1);
    expect(event.regions).toBe(1);
    expect(event.errors).toBe(0);
    // Serializable as delivered.
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  test("a bare renderToFrameStream records with the default identity", async () => {
    const seen = records();
    await collect(renderToFrameStream(() => <div>plain</div>));
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toMatchObject({
      side: "server",
      id: "",
      version: 1,
      outcome: "complete",
      fragments: 0,
      slots: 0,
      regions: 0,
      errors: 0
    });
    expect(seen[0].event.chunks).toBeGreaterThanOrEqual(1);
  });
});

describe("failures", () => {
  test("a synchronous render failure: outcome error, the value beside it, the stream still completes", async () => {
    const seen = records();
    const boom = new Error("render failed");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const chunks = await collect(
        renderServerComponent(
          () => {
            throw boom;
          },
          { frame: { id: "f-err" } }
        )
      );
      expect(chunks.map(c => c.type)).toEqual(["start", "error", "complete"]);
      expect(seen).toHaveLength(1);
      const { event, live } = seen[0];
      expect(event.outcome).toBe("error");
      expect(event.errors).toBe(1);
      expect(event.chunks).toBe(1);
      expect(event.shellMs).toBeUndefined();
      expect(live.error).toBe(boom);
    } finally {
      error.mockRestore();
    }
  });

  test("a fragment that failed is counted; the stream completed", async () => {
    const seen = records();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      function Failing() {
        const data = createMemo(async () => {
          await delay(5);
          throw new Error("fragment failed");
        });
        return <p>{data()}</p>;
      }
      const chunks = await collect(
        renderServerComponent(
          () => (
            <section>
              <Loading fallback={<i>loading</i>}>
                <Failing />
              </Loading>
            </section>
          ),
          { frame: { id: "f-frag" } }
        )
      );
      expect(chunks.some(c => c.type === "error")).toBe(true);
      expect(chunks[chunks.length - 1].type).toBe("complete");
      expect(seen).toHaveLength(1);
      expect(seen[0].event.outcome).toBe("complete");
      expect(seen[0].event.errors).toBe(chunks.filter(c => c.type === "error").length);
      expect(seen[0].event.errors).toBeGreaterThanOrEqual(1);
      expect(seen[0].live).toEqual({});
    } finally {
      error.mockRestore();
    }
  });
});

describe("beside the invocation record", () => {
  test("a server-function response that is a frame stream yields both, joined by id", async () => {
    const frames = records();
    const invocations: InvocationEvent[] = [];
    unsubscribes.push(
      OBSERVE!.records.subscribe("invocation", event => {
        invocations.push(event);
      })
    );
    registerServerFunction("observe-frame-story", async (title: string) => {
      await delay(3);
      return (props: any) => (
        <article>
          <h1>{title}</h1>
          <props.comment id={1} />
        </article>
      );
    });
    const response = await handleServerFunctionRequest(
      new Request("http://localhost/_server/observe-frame-story", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "text/plain",
          "X-Server-Function-Format": "1"
        },
        body: "Frames"
      }),
      { transformResult: frameTransformResult, provideEvent: (_e: any, fn: any) => fn() }
    );
    const wire = await response.text();
    expect(wire).toContain("Frames");

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      id: "observe-frame-story",
      direct: false,
      outcome: "ok"
    });
    expect(frames).toHaveLength(1);
    expect(frames[0].event.id).toBe("observe-frame-story");
    expect(frames[0].event.outcome).toBe("complete");
    expect(frames[0].event.slots).toBe(1);
    // The call settled (the component was returned) before the frame
    // finished streaming: the invocation is the call, the frame the response.
    expect(frames[0].event.at + frames[0].event.durationMs).toBeGreaterThanOrEqual(
      invocations[0].at + invocations[0].durationMs
    );
  });
});

describe("the channel", () => {
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
      const chunks = await collect(renderToFrameStream(() => <div>ok</div>));
      expect(chunks[chunks.length - 1].type).toBe("complete");
      expect(seen).toEqual(["complete"]);
      expect(error).toHaveBeenCalledTimes(1);
      expect((error.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      error.mockRestore();
    }
  });

  test("unsubscribed listeners hear nothing, and the stream is the same", async () => {
    const seen = records();
    for (const off of unsubscribes.splice(0)) off();
    const chunks = await collect(renderToFrameStream(() => <div>ok</div>, { frame: { id: "q" } }));
    expect(seen).toHaveLength(0);
    expect(chunks[0]).toEqual({ type: "start", id: "q", version: 1 });
    expect(chunks[chunks.length - 1]).toEqual({ type: "complete", id: "q", version: 1 });
  });
});
