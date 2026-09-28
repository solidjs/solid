/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The hold optimism over server components depends on (principles §9.2.2):
// an optimistic write made in an action must still be live when the
// AUTHORITATIVE slot args land, on both mutation shapes — otherwise a fill
// deriving `intent ?? p.value` flashes the old server value between the
// optimistic release and the new args. The fill here is a content slot; the
// invariant is the same one attribute fills will rely on.
//
//   single-flight — the mutation's response carries the invalidated region;
//                   the handler applies it before the call resolves.
//   multi-flight  — the mutation returns plain data; the action then
//                   `refresh`es the source the boundary reads, and the
//                   refetched region arrives on its own response.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  isPending,
  refresh,
  Loading
} from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import { flightCodec } from "../frames/src/frame-transport.js";
import { createServerReference } from "../server-functions/src/client.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ChunkReader,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  serializeStream
} from "../server-functions/src/shared.js";
import { makeHost, frameResponse, openFrameResponse, pump } from "./lifecycle-matrix/harness.js";

const TODOS = "hold/todos";
const listHtml = "<ul><!--slot:row#0:start--><!--slot:row#0:end--></ul>";
const rowChunk = (id: string, version: number, completed: boolean) => ({
  type: "slot",
  id,
  version,
  key: "row#0",
  args: { id: "1", completed }
});

/**
 * A HELD single-flight frame response: headers now, body fed by the test.
 * The region's chunks are followed by the envelope as `outcome` chunks
 * (the codec's own nodes, as `frameFlightResponse` writes them).
 */
function openFlightResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });
  return {
    response: new Response(body, {
      headers: {
        "Content-Type": "application/x-frame-stream",
        "X-Frame-Stream": "",
        [SINGLE_FLIGHT_HEADER]: "true"
      }
    }),
    send(chunk: any) {
      controller.enqueue(createChunk(JSON.stringify(chunk)));
    },
    async outcome(envelope: unknown) {
      const reader = new ChunkReader(serializeStream(envelope, flightCodec(undefined)));
      for (let node = await reader.next(); !node.done; node = await reader.next())
        controller.enqueue(createChunk(JSON.stringify({ type: "outcome", payload: node.value })));
    },
    close() {
      controller.close();
    }
  };
}

function plainResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { [BODY_FORMAT_HEADER]: BodyFormat.Json }
  });
}

/** Mount `<Loading><Comp row={fill}/></Loading>`; the fill traces every
 *  re-derivation as `server/derived` and renders the derived value. */
