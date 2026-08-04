/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * solidjs/solid#2968: an invoked occurrence's args record rides the document
 * as a data script, and nothing on the wire formally orders that script
 * before the event that triggers adoption. When adoption won the race,
 * `#resolveSlotRecord` returned undefined, `ctx.invoked` was false, and the
 * render-prop callback was inserted as reactive CONTENT — evaluated as a
 * zero-argument accessor. A callback that reads `props.id` then halted the
 * reactive system (`TypeError: Cannot read properties of undefined`).
 *
 * The fix: while the document may still deliver records (parser running —
 * `document.readyState === "loading"` — or fragments still pending), a
 * recordless adopt-time occurrence defers, the boundary re-drains `_$HY.r`
 * each beat, and classification happens with the record present. The
 * server-rendered DOM stays in place across the deferral, so the wait is
 * invisible. NOT gated on `_$HY.done`: holding classification until client
 * hydration completes pushes adopted mounts past the hydrate window (see
 * adopted-slot-live.spec).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  installServerComponents,
  createFrameHost,
  createJSONDataTable
} from "../../frames/src/client.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

const FID = "late-record/about";

describe("adopted invoked slot whose record script runs after adoption", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as any)._$HY;
    delete (globalThis as any)._$SC;
    document.body.innerHTML = "";
  });

  test("waits for the record instead of invoking the callback argless", async () => {
    // The document as the server left it: the boundary's markup has parsed,
    // but the `_$HY.r` data script carrying button#0's args has NOT executed
    // yet — the parser is still delivering, which in a real browser reads as
    // `document.readyState === "loading"` (jsdom reports "complete", so pin
    // the real signal).
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const container = document.createElement("div");
    container.innerHTML =
      `<dx-frame data-fid="${FID}" style="display:contents">` +
      "<section><h1>About</h1>" +
      "<!--slot:button#0:start--><button>Click me 10</button><!--slot:button#0:end-->" +
      "</section>" +
      "</dx-frame>";
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    installServerComponents(makeHost());

    const reads: number[] = [];
    const AboutUs = (globalThis as any)._$SC.r(FID);
    // The issue's shape: the callback dereferences props unconditionally. On
    // the broken path this evaluates with props undefined and the throw
    // halts the reactive system.
    const dispose = hydrate(
      () => (
        <AboutUs
          button={(props: { id: number }) => {
            reads.push(props.id);
            return <button>Click me {props.id}</button>;
          }}
        />
      ),
      container
    );
    flush();

    // The race moment: adoption ran, the record hasn't. Nothing may have
    // invoked the callback yet — the server-rendered button is still the
    // range's content.
    expect(reads).toEqual([]);
    expect(container.textContent).toContain("Click me 10");

    // The data script the parser was still owed.
    (globalThis as any)._$HY.r[`sc:slot:${FID}:button#0`] = { id: 10 };

    await settle();
    flush();
    await settle();
    flush();

    // Invoked exactly once, with real args.
    expect(reads).toEqual([10]);
    expect(container.textContent).toContain("Click me 10");

    dispose();
    container.remove();
  });
});
