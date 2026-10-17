/**
 * @jsxImportSource @solidjs/web
 *
 * Dependency edges under deferred hydration. The route shell owns shared
 * state and provides it through context; the server component places slot
 * fills that read some of it:
 *   - four `item` fills read `currency` and their own click counter;
 *   - `cart` reads `cart`;
 *   - `store` reads a store (writes to a store carry no signal name);
 *   - `wide` reads a projection derived from `wideSource` (a projection's
 *     readers are not tracked, so `wideSource` is wide);
 *   - `derived` reads a writable derived signal (no name either);
 *   - `late` runs a client-source memo over `cart` (a read the server never
 *     sees), so it mounts on every named write.
 * Every fill notes its mount in `mounted`.
 *
 * `drift` (client only) creates one extra plain signal in the shell ahead
 * of the shared ones, so the client names them differently from the server.
 *
 * Shared by test/server/frame-dependency-edges.spec.tsx (writes the
 * artifact) and test/hydration/frame-dependency-edges.spec.tsx.
 */
import {
  createContext,
  createMemo,
  createProjection,
  createSignal,
  createStore,
  Loading,
  untrack,
  useContext,
  type Accessor,
  type Setter
} from "solid-js";
import { dynamic, type JSX } from "@solidjs/web";

export const FID = "frame-edges/page";
export const ARGS = ["page"];
export const ITEMS = ["a", "b", "c", "d"];

export type Shop = {
  cart: Accessor<number>;
  setCart: Setter<number>;
  currency: Accessor<string>;
  setCurrency: Setter<string>;
  store: { n: number };
  setStore: (fn: (s: { n: number }) => void) => void;
  setWideSource: Setter<number>;
  wide: { v: number };
  derived: Accessor<number>;
  setDerived: Setter<number>;
};
export const ShopCtx = createContext<Shop>();

/** Each fill mount, by name; the last shell's state, for the test's writes. */
export const mounted: string[] = [];
export let shop: Shop;

export function Shell(props: { drift?: boolean; children: JSX.Element }) {
  if (props.drift) createSignal("client only");
  const [cart, setCart] = createSignal(0);
  const [currency, setCurrency] = createSignal("USD");
  const [wideSource, setWideSource] = createSignal(1);
  const [store, setStore] = createStore({ n: 0 });
  const wide = createProjection<{ v: number }>(
    d => {
      d.v = wideSource();
    },
    { v: 0 }
  );
  const [derived, setDerived] = createSignal(() => 0);
  shop = {
    cart,
    setCart,
    currency,
    setCurrency,
    store,
    setStore,
    setWideSource,
    wide,
    derived,
    setDerived
  };
  return <ShopCtx value={shop}>{props.children}</ShopCtx>;
}

export function Item(props: { id: string }) {
  const s = useContext(ShopCtx)!;
  const [clicks, setClicks] = createSignal(0);
  mounted.push(`item:${untrack(() => props.id)}`);
  return (
    <button id={`item-${props.id}`} onClick={() => setClicks(c => c + 1)}>
      {props.id}:{s.currency()}:{clicks()}
    </button>
  );
}
export function Cart() {
  const s = useContext(ShopCtx)!;
  mounted.push("cart");
  return <p id="cart">cart:{s.cart()}</p>;
}
export function StoreView() {
  const s = useContext(ShopCtx)!;
  mounted.push("store");
  return <p id="store">store:{s.store.n}</p>;
}
export function WideView() {
  const s = useContext(ShopCtx)!;
  mounted.push("wide");
  return <p id="wide">wide:{s.wide.v}</p>;
}
export function DerivedView() {
  const s = useContext(ShopCtx)!;
  mounted.push("derived");
  return <p id="derived">derived:{s.derived()}</p>;
}
export function Late() {
  const s = useContext(ShopCtx)!;
  const doubled = createMemo(() => s.cart() * 2, { ssrSource: "client", loadingValue: 0 } as any);
  mounted.push("late");
  return <p id="late">late:{doubled()}</p>;
}

/** The page: the server component under a `Loading` inside the shell, mounted through `dynamic`. */
export function makeApp(source: () => any, options: { drift?: boolean } = {}) {
  return () => {
    const Page = dynamic(source);
    return (
      <Shell drift={options.drift}>
        <Loading fallback={<p class="fb">shell-fallback</p>}>
          <Page
            item={(p: any) => <Item {...p} />}
            cart={() => <Cart />}
            store={() => <StoreView />}
            wide={() => <WideView />}
            derived={() => <DerivedView />}
            late={() => <Late />}
          />
        </Loading>
      </Shell>
    );
  };
}

/** The server component: the four items, then the cart sidebar's widgets. */
export function makePageComponent() {
  return (props: { item: any; cart: any; store: any; wide: any; derived: any; late: any }) => (
    <div id="page">
      <ul>
        {ITEMS.map(id => (
          <li>
            <props.item id={id} />
          </li>
        ))}
      </ul>
      <aside>
        <props.cart />
        <props.store />
        <props.wide />
        <props.derived />
        <props.late />
      </aside>
    </div>
  );
}
