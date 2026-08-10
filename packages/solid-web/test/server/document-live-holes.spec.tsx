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

  test("a JSX expression slot arg stays live at t=0: record re-emissions ride the channel (DR-2 case 1)", async () => {
    // The natural authored crossing — `<props.status text={text()}/>`, a
    // compiled getter, the SAME shape as a markup hole — opens a document
    // arg binding: each iterable yield lands a commit, the ledger re-runs
    // the getter, and the occurrence's record re-ships as a fid-tagged
    // `slot` op on the sc:live channel. Values ride inline (the hydration
    // serializer carries them per chunk; no versioned refs on this face).
    const ServerComp = (props: any) => {
      const text = createMemo(async function* () {
        yield "arg-1";
        await wait(5);
        yield "arg-2";
      });
      return (
        <Loading fallback={<span>FB</span>}>
          <props.status text={text()} />
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dlh/args" }) as any;
    const html = await collect(() => Inline({ status: (p: any) => <b>{p.text}</b> }));

    // First yield is the hydration truth: the fill's markup and the initial
    // record both read it. (The fill renders inline with its hydration key.)
    expect(html).toMatch(/<b [^>]*>arg-1<\/b>/);
    // The fill's interior is client-owned: mint-suppressed, so it grows no
    // live-hole markers — a server op morphing inside a claimed fill would
    // replace nodes the client's reactive bindings hold.
    expect(html).not.toMatch(/<b [^>]*><!--lh:/);
    expect(html).toContain("sc:slot:dlh/args");
    expect(html.split("arg-1").length).toBe(3); // markup + record
    // The second yield shipped exactly once — the slot op, not a second
    // markup rendering — and the op carries the producing frame's id (slot
    // ops are store-keyed; only the owning boundary applies them).
    expect(html.split("arg-2").length).toBe(2);
    expect(html).toContain("fid");
  });

  test("a NOT-READY getter arg is pending per-arg, never a hold on the occurrence (DR-2 case 1 at t=0)", async () => {
    // The welcome shape: `progress={progress()}` settles at the first yield
    // and keeps yielding; `stats={stats()}` stays not-ready until the whole
    // generation completes. Per-arg pending means the fill renders at the
    // shell with its OWN boundary covering the stats read — coarse holding
    // would render the fill only after stats settled, and the fallback
    // would never appear anywhere in the response.
    const ServerComp = (props: any) => {
      const progress = createMemo(async function* () {
        yield "p1";
        await wait(5);
        yield "p2";
      });
      const stats = createMemo(() => wait(20).then(() => "fin-stats"));
      return (
        <Loading fallback={<span>FB</span>}>
          <props.status progress={progress()} stats={stats()} />
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dlh/pending" }) as any;
    const html = await collect(() =>
      Inline({
        status: (p: any) => (
          <p>
            <span class="prog">{p.progress}</span>
            <Loading fallback={<i>counting</i>}>
              <b class="stats">{p.stats}</b>
            </Loading>
          </p>
        )
      })
    );

    // The per-arg proof: the fill's own stats fallback made it into the
    // response — the occurrence rendered before stats settled.
    expect(html).toContain("counting");
    // Progress: first yield is the markup truth; the second rides exactly
    // once as a slot op (the binding re-armed after its pending settle).
    expect(html).toContain("p1");
    expect(html.split("p2").length).toBe(2);
    // Stats: the late settle still delivered (fragment reveal or record
    // patch), and the response completed — the retry loop released.
    expect(html).toContain("fin-stats");
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
