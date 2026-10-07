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
 * The fix (as it stands after frames A4, S-record): the occurrence's name
 * decides its class — a called occurrence (`button#0`) found without its
 * record WAITS, never classifies as direct-insert — and the document
 * DECLARES the record at the marker: `_$HY.r["sc:slot:…"]` is a pending
 * value from the shell's data script on, settled with the args by the
 * script the parser is still owed (the shape a fragment's `<key>_fr`
 * takes). The adopting boundary awaits the declaration through `.then`,
 * so the settle is a write the frame re-syncs on — no poll, no beat. The
 * server-rendered DOM stays in place across the wait, so it is invisible.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";

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
      `<solid-frame data-fid="${FID}" style="display:contents">` +
      "<section><h1>About</h1>" +
      "<!--slot:button#0:start--><button>Click me 10</button><!--slot:button#0:end-->" +
      "</section>" +
      "</solid-frame>";
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    // The record, DECLARED at the marker by the shell's data script: a
    // pending promise under its key, settled — and stamped `s`/`v` as the
    // hydration serializer's resolve helper does — by the later script.
    let settleRecord!: (args: unknown) => void;
    const record: any = new Promise(resolve => {
      settleRecord = (args: unknown) => {
        record.s = 1;
        record.v = args;
        resolve(args);
      };
    });
    (globalThis as any)._$HY.r[`sc:slot:${FID}:button#0`] = record;
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

    // The race moment: adoption ran, the record's settle hasn't. Nothing may
    // have invoked the callback yet — the server-rendered button is still
    // the range's content.
    expect(reads).toEqual([]);
    expect(container.textContent).toContain("Click me 10");

    // The data script the parser was still owed: the declaration settles.
    settleRecord({ id: 10 });

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
