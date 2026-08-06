/**
 * @jsxImportSource @solidjs/web
 */
// The document face × DR-2 arg tiers (t=0, where the SERVER is the consumer).
// The value tier and case-1 ledger were built on the stream face
// (createSlotProps); the document face (createDocumentSlotProps) predates
// them. This spec pins what the document face does today, empirically:
//
// - A NOT-READY arg (a thunk/getter throwing not-ready at the unwrap, or an
//   eager call suspending in the component's render) is held COARSELY by the
//   fragment model: the server component's own <Loading> defers the section
//   and the retry delivers the settled value in the deferred fragment. This
//   is the "holding" alternative DR-2 rejected for the stream face's
//   granularity — but at t=0 it is functional and consistent with "markup is
//   the snapshot" (generator-only-model.md §10). Pinned as PASSING.
//
// - An ASYNC VALUE PASSED WHOLE (the value tier: a promise/iterable arg) is
//   handed to the inline fill RAW. The record serializes it correctly
//   (seroval streams the resolution through the document's data scripts, so
//   the ADOPTED client settles fine), but the t=0 markup renders the fill's
//   read of the raw value — an empty hole where the settled value belongs,
//   a hydration mismatch instead of a covered pending read. GAP, marked
//   test.fails until the document face wraps the inline read so it suspends
//   into the document's own streaming (recorded in
//   server-components-principles.md, DR-2 known gap).
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";
import {
  frameTransformDirectResult,
  ServerComponentPlugin
} from "@dom-expressions/runtime/src/frame-sink.js";

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
  // GAP (DR-2 value tier, document half): the inline fill must read the
  // settled value — suspending into the covering boundary until the async
  // arg settles — the way the client's slot-props proxy reads it after
  // adoption. Today `resolved[key]` hands the fill the raw promise and the
  // markup ships an empty hole.
  test.fails(
    "an async slot arg's inline read settles through the document's streaming (value tier)",
    async () => {
      const ServerComp = (props: any) => (
        <Loading fallback={<span>GENFB</span>}>
          <section>{props.status({ stats: wait(10).then(() => ({ tokens: 42 })) })}</section>
        </Loading>
      );
      const Inline = frameTransformDirectResult(ServerComp, { id: "dfa-value" }) as any;
      const html = await collect(
        () => (
          <Loading fallback={<span>PARENTFB</span>}>
            {Inline({ status: (p: any) => <b>tokens:{p.stats && p.stats.tokens}</b> })}
          </Loading>
        ),
        [ServerComponentPlugin]
      );
      // The settled value belongs in the (streamed) MARKUP: the read
      // suspends, the boundary holds, the deferred content delivers 42.
      // Today the markup shows `tokens:` over an empty hole (the fill read
      // the raw promise) while the data script carries the resolution — the
      // adopted client settles, the page's markup never does.
      expect(visible(html)).toContain("tokens:42");
    }
  );

  test("a not-ready thunk arg is held by the fragment model and delivers settled (coarse holding)", async () => {
    const ServerComp = (props: any) => {
      const m = createMemo(() => wait(10).then(() => "READY"));
      return (
        <Loading fallback={<span>GENFB</span>}>
          <section>{props.status({ v: () => m() })}</section>
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

  test("a not-ready eager call arg suspends the component render and delivers settled (same coarse holding)", async () => {
    const ServerComp = (props: any) => {
      const m = createMemo(() => wait(10).then(() => "READY"));
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
