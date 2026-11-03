/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4647: an async memo whose value the server could not serialize, after the
 * first flush (midstream; before it the render fails, see
 * stream-async-serialize-failure-4647.spec.tsx). The server rendered the
 * content and completed; its payload rejects the memo's key with a
 * serialization error naming it (Ryan's ruling, 2026-11-03). Hydrating, the
 * memo takes that rejection like any server-rejected key (#4273): it throws
 * into the nearest `<Errored>`, whose fallback replaces the server's content,
 * and nothing is fetched on hydration. (The record is left unmarked, so the
 * rejection lands after the claim pass, where the fallback can replace
 * markup that is the content's.) The fallback stays until reset() or
 * one of the memo's inputs changes; either reruns the memo as a client fetch,
 * which needs no serialization.
 *
 * Server markup and payload captured from renderToStream of the identical
 * components (stream-async-serialize-failure-4647.spec.tsx pins the server
 * side); only seroval's resolver factory is reformatted.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createMemo, createSignal, flush, enableHydration } from "solid-js";
import { Errored, hydrate } from "@solidjs/web";

enableHydration();

const RealPromise = Promise;
let runs = 0;
// The hydration dry run computes under a mock Promise: count real asks only.
function ask(sel: number) {
  if (Promise === RealPromise) runs++;
  return new Promise<string>(r => setTimeout(() => r(`pear ${sel}`), 1));
}
async function drain() {
  for (let i = 0; i < 3; i++) {
    await new RealPromise(r => setTimeout(r, 0));
    flush();
  }
}

const message = (key: string) =>
  `Serialization failed: the hydration value for key "${key}" could not be serialized on the server`;

/** The server's hydration script for one async key whose value failed to serialize. */
function payload(key: string) {
  return (
    '(self.$R=self.$R||{})[""]=[];' +
    `_$HY.r["${key}"]=$R[0]=($R[1]=($R[2]=() => {` +
    "const resolver = { p: 0, s: 0, f: 0 };" +
    "resolver.p = new Promise((resolve, reject) => { resolver.s = resolve; resolver.f = reject; });" +
    "return resolver;" +
    "})()).p;" +
    `$R[1].f(new Error(${JSON.stringify(message(key))}));`
  );
}

function serve(container: HTMLElement, html: string, key: string) {
  delete (globalThis as any).$R;
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
  (0, eval)(payload(key));
  // A rejected record needs a consumer until the memo reads it.
  (globalThis as any)._$HY.r[key].catch(() => {});
  container.innerHTML = html;
}

describe("#4647: a key that failed to serialize rejects into Errored on hydration", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container.innerHTML = "";
    runs = 0;
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  function app(setters: { sel?: (v: number) => void; reset?: () => void }) {
    return () => {
      const [sel, setSel] = createSignal(1);
      setters.sel = setSel;
      return (
        <main>
          <Errored
            fallback={(e: any, reset) => {
              setters.reset = reset;
              return <p>{e().message}</p>;
            }}
          >
            {(() => {
              const item = createMemo(() => ask(sel()));
              return <p>{item()}</p>;
            })()}
          </Errored>
        </main>
      );
    };
  }

  test("the fallback replaces the server's content, without a fetch; reset() recovers by a client run", async () => {
    serve(container, "<main _hk=0><p _hk=101>server value</p></main>", "100");
    const main = container.querySelector("main");
    const setters: { sel?: (v: number) => void; reset?: () => void } = {};
    dispose = hydrate(app(setters), container);
    await drain();
    expect(container.querySelector("main")).toBe(main);
    expect(container.textContent).toBe(message("100"));
    expect(runs).toBe(0);

    // The fallback holds: nothing reruns the memo on its own.
    await drain();
    expect(container.textContent).toBe(message("100"));
    expect(runs).toBe(0);

    setters.reset!();
    await drain();
    expect(runs).toBe(1);
    expect(container.querySelector("main")).toBe(main);
    expect(container.textContent).toBe("pear 1");
  });

  test("an input change recovers by a client run", async () => {
    serve(container, "<main _hk=0><p _hk=101>server value</p></main>", "100");
    const setters: { sel?: (v: number) => void; reset?: () => void } = {};
    dispose = hydrate(app(setters), container);
    await drain();
    expect(container.textContent).toBe(message("100"));
    expect(runs).toBe(0);

    setters.sel!(2);
    await drain();
    expect(runs).toBe(1);
    expect(container.textContent).toBe("pear 2");
  });

  test("a memo outside the boundary: its readers' Errored catches it, and an input change recovers", async () => {
    serve(container, "<main _hk=1><p _hk=200>server value</p></main>", "0");
    let setSel!: (v: number) => void;
    dispose = hydrate(() => {
      const [sel, _setSel] = createSignal(1);
      setSel = _setSel;
      const item = createMemo(() => ask(sel()));
      return (
        <main>
          <Errored fallback={(e: any) => <p>{e().message}</p>}>
            <p>{item()}</p>
          </Errored>
        </main>
      );
    }, container);
    await drain();
    expect(container.textContent).toBe(message("0"));
    expect(runs).toBe(0);

    setSel(3);
    await drain();
    expect(runs).toBe(1);
    expect(container.textContent).toBe("pear 3");
  });
});