function mount(Comp: any, done: (p: any) => boolean, trace: string[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>fallback</span>}>
        <Comp
          row={(p: any) => {
            createMemo(() => trace.push(`${p.completed}/${done(p)}`));
            return <li>{String(done(p))}</li>;
          }}
        />
      </Loading>
    </div>;
    container.appendChild(div);
    return d;
  });
  return {
    text: () => div.querySelector("li")?.textContent ?? div.textContent,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("optimism over server components holds until the authoritative args land", () => {
  test("single-flight: the region applies before the mutation resolves; the derived value never flashes", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const getTodos = createServerReference("hold/todos");
    const toggleTodo = createServerReference("hold/toggle-sf");

    const flight = openFlightResponse();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      urls.push(typeof input === "string" ? input : input.url);
      if (urls.length === 1)
        return frameResponse(TODOS, [
          { type: "start", id: TODOS, version: 1 },
          rowChunk(TODOS, 1, false),
          { type: "html", id: TODOS, version: 1, html: listHtml },
          { type: "complete", id: TODOS, version: 1 }
        ]);
      return flight.response;
    });

    const [pending, setPending] = createRoot(() => createOptimistic<Record<string, boolean>>({}));
    const done = (p: any) => pending()[p.id] ?? p.completed;
    const trace: string[] = [];
    const Todos = dynamic(() => getTodos() as any);
    const m = mount(Todos, done, trace);
    await pump();
    expect(m.text()).toBe("false");
    expect(trace).toEqual(["false/false"]);

    const toggle = action(function* (id: string, completed: boolean) {
      setPending(p => ({ ...p, [id]: completed }));
      return yield toggleTodo(id, completed);
    });
    const result = toggle("1", true);
    await pump();
    // optimistic, server still says false
    expect(m.text()).toBe("true");
    expect(trace.at(-1)).toBe("false/true");

    // The server answers: the region for the invalidated call, then the
    // envelope. Nothing resolves until the whole body is applied.
    flight.send({ type: "start", id: TODOS, version: 1 });
    flight.send(rowChunk(TODOS, 1, true));
    flight.send({ type: "html", id: TODOS, version: 1, html: listHtml });
    flight.send({ type: "complete", id: TODOS, version: 1 });
    await flight.outcome({ value: "ok", data: {} });
    flight.close();
    await expect(result).resolves.toBe("ok");
    await pump(3);

    expect(m.text()).toBe("true");
    // the authoritative args landed while the optimistic value was live
    // (true/true), then the intent released over agreeing truth (the second
    // true/true) — the derived value never read false after the write
    expect(trace).toEqual(["false/false", "false/true", "true/true", "true/true"]);
    expect(pending()).toEqual({}); // settled: the intent has released

    m.cleanup();
  });

  test("multi-flight: `refresh` of the source inside the action holds until the refetched args apply", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const getTodos = createServerReference("hold/todos");
    const toggleTodo = createServerReference("hold/toggle-mf");

    const refetch = openFrameResponse(TODOS);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      urls.push(typeof input === "string" ? input : input.url);
      if (urls.length === 1)
        return frameResponse(TODOS, [
          { type: "start", id: TODOS, version: 1 },
          rowChunk(TODOS, 1, false),
          { type: "html", id: TODOS, version: 1, html: listHtml },
          { type: "complete", id: TODOS, version: 1 }
        ]);
      if (urls.length === 2) return plainResponse("ok");
      // the refetch: headers now (the binding resolves), body held
      return refetch.response;
    });

    const [pending, setPending] = createRoot(() => createOptimistic<Record<string, boolean>>({}));
    const done = (p: any) => pending()[p.id] ?? p.completed;
    const trace: string[] = [];
    const todos = createRoot(() => createMemo(() => getTodos() as any));
    const Todos = dynamic(() => todos());
    const m = mount(Todos, done, trace);
    await pump();
    expect(m.text()).toBe("false");
    expect(trace).toEqual(["false/false"]);

    const toggle = action(function* (id: string, completed: boolean) {
      setPending(p => ({ ...p, [id]: completed }));
      const r = yield toggleTodo(id, completed);
      yield refresh(todos);
      return r;
    });
    const result = toggle("1", true);
    await pump(3);
    expect(urls).toHaveLength(3); // initial, mutation, refetch
    // The mutation returned and the refetch's headers arrived, but its body
    // has not: the optimistic value must still be showing.
    expect(m.text()).toBe("true");
    expect(trace.slice(1)).not.toContain("false/false");

    refetch.send({ type: "start", id: TODOS, version: 2 });
    refetch.send(rowChunk(TODOS, 2, true));
    refetch.send({ type: "html", id: TODOS, version: 2, html: listHtml });
    refetch.send({ type: "complete", id: TODOS, version: 2 });
    refetch.close();
    await expect(result).resolves.toBe("ok");
    await pump(3);

    expect(m.text()).toBe("true");
    // same shape as single-flight: args under live intent, then release
    expect(trace).toEqual(["false/false", "false/true", "true/true", "true/true"]);
    expect(pending()).toEqual({});

    m.cleanup();
  });

  test("a refetch of a SHOWING call reads pending until its content applies; a cold call still settles at the header", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const getTodos = createServerReference("hold/todos");

    const first = openFrameResponse(TODOS);
    const second = openFrameResponse(TODOS);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      urls.push(typeof input === "string" ? input : input.url);
      return urls.length === 1 ? first.response : second.response;
    });

    // A revalidation-shaped refetch: an upstream write re-asks the same call
    // (the router's query invalidation). `refresh()` itself is verdict-quiet
    // by design; a write is what `isPending` reports.
    const [tick, setTick] = createSignal(0);
    const todos = createRoot(() => createMemo(() => (tick(), getTodos() as any)));
    const Todos = dynamic(() => todos());
    const probe: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = createRoot(d => {
      container.appendChild(
        (
          <div>
            <span>{isPending(todos) ? "pending" : "idle"}</span>
            <Loading fallback={<span>fallback</span>}>
              <Todos row={(p: any) => <li>{String(p.completed)}</li>} />
            </Loading>
          </div>
        ) as Node
      );
      return d;
    });
    const read = () => {
      probe.push(container.querySelector("span")!.textContent!);
      return probe.at(-1);
    };
    await pump();
    // Cold: the binding resolved at the header; the boundary is mounted and
    // its shell gate is what holds the fallback. The source itself is idle.
    expect(container.textContent).toContain("fallback");
    expect(read()).toBe("idle");
    first.send({ type: "start", id: TODOS, version: 1 });
    first.send(rowChunk(TODOS, 1, false));
    first.send({ type: "html", id: TODOS, version: 1, html: listHtml });
    first.send({ type: "complete", id: TODOS, version: 1 });
    first.close();
    await pump();
    expect(container.querySelector("li")!.textContent).toBe("false");

    // Showing: the refetch's header is not an answer — the source reads
    // pending until the new content has applied, old content stays.
    setTick(1);
    await pump(3);
    expect(urls).toHaveLength(2);
    expect(container.querySelector("li")!.textContent).toBe("false");
    expect(read()).toBe("pending");
    second.send({ type: "start", id: TODOS, version: 2 });
    second.send(rowChunk(TODOS, 2, true));
    second.send({ type: "html", id: TODOS, version: 2, html: listHtml });
    second.send({ type: "complete", id: TODOS, version: 2 });
    second.close();
    await pump(3);
    expect(container.querySelector("li")!.textContent).toBe("true");
    expect(read()).toBe("idle");

    dispose();
    container.remove();
  });
});
