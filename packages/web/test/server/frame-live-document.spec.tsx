/**
 * @jsxImportSource @solidjs/web
 */
// The document face of a LIVE server component (Stage 8 B3; RFC 11 §9.5,
// Server face 3). A `live`-declared component reaches the document render
// with the brand on its component function; the frame render turns it into
// a scope flag, and every async source read in that scope takes the hybrid
// path — first value into markup, iterator closed, no pump, no hold. The
// document completes; the standing render is the client's connection after
// hydration. Without the brand the same component pumps (the Stage 4 story,
// pinned in document-live-holes.spec).
import { describe, expect, test, vi } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo, OBSERVE } from "solid-js";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";

const LIVE_SOURCE = Symbol.for("solid.LiveSource");
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

/** A STANDING source: never ends on its own; records whether it was closed. */
function standing(label: string) {
  const state = { closed: false, pulls: 0 };
  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => {
          state.pulls++;
          return new Promise<IteratorResult<string>>(r =>
            setTimeout(() => r({ done: false, value: `${label}-${++i}` }), 2)
          );
        },
        return: () => {
          state.closed = true;
          return Promise.resolve({ done: true as const, value: undefined });
        }
      };
    }
  };
  return { iterable, state };
}

describe("document face — a live server component takes first values and completes", () => {
  test("a standing source inside a live-branded component: first value in the markup, iterator closed, document completes", async () => {
    const src = standing("room");
    const ServerComp = () => {
      const text = createMemo(() => src.iterable);
      return (
        <Loading fallback={<span>FB</span>}>
          <section>{text()}</section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "fld/live" }) as any;
    // What the in-process `live` wrapper does to the answer (brandLive).
    Inline[LIVE_SOURCE] = true;
    // Reaching the end of collect() IS the proof: a pumped standing source
    // would hold the document open forever.
    const html = await collect(() => Inline({}));

    expect(html).toContain("room-1");
    expect(html).not.toContain("room-2");
    expect(src.state.closed).toBe(true);
    expect(src.state.pulls).toBe(1);
  });

  test("the same component without the brand pumps (Stage 4 unchanged)", async () => {
    const src = standing("hold");
    let ended = false;
    const ServerComp = () => {
      const text = createMemo(() => src.iterable);
      return (
        <Loading fallback={<span>FB</span>}>
          <section>{text()}</section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "fld/plain" }) as any;
    const done = collect(() => Inline({})).then(() => (ended = true));
    await wait(40);
    // Still pumping: the document is held open by the standing source.
    expect(ended).toBe(false);
    expect(src.state.pulls).toBeGreaterThan(1);
    expect(src.state.closed).toBe(false);
    // Let the test end: close the source's consumer side by ending it.
    // (A standing source under an unbranded component is the authoring
    // error the safety cap covers; here we only pin that nothing changed.)
    src.state.closed = true;
    (src.iterable as any)[Symbol.asyncIterator] = () => ({
      next: () => Promise.resolve({ done: true, value: undefined })
    });
    await Promise.race([done, wait(200)]);
  });

  // The safety cap (RFC 11 §9.5, Server face 4; open (c) resolved as a fixed
  // dev-only check): the unbranded pump above is the authoring error, and
  // after 5s of a document render still pumping the runtime names it.
  test("an undeclared standing source pumping into a document render is named by SSR_UNDECLARED_LIVE_SOURCE after 5s; a live-branded one is not", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const slow = (label: string) => {
        const state = { closed: false };
        const iterable: AsyncIterable<string> = {
          [Symbol.asyncIterator]() {
            let i = 0;
            return {
              next: () =>
                new Promise<IteratorResult<string>>(r =>
                  setTimeout(() => r({ done: false, value: `${label}-${++i}` }), 500)
                ),
              return: () => {
                state.closed = true;
                return Promise.resolve({ done: true as const, value: undefined });
              }
            };
          }
        };
        return { iterable, state };
      };
      const make = (src: ReturnType<typeof slow>, id: string, live: boolean) => {
        const Room = () => {
          const text = createMemo(() => src.iterable);
          return <section>{text()}</section>;
        };
        const Inline = frameTransformDirectResult(Room, { id }) as any;
        if (live) Inline[LIVE_SOURCE] = true;
        return Inline;
      };
      const undeclared = slow("undeclared");
      const declared = slow("declared");
      const App = () => (
        <main>
          {make(undeclared, "fld/cap", false)({})}
          {make(declared, "fld/capped-live", true)({})}
        </main>
      );
      let ended = false;
      const done = collect(() => <App />).then(() => (ended = true));
      // The first values land; the undeclared source keeps the document open.
      await vi.advanceTimersByTimeAsync(600);
      expect(ended).toBe(false);
      expect(declared.state.closed).toBe(true);
      expect(capture.events.filter(e => e.code === "SSR_UNDECLARED_LIVE_SOURCE")).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(5000);
      const events = capture.events.filter(e => e.code === "SSR_UNDECLARED_LIVE_SOURCE");
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("ssr");
      expect(events[0].severity).toBe("warn");
      expect(events[0].data).toEqual({ afterMs: 5000 });
      // Located by owner (the inline call here has no component label of
      // its own; a compiled `<Room />` would add `<Room>`).
      expect(events[0].ownerPath).toEqual(["<App>"]);
      expect(events[0].message).toContain("Declare the server function live(...)");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("[SSR_UNDECLARED_LIVE_SOURCE]");

      // Let the test end: the document stays held (that is the point); the
      // render is abandoned with the test.
      vi.useRealTimers();
      await Promise.race([done, wait(20)]);
    } finally {
      capture.stop();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  test("a component nested inside a live one inherits the scope", async () => {
    const outer = standing("outer");
    const inner = standing("inner");
    const Inner = frameTransformDirectResult(
      () => {
        const t = createMemo(() => inner.iterable);
        return (
          <Loading fallback={<span>IFB</span>}>
            <em>{t()}</em>
          </Loading>
        );
      },
      { id: "fld/inner" }
    ) as any;
    const Outer = frameTransformDirectResult(
      () => {
        const t = createMemo(() => outer.iterable);
        return (
          <Loading fallback={<span>OFB</span>}>
            <section>
              {t()}
              {Inner({})}
            </section>
          </Loading>
        );
      },
      { id: "fld/outer" }
    ) as any;
    Outer[LIVE_SOURCE] = true;
    const html = await collect(() => Outer({}));

    expect(html).toContain("outer-1");
    expect(html).toContain("inner-1");
    expect(outer.state.closed).toBe(true);
    expect(inner.state.closed).toBe(true);
  });

  test("an UNBRANDED thenable-resolved stream inside a server component pumps (scope judged from the memo's owner, not the continuation's)", async () => {
    // Before the scope was read off the memo's owner, a stream arriving
    // through a promise was classified in a continuation with no current
    // owner: neither pumped nor closed. Pinned here as a fix.
    const ServerComp = () => {
      const text = createMemo(async () => {
        await wait(1);
        return (async function* () {
          yield "p-1";
          await wait(3);
          yield "p-2";
          await wait(3);
          yield "p-3";
        })() as any;
      });
      return (
        <Loading fallback={<span>FB</span>}>
          <section>{text()}</section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "fld/pumped" }) as any;
    const html = await collect(() => Inline({}));
    expect(html).toContain("p-1");
    // Later yields rode the channel as ops — the pump ran.
    expect(html).toContain("p-2");
    expect(html).toContain("p-3");
  });

  test("a live-branded thenable-resolved stream (async fn returning a generator) takes the first value too", async () => {
    const src = standing("then");
    const ServerComp = () => {
      const text = createMemo(async () => {
        await wait(1);
        return src.iterable as any;
      });
      return (
        <Loading fallback={<span>FB</span>}>
          <section>{text()}</section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "fld/then" }) as any;
    Inline[LIVE_SOURCE] = true;
    const html = await collect(() => Inline({}));
    expect(html).toContain("then-1");
    expect(src.state.closed).toBe(true);
  });
});
