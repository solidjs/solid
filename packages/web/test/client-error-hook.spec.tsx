/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The client error hook through the web runtime (the Sentry plan's client
 * twin of the server error hook): `render`/`hydrate`'s `onError` is this root's hook,
 * ahead of `configureClientErrors`'; an `<Errored>` under it that renders
 * its fallback reports once with the component labels this tier keeps; a
 * root that passes no hook reports to the ambient one.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, Errored } from "@solidjs/web";
import {
  configureClientErrors,
  createMemo,
  createSignal,
  flush,
  resetErrorHalt,
  type ClientErrorContext
} from "solid-js";

type Call = { error: unknown; context: ClientErrorContext };
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  configureClientErrors({ onError: undefined });
  resetErrorHalt();
  vi.restoreAllMocks();
});

function mount(code: () => any, onError?: (e: unknown, c: ClientErrorContext) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  disposers.push(render(code, container, undefined, onError ? { onError } : {}));
  flush();
  return container;
}

describe("render's onError", () => {
  test("an <Errored> fallback under the root reports once, with the component labels", () => {
    const calls: Call[] = [];
    const boom = new Error("boom");
    const [fail, setFail] = createSignal(false);
    function Widget() {
      // A reactive read: the component body runs once, the memo re-throws.
      const text = createMemo(
        () => {
          if (fail()) throw boom;
          return "content";
        },
        { name: "text" }
      );
      return <p>{text()}</p>;
    }
    function App() {
      return (
        <Errored fallback={<p>fallback</p>}>
          <Widget />
        </Errored>
      );
    }
    const container = mount(
      () => <App />,
      (error, context) => {
        calls.push({ error, context });
      }
    );
    expect(container.textContent).toBe("content");
    expect(calls).toHaveLength(0);

    setFail(true);
    flush();
    expect(container.textContent).toBe("fallback");
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    // Where it broke: the memo that threw, under its component (the
    // compiler's inner memos ride along by their default name); where it
    // was met: the boundary. The dev tier labels component owners.
    expect(calls[0].context.ownerPath).toEqual([
      "<App>",
      "<Errored>",
      "computed",
      "<Widget>",
      "text"
    ]);
    expect(calls[0].context.boundaryPath).toEqual(["<App>", "<Errored>"]);
  });

  test("the root's hook wins over the ambient one; a root without one reports ambiently", () => {
    const ambient: Call[] = [];
    const mine: Call[] = [];
    configureClientErrors({
      onError: (error, context) => {
        ambient.push({ error, context });
      }
    });
    function Bad(): any {
      throw new Error("boom");
    }
    const app = () => (
      <Errored fallback={<p>fallback</p>}>
        <Bad />
      </Errored>
    );
    mount(app, (error, context) => {
      mine.push({ error, context });
    });
    expect(mine).toHaveLength(1);
    expect(ambient).toHaveLength(0);

    mount(app);
    expect(ambient).toHaveLength(1);
    expect(mine).toHaveLength(1);
  });
});
