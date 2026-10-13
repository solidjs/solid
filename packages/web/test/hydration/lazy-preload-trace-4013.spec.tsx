/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4013: hydration traces an adopted async memo with the global Promise
 * swapped for a never-settling stub. A lazy() loader that builds its promise
 * from the global Promise (Vite's __vitePreload does) returns that stub when
 * `.preload()` runs inside the traced compute. lazy() must not keep it as the
 * module load: `.preload()` after hydration has to settle.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createMemo, flush, isHydrating, lazy } from "solid-js";
import { hydrate } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("#4013: lazy().preload() first called under the hydration trace", () => {
  let dispose: (() => void) | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    await sleep(0);
    container?.remove();
    delete (globalThis as any)._$HY;
  });

  test("preload() after hydration resolves", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // renderToStream output for App below: the memo settled to "ready" on
    // the server and is serialized under its hydration id.
    container.innerHTML = "ready";
    const served: any = Promise.resolve("ready");
    served.s = 1;
    served.v = "ready";
    (globalThis as any)._$HY = {
      events: [],
      completed: new WeakSet(),
      r: { "0": served },
      fe() {}
    };

    let Lazy!: ReturnType<typeof lazy<any>>;
    function App() {
      Lazy = lazy(
        () => new Promise<any>(resolve => setTimeout(() => resolve({ default: () => "ok" }), 0))
      );
      const data = createMemo(async () => {
        await Lazy.preload();
        return "ready";
      });
      return <>{data()}</>;
    }

    dispose = hydrate(() => <App />, container);
    flush();
    // Adopted the serialized value (the client compute ran only as a trace).
    expect(container.textContent).toBe("ready");
    await sleep(10);
    flush();
    expect(isHydrating()).toBe(false);
    expect(container.textContent).toBe("ready");

    const settled = await Promise.race([
      Lazy.preload().then((mod: any) => mod.default()),
      sleep(50).then(() => "timeout")
    ]);
    expect(settled).toBe("ok");
  });
});
