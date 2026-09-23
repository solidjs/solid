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
import { createSignal, OBSERVE } from "solid-js";
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
      const error = scenario.logsCaughtError
        ? vi.spyOn(console, "error").mockImplementation(() => {})
        : undefined;
      const html = renderToString(() => <scenario.App />);
      if (error) {
        // The boundary contained a render error (`SSR_RENDER_ERROR_CONTAINED`).
        expect(error).toHaveBeenCalled();
        error.mockRestore();
      }
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

  // A boundary's zero-arity fallback thunk (`fallback={() => <F />}`) is
  // resolved by `<Errored>` itself, inside the boundary's own scope — the
  // same one the `(err, reset) => X` form runs under — never handed back for
  // the consuming hole to build on the enclosing counter (#3620 surfaced the
  // permutation that produced when a scoped hole followed the boundary; the
  // ruling aligns it by construction, like `<Show>` resolving a function
  // child). Both shapes are silent, and the zero-arity form lays out the
  // ids of everything after it exactly as the two-arity form does.
  describe("a zero-arity boundary fallback thunk", () => {
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
    const InnerTwoArity = () => (
      <Errored fallback={(_err, _reset) => <Fallback />}>
        <Throws />
      </Errored>
    );
    const keysOf = (html: string) =>
      [...html.matchAll(/<(\w+) _hk=([\w-]+)/g)].map(m => `${m[1]}:${m[2]}`);
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

    test("is silent, aligned, when a scoped hole follows it", () => {
      const App = (props: { title: string }) => (
        <section>
          <Inner />
          <span>{props.title}</span>
        </section>
      );
      const html = renderToString(() => <App title="t" />);
      expect(visibleText(html)).toBe("fellt");
      expect(capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS")).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });

    test("lays out the same ids as the two-arity form, for itself and for following siblings", () => {
      const [count] = createSignal(3);
      const layout = (Boundary: () => any) => (props: { title: string; children?: any }) => (
        <section>
          <Boundary />
          <span>{props.title}</span>
          <b>{count()}</b>
          <p>{props.children}</p>
        </section>
      );
      const ZeroArity = layout(Inner);
      const TwoArity = layout(InnerTwoArity);
      const zero = renderToString(() => <ZeroArity title="t">c</ZeroArity>);
      const two = renderToString(() => <TwoArity title="t">c</TwoArity>);
      expect(visibleText(zero)).toBe("fellt3c");
      expect(zero).toBe(two);
      // Every keyed element — the fallback's own and the siblings' — carries
      // the same id in both renders; nothing of the fallback escaped to the
      // enclosing counter.
      const keys = keysOf(zero);
      expect(keys).toEqual(keysOf(two));
      expect(keys.some(k => k.startsWith("main:"))).toBe(true);
      expect(capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS")).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });

    // Directly in the element (no component between the boundary and the
    // hole that consumes it) — the same alignment.
    test("directly under the element, followed by a scoped hole", () => {
      const App = (props: { title: string }) => (
        <section>
          <Errored fallback={() => <Fallback />}>
            <Throws />
          </Errored>
          <span>{props.title}</span>
        </section>
      );
      const Two = (props: { title: string }) => (
        <section>
          <Errored fallback={(_e, _r) => <Fallback />}>
            <Throws />
          </Errored>
          <span>{props.title}</span>
        </section>
      );
      const zero = renderToString(() => <App title="t" />);
      expect(visibleText(zero)).toBe("fellt");
      expect(zero).toBe(renderToString(() => <Two title="t" />));
      expect(capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS")).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
