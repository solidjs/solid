/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import { createEffect, createSignal, flush } from "solid-js";
import { attribution } from "solid-js/attribution";

/**
 * Every JSX event reaches user code through the web runtime's two dispatch
 * sites — delegated (`onClick`) and direct (`onScroll`, bound tuples). Both
 * declare the interaction to the attribution engine, so a write made inside
 * a handler is stamped with the event and a description of what was hit.
 */

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
}

describe("interaction provenance", () => {
  test("a delegated onClick handler's write is stamped with the click and its target", () => {
    arm();
    const [n, setN] = createSignal(0, { name: "n" });
    let latest: any;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => {
      createEffect(n, () => {}, { name: "reader" });
      return (
        <button id="next" onClick={() => setN(v => v + 1)}>
          Next <span>→</span>
        </button>
      );
    }, container);
    flush();
    attribution.subscribe(e => {
      if (e.nodeName === "reader") latest = e;
    });

    container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();

    expect(latest.causes[0].origin).toMatchObject({
      kind: "interaction",
      name: "click",
      target: 'button#next "Next →"'
    });
    expect(typeof latest.causes[0].origin.at).toBe("number");
    expect(latest.interaction).toBe(latest.causes[0].origin);
    dispose();
    container.remove();
  });

  test("runtime-attached direct (non-delegated) handlers are stamped — plain and bound tuple", () => {
    arm();
    const [n, setN] = createSignal(0, { name: "n" });
    const seen: any[] = [];
    const container = document.createElement("div");
    // Non-literal handler expressions route through the runtime's addEvent
    // (literal ones compile to a bare addEventListener and are not stamped).
    const handlers = {
      plain: () => setN(v => v + 1),
      bound: [(delta: number) => setN(v => v + delta), 10] as const
    };
    const dispose = render(() => {
      createEffect(n, () => {}, { name: "reader" });
      return (
        <>
          <div class="plain" onScroll={handlers.plain} />
          <div class="bound" onScroll={handlers.bound as any} />
        </>
      );
    }, container);
    flush();
    attribution.subscribe(e => {
      if (e.nodeName === "reader") seen.push(e.causes[0].origin);
    });

    container.querySelector(".plain")!.dispatchEvent(new Event("scroll"));
    flush();
    container.querySelector(".bound")!.dispatchEvent(new Event("scroll"));
    flush();

    expect(seen).toEqual([
      expect.objectContaining({ kind: "interaction", name: "scroll", target: "div" }),
      expect.objectContaining({ kind: "interaction", name: "scroll", target: "div" })
    ]);
    expect(n()).toBe(11);
    dispose();
  });

  test("inputs are described by name, not text", () => {
    arm();
    const [q, setQ] = createSignal("", { name: "q" });
    let origin: any;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => {
      createEffect(q, () => {}, { name: "reader" });
      return <input name="search" onInput={e => setQ(e.currentTarget.value)} />;
    }, container);
    flush();
    attribution.subscribe(e => {
      if (e.nodeName === "reader") origin = e.causes[0].origin;
    });
    const input = container.querySelector("input")!;
    input.value = "solid";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(origin).toMatchObject({
      kind: "interaction",
      name: "input",
      target: "input[name=search]"
    });
    dispose();
    container.remove();
  });
});
