/**
 * @jsxImportSource @solidjs/web
 *
 * `getTraceContext()` × concurrent renders outside any request scope (a bare
 * `renderToString`/`renderToStream`, no framework, no
 * `provideRequestEvent`). Such a render's trace is its own; the
 * module-global `sharedConfig.context` is whichever render started last, so
 * a trace read off it can be another render's. A read resolves through the
 * caller's own render, found through its owner, or not at all.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { renderToStream, renderToString, getTraceContext } from "@solidjs/web";
import type { RenderLive, TraceContext } from "@solidjs/web";
import { OBSERVE, createMemo, getOwner, runWithOwner, type Owner } from "solid-js";

const RequestContext = Symbol.for("solid.RequestContext");

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

let saved: unknown;
beforeEach(() => {
  saved = (globalThis as any)[RequestContext];
  delete (globalThis as any)[RequestContext];
});
afterEach(() => {
  if (saved !== undefined) (globalThis as any)[RequestContext] = saved;
});

// A stream whose shell waits on root-level async work. `own` is the trace
// its component body reads during the render pass; `work` runs in the
// continuation after `holdMs` with the page's owner captured before the
// `await`. Piped by default; `awaited` consumes the thenable instead.
function stream(holdMs: number, work: (owner: Owner) => void = () => {}, awaited = false) {
  let own: TraceContext | undefined;
  const html = new Promise<string>(resolve => {
    const result = renderToStream(() => {
      function Page() {
        own = getTraceContext();
        const owner = getOwner()!;
        const data = createMemo(async () => {
          await delay(holdMs);
          work(owner);
          return "done";
        });
        return <p>{data()}</p>;
      }
      return <Page />;
    });
    if (awaited) result.then(resolve);
    else {
      const chunks: string[] = [];
      result.pipe({ write: (c: string) => chunks.push(c), end: () => resolve(chunks.join("")) });
    }
  });
  return { html, own: () => own };
}

async function interleaved(work: (owner: Owner) => void) {
  const a = stream(10, work);
  await delay(3);
  const b = stream(30);
  await Promise.all([a.html, b.html]);
  expect(a.own()).toBeDefined();
  expect(b.own()).toBeDefined();
  expect(a.own()!.traceId).not.toBe(b.own()!.traceId);
  return { a: a.own()!, b: b.own()! };
}

describe("getTraceContext outside a request scope, under concurrent renders", () => {
  test("a read with its render's owner after an await is that render's trace", async () => {
    let read: TraceContext | undefined;
    const { a } = await interleaved(owner => {
      read = runWithOwner(owner, () => getTraceContext());
    });
    expect(read).toBe(a);
  });

  test("an owner-less read after an await is no render's trace", async () => {
    let read: TraceContext | undefined = {} as TraceContext;
    await interleaved(() => {
      read = getTraceContext();
    });
    expect(read).toBeUndefined();
  });
});

// Guards: a render record settles off its render's pass (after the string
// root returned, from the stream's completion), where the owner lookup alone
// finds nothing; the record settles under the render's root owner so its
// listener still reads the render's own trace.
describe("the render record's listener outside a request scope", () => {
  let off: (() => void) | undefined;
  afterEach(() => {
    off && off();
    off = undefined;
  });

  test("a string render's listener reads the render's own trace", () => {
    const seen: Array<[TraceContext | undefined, RenderLive]> = [];
    off = OBSERVE!.records.subscribe("render", (_, live) => seen.push([getTraceContext(), live]));
    renderToString(() => <p>A</p>);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBeDefined();
    expect(seen[0][0]).toBe(seen[0][1].trace);
  });

  test("a stream's listener reads the stream's own trace, another render in flight", async () => {
    const seen: Array<[TraceContext | undefined, RenderLive]> = [];
    off = OBSERVE!.records.subscribe("render", (_, live) => seen.push([getTraceContext(), live]));
    const a = stream(10);
    await delay(3);
    const b = stream(30);
    await Promise.all([a.html, b.html]);
    await delay(5);
    expect(seen).toHaveLength(2);
    expect(seen.map(([read, live]) => read === live.trace)).toEqual([true, true]);
  });

  test("an awaited stream's listener, settling after its render let go, reads no other render's trace", async () => {
    // The awaited path resolves (and releases the render) at completion,
    // before the record settles: no render is left to attribute the read to.
    const seen: Array<[TraceContext | undefined, RenderLive]> = [];
    off = OBSERVE!.records.subscribe("render", (_, live) => seen.push([getTraceContext(), live]));
    const a = stream(10, undefined, true);
    await delay(3);
    const b = stream(30);
    await Promise.all([a.html, b.html]);
    await delay(5);
    const own = seen.find(([, live]) => live.trace === a.own());
    expect(own).toBeDefined();
    expect(own![0]).toBeUndefined();
  });
});
