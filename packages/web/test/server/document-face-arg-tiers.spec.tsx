/**
 * @jsxImportSource @solidjs/web
 */
// The document face × DR-2 arg tiers (t=0, where the SERVER is the consumer).
// The value tier and case-1 ledger were built on the stream face
// (createSlotProps); the document face (createDocumentSlotProps) predates
// them. This spec pins what the document face does today, empirically:
//
// Slots with args render as JSX (`<props.status …/>` — the compiled getter,
// the only correct authored form); the one call-form test below pins the
// WRONG form's failure mode on purpose.
//
// - A NOT-READY arg (a compiled getter throwing not-ready at the unwrap, or
//   the wrong-form eager call suspending in the component's render) is held
//   COARSELY by the fragment model: the server component's own <Loading>
//   defers the section and the retry delivers the settled value in the
//   deferred fragment. This is the "holding" alternative DR-2 rejected for
//   the stream face's granularity — but at t=0 it is functional and
//   consistent with "markup is the snapshot" (generator-only-model.md §10).
//   Pinned as PASSING.
//
// - An ASYNC VALUE PASSED WHOLE (the value tier: a promise/iterable arg)
//   suspends at the inline read: the document face wraps it in a full
//   async-aware memo (`ssrAsyncValue`), so the read throws
//   not-ready into the engine's hole machinery — the covering boundary
//   holds, the re-pull delivers the settled value in markup, and the page
//   agrees with what the adopted client will read from the record. The
//   record itself is untouched: the async value still ships there whole,
//   its resolution streaming through the document's data scripts.
//   (Closed gap — this was the document face's missing value-tier half.)
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any, plugins?: any[]): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, plugins ? ({ plugins } as any) : undefined).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

// The MARKUP the user sees: scripts stripped first (the seroval data channel
// legitimately carries the async value's resolution — `{tokens:42}` in a
// data script is the record settling, not the markup rendering), then the
// text-hole comment markers (`v:<!--$-->READY<!--/-->` reads as `v:READY`).
function visible(html: string): string {
  return html.replace(/<script[^]*?<\/script>/g, "").replace(/<!--[^]*?-->/g, "");
}

describe("document face × arg tiers (t=0)", () => {
  // DR-2 value tier, document half: the inline fill reads the settled value
  // — suspending into the covering boundary until the async arg settles —
  // the way the client's slot-props proxy reads it after adoption. Mode
  // invariance at t=0: the same authored crossing behaves identically
  // whether the mount is call-driven or the initial document.
  test("an async slot arg's inline read settles through the document's streaming (value tier)", async () => {
    const ServerComp = (props: any) => {
      // Hoisted so the compiled getter reads ONE promise (a `.then()` inline
      // in the JSX would mint a fresh promise per getter read).
      const stats = wait(10).then(() => ({ tokens: 42 }));
      return (
        <Loading fallback={<span>GENFB</span>}>
          <section>
            <props.status stats={stats} />
          </section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dfa-value" }) as any;
    const html = await collect(
      () => (
        <Loading fallback={<span>PARENTFB</span>}>
          {Inline({ status: (p: any) => <b>tokens:{p.stats && p.stats.tokens}</b> })}
        </Loading>
      ),
      [ServerComponentPlugin]
    );
    // The settled value lands in the (streamed) MARKUP: the read
    // suspends, the boundary holds, the deferred content delivers 42 —
    // and the data script still carries the resolution for the adopted
    // client. Page markup and post-hydration read now agree.
    expect(visible(html)).toContain("tokens:42");
    // The fallback shipped first: the pending read held the boundary.
    expect(html).toContain("GENFB");
  });

  // The iterable tap: one cursor, two consumers. The inline read settles on
  // the FIRST yield (markup is the V1 snapshot — later yields are the
  // adopted client's story), while the record ships a replay wrapper so the
  // document's data scripts still stream the complete sequence.
  test("an async-iterable arg reads as its first yield inline; the record streams every yield", async () => {
    async function* ticks() {
      await wait(5);
      yield "first";
      await wait(5);
      yield "second";
    }
    const ServerComp = (props: any) => {
      // Hoisted: the tap's whole premise is ONE cursor with two consumers —
      // an inline `ticks()` in the JSX would mint a generator per getter
      // read and quietly dissolve the thing under test.
      const tick = ticks();
      return (
        <Loading fallback={<span>GENFB</span>}>
          <section>
            <props.status tick={tick} />
          </section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dfa-iter" }) as any;
    const html = await collect(
      () => (
        <Loading fallback={<span>PARENTFB</span>}>
          {Inline({ status: (p: any) => <b>tick:{p.tick}</b> })}
        </Loading>
      ),
      [ServerComponentPlugin]
    );
    // V1 snapshot: the markup carries the first yield, never the second.
    expect(visible(html)).toContain("tick:first");
    expect(visible(html)).not.toContain("second");
    // The full sequence rode the data channel (seroval's stream patches).
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  test("a not-ready getter arg is held by the fragment model and delivers settled (coarse holding)", async () => {
    const ServerComp = (props: any) => {
      const m = createMemo(() => wait(10).then(() => "READY"));
      // `v={m()}` compiles to a getter — the common authored form: the read
      // defers to the border, where it throws not-ready at the unwrap.
      return (
        <Loading fallback={<span>GENFB</span>}>
          <section>
            <props.status v={m()} />
          </section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dfa-thunk" }) as any;
    const html = await collect(
      () => (
        <Loading fallback={<span>PARENTFB</span>}>
          {Inline({ status: (p: any) => <b>v:{p.v}</b> })}
        </Loading>
      ),
      [ServerComponentPlugin]
    );
    // The shell shipped the server fallback with a placeholder (the section
    // deferred as a fragment), and the retry delivered the settled arg in
    // MARKUP (the deferred fragment's template) — coarse (the whole section
    // held, the granularity trade the stream face's pending-marks avoid),
    // but nothing crashed, nothing orphaned, nothing empty.
    expect(visible(html)).toContain("GENFB");
    expect(visible(html)).toContain("v:READY");
  });

  test("the WRONG form — an eager call arg — suspends the whole component render (pinned failure mode)", async () => {
    const ServerComp = (props: any) => {
      const m = createMemo(() => wait(10).then(() => "READY"));
      // The call form is the incorrect authored shape: `m()` is a top-level
      // read, evaluated in the component body before the border. JSX can't
      // even express this — which is the point. Pinned so the failure mode
      // is a known quantity: the not-ready read suspends the whole section
      // (no crash, no orphan), same coarse holding as the getter case.
      return (
        <Loading fallback={<span>GENFB</span>}>
          <section>{props.status({ v: m() })}</section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "dfa-eager" }) as any;
    const html = await collect(
      () => (
        <Loading fallback={<span>PARENTFB</span>}>
          {Inline({ status: (p: any) => <b>v:{p.v}</b> })}
        </Loading>
      ),
      [ServerComponentPlugin]
    );
    expect(visible(html)).toContain("GENFB");
    expect(visible(html)).toContain("v:READY");
  });
});
