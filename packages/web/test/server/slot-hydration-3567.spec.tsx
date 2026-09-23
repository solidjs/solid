/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #3567 pair (see test/harness/slot-hydration-3567.tsx).
 * Renders every scenario with renderToString and writes the markup artifact
 * test/hydration/slot-hydration-3567.spec.tsx hydrates against the
 * dom-generate compilation of the same fixture. Also records the `_hk` keys
 * the server minted, in document order, so a key permutation is legible in
 * the artifact diff.
 *
 * Every render is captured on `OBSERVE.diagnostics`: a scenario that names a
 * `diagnostic` must raise exactly it (the shape the compiler leaves unscoped
 * by ruling — `UNSCOPED_HOLE_ALLOCATED_IDS`), and every other scenario must
 * raise nothing, so a scoped hole, a call hole, a component accessor, a
 * `children()` accessor and `<For>` rows are pinned as silent.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Errored, renderToString } from "@solidjs/web";
import { OBSERVE } from "solid-js";
import { scenarios } from "../harness/slot-hydration-3567.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  capture.stop();
  warn.mockRestore();
});

describe("JSX through a non-children prop (#3567) — server render", () => {
  for (const scenario of scenarios) {
    test(`${scenario.name}: renders and writes the artifact`, () => {
      const html = renderToString(() => <scenario.App />);
      expect(visibleText(html)).toBe(scenario.expectedText);
      const keys = [...html.matchAll(/<(\w+) _hk=([\w-]+)/g)].map(m => `${m[1]}:${m[2]}`);
      writeFileSync(
        resolve(artifactsDir, `slot-hydration-3567-${scenario.name}.json`),
        JSON.stringify({ name: scenario.name, html, keys }, null, 2)
      );

      const events = capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS");
      if (scenario.diagnostic) {
        expect(events).toHaveLength(1);
        const [event] = events;
        expect(event.kind).toBe("render");
        expect(event.severity).toBe("warn");
        // The bare identifier's function, the hole's position in its
        // template, the counter's next id when the hole was registered
        // (where the client builds it) and around the walk's evaluation.
        expect(event.data).toMatchObject({ name: "renderHead", hole: 1 });
        expect(event.data!.registered).not.toBe(event.data!.before);
        expect(event.data!.before).not.toBe(event.data!.after);
        expect(event.message).toContain("{renderHead()}");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("[UNSCOPED_HOLE_ALLOCATED_IDS]");
      } else {
        expect(events, `${scenario.name} must not raise UNSCOPED_HOLE_ALLOCATED_IDS`).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
      }
    });
  }

  test("UNSCOPED_HOLE_ALLOCATED_IDS reports a site once, however many rows evaluate it", () => {
    const Row = (props: any) => {
      const renderHead = () => props.header;
      return (
        <li>
          <b>{renderHead as unknown as any}</b>
          <i>{props.children}</i>
        </li>
      );
    };
    const html = renderToString(() => (
      <ul>
        {["a", "b", "c"].map(x => (
          <Row header={<span>{x}</span>}>{x}</Row>
        ))}
      </ul>
    ));
    expect(visibleText(html)).toBe("aabbcc");
    expect(capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS")).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // The finding is an allocation at a SHIFTED position, not an unscoped
  // allocation as such. A boundary's zero-arity fallback thunk is handed
  // back unresolved and built by the consuming hole on the enclosing counter
  // — the same walk-order-vs-statement-order shape — yet with nothing scoped
  // after it in the template both sides land on the same ids and the render
  // is silent (the parity harness pins that hydration). A scoped hole after
  // it reserves its slot before the walk reaches the thunk: reported.
  describe("a zero-arity boundary fallback thunk built by the consuming hole", () => {
    const Fallback = () => (
      <main>
        <button>fell</button>
      </main>
    );
    const Throws = (): never => {
      throw new Error("sync render failure");
    };
    const Inner = () => (
      <Errored fallback={() => <Fallback />}>
        <Throws />
      </Errored>
    );
    let error: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      error = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => error.mockRestore());

    test("is silent when nothing scoped follows it", () => {
      const html = renderToString(() => (
        <section>
          <Inner />
          <span>tail</span>
        </section>
      ));
      expect(visibleText(html)).toBe("felltail");
      expect(capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS")).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });

    test("is reported when a scoped hole follows it", () => {
      const App = (props: { title: string }) => (
        <section>
          <Inner />
          <span>{props.title}</span>
        </section>
      );
      const html = renderToString(() => <App title="t" />);
      expect(visibleText(html)).toBe("fellt");
      const events = capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS");
      expect(events).toHaveLength(1);
      expect(events[0].data!.registered).not.toBe(events[0].data!.before);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
