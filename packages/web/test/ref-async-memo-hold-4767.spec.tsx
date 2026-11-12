/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4767: a row mounts during an update that sends an async memo into flight.
// If that row's ref reads one of its own memos, the update must still commit —
// the <For> list driven by the async memo must advance, and later store writes
// must still reach it.
//
// Cause: refs run in the attribute effect's commit half with no owner. A
// sync memo created on that row is born held (A29) with only a staged value.
// An ownerless read of it threw NotReadyError (A19 exc. 1); the throw errored
// the effect mid-hold and the transaction never landed. Fix: serve the staged
// value when the ref's creating pass was born into that memo's hold (F-7).
import { describe, expect, test } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  For,
  Loading
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

describe("#4767: ref reading a memo on a row mounted under an async hold", () => {
  test("list advances after cart writes (ref reads own memo)", async () => {
    const c = document.body.appendChild(document.createElement("div"));
    const [cart, setCart] = createStore({ items: [] as number[] });
    try {
      const dispose = render(() => {
        const products = createMemo(
          async () => {
            cart.items.length;
            await Promise.resolve();
            return [1, 2, 3, 4];
          },
          { loadingValue: [] as number[] }
        );
        const visible = createMemo(() =>
          products()
            .filter(id => !cart.items.includes(id))
            .slice(0, 2)
        );
        function Card(props: { id: number }) {
          const label = createMemo(() => `product ${props.id}`);
          return <li ref={el => (el.title = label())}>{label()}</li>;
        }
        return (
          <>
            <p>
              cart: <span id="cart">{cart.items.join(",")}</span>
            </p>
            <Loading fallback={null}>
              <ul id="list">
                <For each={visible()}>{id => <Card id={id} />}</For>
              </ul>
            </Loading>
          </>
        );
      }, c);
      await tick();
      expect(c.querySelector("#list")!.textContent).toBe("product 1product 2");

      setCart(d => void d.items.push(1));
      await tick();
      expect(c.querySelector("#cart")!.textContent).toBe("1");
      expect(c.querySelector("#list")!.textContent).toBe("product 2product 3");

      setCart(d => void d.items.push(2));
      await tick();
      expect(c.querySelector("#cart")!.textContent).toBe("1,2");
      expect(c.querySelector("#list")!.textContent).toBe("product 3product 4");

      dispose();
    } finally {
      c.remove();
    }
  });

  // F-7: a ref whose creating pass is not born into the hold must not see a
  // born-held memo's staged value before that hold commits — even inside
  // runRefCallback. (Same-hold serve is covered by the cart/For test above
  // and by signals `ref-born-held-staged-4767`.)
  test("ref outside the hold does not see a born-held memo's staged value", async () => {
    const outside = document.body.appendChild(document.createElement("div"));
    const [x, setX] = createSignal(0);
    createRoot(() => {
      createRenderEffect(x, () => {});
    });
    flush();

    let release!: () => void;
    action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();

    let m!: () => string;
    createRoot(() => {
      m = createMemo(() => `v${x()}`);
    });

    let outsideSeen: string | "blocked" | undefined;
    try {
      const disposeOutside = render(
        () => (
          <div
            id="out"
            ref={el => {
              try {
                outsideSeen = m();
                el.title = outsideSeen;
              } catch {
                outsideSeen = "blocked";
              }
            }}
          />
        ),
        outside
      );
      flush();
      expect(outsideSeen).toBe("blocked");
      expect(outside.querySelector("#out")!.getAttribute("title")).toBeNull();

      release();
      await settle();
      expect(m()).toBe("v1");

      disposeOutside();
    } finally {
      outside.remove();
    }
  });
});
