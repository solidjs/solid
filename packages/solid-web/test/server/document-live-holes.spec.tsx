/**
 * @jsxImportSource @solidjs/web
 */
// Live markup holes on the DOCUMENT face (Stage 4, producer half) against
// the real core: a server component rendered inline at t=0 marks its thunk
// content holes in the page bytes, opens ledger bindings, and streams
// re-emissions as ops over ONE `sc:live` hydration record (a ReadableStream
// the document's data scripts keep feeding).
//
// The real-core interactions pinned here, beyond the runtime suite:
//   - the arming scope rides the server-component context barrier
//     (`inServerComponentScope`) — holes in plain document content keep
//     their t=0 latch and their exact bytes;
//   - an async-iterable memo INSIDE the component pumps (the scope-gated
//     ctx.commit pump): each yield lands a commit, re-emits the changed
//     hole, and the pump's ctx.hold keeps the response open until the
//     iterable completes — the latch-at-completion lifetime. The response
//     ENDING at all is the hold/release proof.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";
import {
  frameTransformDirectResult,
  ServerComponentPlugin
} from "@dom-expressions/runtime/src/frame-sink.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

describe("document face — live holes against the real core", () => {
  test("an iterable-fed hole marks, streams its yields as channel ops, and latches at completion", async () => {
    const ServerComp = () => {
      const text = createMemo(async function* () {
        yield "one";
        await wait(5);
        yield "one two";
        await wait(5);
        yield "one two three";
      });
      return (
        <Loading fallback={<span>FB</span>}>
          <section>{text()}</section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dlh/gen" }) as any;
    const html = await collect(() => Inline({}));

    // The channel record shipped, and the hole is marker-wrapped in the
    // page markup (the deferred fragment's payload carries it).
    expect(html).toContain("sc:live");
    expect(html).toMatch(/<!--lh:(\d+)-->one<!--lh:\/\1-->/);
    // Later yields ride the channel as ops — html-valued data, not markup.
    expect(html).toContain("one two");
    expect(html).toContain("one two three");
    // Single-copy: the final value appears exactly once (its op), not as a
    // second markup rendering.
    expect(html.split("one two three").length).toBe(2);
    // The response completed: the pump's hold released at the iterable's
    // end and the latch closed the channel. (Reaching this line at all is
    // the lifetime proof — an unreleased hold never ends the stream.)
  });

  test("two components under component wrappers share ONE channel and the response still completes (context-clone geometry)", async () => {
    // Components render under per-component context CLONES: the arm point's
    // ctx is not the root object the flush loop reads. This pins the shared
    // `ctx.live` carrier — the end latch reaching the root (the response
    // ENDS: without it the serialized stream never closes and the document
    // hangs), and the once-per-document dedupe (a second component arming
    // under a sibling clone adopts the engine instead of minting a second
    // `sc:live` record).
    const make = (label: string) => () => {
      const text = createMemo(async function* () {
        yield `${label}-1`;
        await wait(5);
        yield `${label}-2`;
      });
      return (
        <Loading fallback={<span>FB</span>}>
          <p>{text()}</p>
        </Loading>
      );
    };
    const A = frameTransformDirectResult(make("alpha"), { id: "dlh/a" }) as any;
    const B = frameTransformDirectResult(make("beta"), { id: "dlh/b" }) as any;
    // Loading is a real component: everything below it renders under a
    // context clone — the geometry that regressed.
    const html = await collect(() => (
      <Loading fallback={<span>OUTERFB</span>}>
        <div>
          {A({})}
          {B({})}
        </div>
      </Loading>
    ));

    expect(html.split('"sc:live"').length).toBe(2); // exactly one channel record
    expect(html).toMatch(/<!--lh:(\d+)-->alpha-1<!--lh:\/\1-->/);
    expect(html).toMatch(/<!--lh:(\d+)-->beta-1<!--lh:\/\1-->/);
    // Both components' later yields rode the one channel; completion of the
    // collect() itself is the end-latch proof.
    expect(html).toContain("alpha-2");
    expect(html).toContain("beta-2");
  });

  test("plain document content around the component keeps its exact bytes", async () => {
    const ServerComp = () => {
      const tick = createMemo(async function* () {
        yield "in-1";
        await wait(5);
        yield "in-2";
      });
      return (
        <Loading fallback={<span>FB</span>}>
          <div>{tick()}</div>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dlh/scope" }) as any;
    const outside = createMemo(() => "outside-static");
    const html = await collect(() => (
      <main>
        <aside>{outside()}</aside>
        {Inline({})}
      </main>
    ));

    // The component's hole marked; the plain content's hole did not.
    expect(html).toMatch(/<!--lh:(\d+)-->in-1<!--lh:\/\1-->/);
    expect(html).toContain("outside-static");
    expect(html).not.toMatch(/<!--lh:(\d+)-->outside-static/);
  });
});
