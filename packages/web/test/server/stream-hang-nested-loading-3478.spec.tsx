/**
 * @jsxImportSource @solidjs/web
 */
// Repro for solidjs/solid#3478: renderToStream never ends when a nested
// <Loading> settles BEFORE a sibling async read in the same parent fragment
// rejects. The two bounding variations from the issue are included as
// controls: they complete.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Loading, renderToStream } from "@solidjs/web";
import { OBSERVE, createMemo, type DiagnosticEvent } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  capture.stop();
  warn.mockRestore();
  error.mockRestore();
});
const byCode = (code: DiagnosticEvent["code"]) => capture.events.filter(e => e.code === code);

// Resolves with the joined output when the sink's `end()` fires, or with
// "TIMEOUT" after `limit` ms — a hung render must not hang the suite.
function renderOrTimeout(code: () => any, limit = 1000) {
  return new Promise<{ ended: boolean; html: string }>(resolve => {
    const chunks: string[] = [];
    const timer = setTimeout(() => resolve({ ended: false, html: chunks.join("") }), limit);
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        clearTimeout(timer);
        resolve({ ended: true, html: chunks.join("") });
      }
    });
  });
}

function makeApp(fastMs: number, badMs: number, fastMode: "settle" | "never" = "settle") {
  function Fast() {
    const fast = createMemo(async () => {
      if (fastMode === "never") return new Promise<string>(() => {});
      await delay(fastMs);
      return "early";
    });
    return <span>{fast()}</span>;
  }
  function Child() {
    const bad = createMemo(async () => {
      await delay(badMs);
      throw new Error("boom");
    });
    return (
      <div>
        <Loading fallback={<i>inner</i>}>
          <Fast />
        </Loading>
        {bad()}
      </div>
    );
  }
  return () => (
    <Loading fallback={<i>outer</i>}>
      <Child />
    </Loading>
  );
}

describe("#3478 renderToStream completion after a nested Loading settles before its parent fails", () => {
  test("hangs: inner fragment settles (5ms) before sibling read rejects (60ms)", async () => {
    const result = await renderOrTimeout(makeApp(5, 60));
    // The failure is seen once, routed to the client; nothing was abandoned
    // (the inner fragment had already settled).
    const contained = byCode("SSR_RENDER_ERROR_CONTAINED");
    expect(contained.map(e => [String((e.data as any).error), (e.data as any).handling])).toEqual([
      ["Error: boom", "client"]
    ]);
    expect(byCode("SSR_SUBTREE_ABANDONED").length).toBe(0);
    // Before the fix: `done(undefined, err)` threw a TypeError out of
    // replacePlaceholder (splicing the settled inner fragment's parked markup
    // into an undefined value), so `0_fr` never rejected, seroval's onDone
    // never fired and end() was never called.
    expect(result.html).toContain('$R[7],$R[11]=new Error("boom")');
    expect(result.ended).toBe(true);
  });

  test("control: sibling read rejects (5ms) before inner fragment settles (60ms)", async () => {
    const result = await renderOrTimeout(makeApp(60, 5));
    expect(byCode("SSR_RENDER_ERROR_CONTAINED").length).toBe(1);
    expect(result.ended).toBe(true);
  });

  test("control (#3165 shape): inner read never settles", async () => {
    const result = await renderOrTimeout(makeApp(0, 20, "never"));
    expect(byCode("SSR_RENDER_ERROR_CONTAINED").length).toBe(1);
    const abandoned = byCode("SSR_SUBTREE_ABANDONED");
    expect(abandoned.length).toBe(1);
    expect((abandoned[0].data as any).fragments).toBe(1);
    expect(result.ended).toBe(true);
  });
});
