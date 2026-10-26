/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4273: an `<Errored>` the server rendered in its error state. The client
 * runs the content in the hydration pass itself — its data adopted by id,
 * claiming no DOM — so the error the boundary holds is the client's own, it
 * tracks the content's inputs, and nothing the server answered is fetched
 * again. The fallback claims the server's markup.
 *
 * Server markup captured from renderToStream of the identical components.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createMemo, createSignal, flush, enableHydration } from "solid-js";
import { Errored, hydrate } from "@solidjs/web";

enableHydration();

const RealPromise = Promise;
const settled = <T,>(v: T) => Object.assign(RealPromise.resolve(v), { s: 1, v });
let runs = 0;
// The hydration dry run computes under a mock Promise: count real asks only.
function ask(sel: number) {
  if (Promise === RealPromise) runs++;
  return new Promise<string | null>(r => setTimeout(() => r(sel === 4 ? null : "pear"), 1));
}
async function drain() {
  for (let i = 0; i < 3; i++) {
    await new RealPromise(r => setTimeout(r, 0));
    flush();
  }
}

describe("#4273: Errored hydrated in its error state", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container.innerHTML = "";
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  test("content computations outside the boundary: recovers when the input changes", async () => {
    runs = 0;
    let setSel!: (v: number) => void;
    (globalThis as any)._$HY = {
      events: [],
      completed: new WeakSet(),
      r: { "0": settled(null), "3": new Error("item 4 not found") }
    };
    container.innerHTML = "<main _hk=2><p _hk=40>item 4 not found</p></main>";
    const p = container.querySelector("p");
    dispose = hydrate(() => {
      const [sel, _setSel] = createSignal(4);
      setSel = _setSel;
      const item = createMemo(() => ask(sel()));
      const shown = createMemo(() => {
        const v = item();
        if (v == null) throw new Error(`item ${sel()} not found`);
        return v;
      });
      return (
        <main>
          <Errored fallback={(e: any) => <p>{e().message}</p>}>
            <p>{shown()}</p>
          </Errored>
        </main>
      );
    }, container);
    await drain();
    expect(container.querySelector("p")).toBe(p);
    expect(container.textContent).toBe("item 4 not found");
    expect(runs).toBe(0);

    setSel(3);
    await drain();
    expect(container.textContent).toBe("pear");
  });

  test("content computations inside the boundary adopt their serialized values", async () => {
    runs = 0;
    let setSel!: (v: number) => void;
    (globalThis as any)._$HY = {
      events: [],
      completed: new WeakSet(),
      r: { "100": settled(null), "1": new Error("item 4 not found") }
    };
    container.innerHTML = "<main _hk=0><p _hk=20>item 4 not found</p></main>";
    const p = container.querySelector("p");
    dispose = hydrate(() => {
      const [sel, _setSel] = createSignal(4);
      setSel = _setSel;
      return (
        <main>
          <Errored fallback={(e: any) => <p>{e().message}</p>}>
            {(() => {
              const item = createMemo(() => ask(sel()));
              const shown = createMemo(() => {
                const v = item();
                if (v == null) throw new Error(`item ${sel()} not found`);
                return v;
              });
              return <p>{shown()}</p>;
            })()}
          </Errored>
        </main>
      );
    }, container);
    await drain();
    expect(container.querySelector("p")).toBe(p);
    expect(container.textContent).toBe("item 4 not found");
    expect(runs).toBe(0);

    setSel(3);
    await drain();
    expect(container.textContent).toBe("pear");
  });

  // OPEN in the prototype: the content's fresh nodes reach the parent's
  // insert during the claim pass, which keeps the server's nodes for a
  // render that never entered the DOM (insertExpression's phantom rule), so
  // the server's fallback stays on screen over live, detached content.
  test.fails("content that succeeds on the client replaces the server's fallback", async () => {
    (globalThis as any)._$HY = {
      events: [],
      completed: new WeakSet(),
      r: { "1": new Error("server only") }
    };
    container.innerHTML = "<main _hk=0><p _hk=20>server only</p></main>";
    const main = container.querySelector("main");
    dispose = hydrate(
      () => (
        <main>
          <Errored fallback={(e: any) => <p>{e().message}</p>}>
            <p>client</p>
          </Errored>
        </main>
      ),
      container
    );
    await drain();
    expect(container.querySelector("main")).toBe(main);
    expect(container.innerHTML).toBe('<main _hk="0"><p>client</p></main>');
  });
});
