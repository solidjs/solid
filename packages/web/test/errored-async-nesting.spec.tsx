/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #2821: an error thrown by an async re-fetch must reach a wrapping <Errored>
 * regardless of nesting order with <Loading>.
 *
 * The `Errored > Loading > read` order regressed before the boundary
 * notify-through work (219e30c8 / #2809): the error notification stopped at
 * the Loading boundary and the DOM kept showing the stale committed value.
 * `Loading > Errored > read` worked. Both orders are pinned here, for both
 * the refresh-error case (bug) and the pre-resolve error case (control).
 */
import { describe, expect, test } from "vitest";
import { render } from "../src/index.js";
import { createMemo, createSignal, Errored, Loading, flush } from "solid-js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
  await Promise.resolve();
  flush();
}

function setup() {
  const [version, setVersion] = createSignal(0);
  let current = deferred<number>();
  const data = createMemo(async () => {
    const v = version();
    const value = await current.promise;
    return value + v;
  });
  return {
    data,
    refresh: () => {
      current = deferred<number>();
      setVersion(v => v + 1);
    },
    resolve: (v: number) => current.resolve(v),
    reject: (e: unknown) => current.reject(e)
  };
}

describe("#2821: async error reaches a wrapping Errored across Loading", () => {
  test("Errored > Loading > read — error on refresh after successful load", async () => {
    const div = document.createElement("div");
    const { data, refresh, resolve, reject } = setup();

    const dispose = render(
      () => (
        <Errored fallback={e => <div>error:{String((e() as any)?.message ?? e())}</div>}>
          <Loading fallback={<div>loading</div>}>
            <div>value:{data()}</div>
          </Loading>
        </Errored>
      ),
      div
    );
    flush();
    expect(div.textContent).toBe("loading");

    resolve(1);
    await settle();
    expect(div.textContent).toBe("value:1");

    refresh();
    flush();
    reject(new Error("boom"));
    await settle();
    expect(div.textContent).toBe("error:boom");
    dispose();
  });

  test("Loading > Errored > read — error on refresh after successful load", async () => {
    const div = document.createElement("div");
    const { data, refresh, resolve, reject } = setup();

    const dispose = render(
      () => (
        <Loading fallback={<div>loading</div>}>
          <Errored fallback={e => <div>error:{String((e() as any)?.message ?? e())}</div>}>
            <div>value:{data()}</div>
          </Errored>
        </Loading>
      ),
      div
    );
    flush();
    expect(div.textContent).toBe("loading");

    resolve(1);
    await settle();
    expect(div.textContent).toBe("value:1");

    refresh();
    flush();
    reject(new Error("boom"));
    await settle();
    expect(div.textContent).toBe("error:boom");
    dispose();
  });

  test("both orders — rejection before first resolution (control)", async () => {
    const div = document.createElement("div");
    const a = setup();
    const b = setup();

    const dispose = render(
      () => (
        <div>
          <Errored fallback={<span>errA</span>}>
            <Loading fallback={<span>loadA</span>}>
              <span>valA:{a.data()}</span>
            </Loading>
          </Errored>
          <Loading fallback={<span>loadB</span>}>
            <Errored fallback={<span>errB</span>}>
              <span>valB:{b.data()}</span>
            </Errored>
          </Loading>
        </div>
      ),
      div
    );
    flush();
    expect(div.textContent).toBe("loadAloadB");

    a.reject(new Error("boomA"));
    b.reject(new Error("boomB"));
    await settle();
    expect(div.textContent).toBe("errAerrB");
    dispose();
  });
});
