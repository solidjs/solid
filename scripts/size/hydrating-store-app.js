// The hydrating surface WITH every store-primitive family (store,
// optimistic store, projection, optimistic signal): the companion to
// hydrating-app.js. This one SHOULD carry the store engine and its
// hydration adapters — the pair keeps "no-store hydrating apps shake the
// engine" honest without letting the with-store path quietly lose its
// hydration behavior (the adapters ride the wrappers, not enableHydration).
import { hydrate, Show, For, Loading, Errored } from "@solidjs/web";
import {
  createSignal,
  createMemo,
  createStore,
  createOptimisticStore,
  createProjection,
  createOptimistic,
  lazy
} from "solid-js";

const [n, setN] = createSignal(0);
const [items] = createStore(async () => [{ id: n() }], []);
const [opt] = createOptimisticStore(async () => [{ id: n() }], []);
const proj = createProjection(
  d => {
    d.total = items.length + opt.length;
  },
  { total: 0 }
);
const [o] = createOptimistic(() => n());
const Page = lazy(() => import("./lazy-page.js"));
hydrate(() => {
  const d = createMemo(() => n() + o() + proj.total);
  setN(1);
  return [d(), Show, For, Loading, Errored, Page];
}, document.body);
