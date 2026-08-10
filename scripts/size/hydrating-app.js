// The csr-app surface entered through hydrate() instead of render(): the
// SSR client entry with NO store usage. Guards that enableHydration() does
// not retain the store engine (store/reconcile/projection/optimistic) —
// store hydration is reached through adapters parameterized by the core
// primitive, so only importing a store primitive pays for it.
import { hydrate, Show, For, Loading, Errored } from "@solidjs/web";
import { createSignal, createMemo, lazy } from "solid-js";

const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-page.js"));
hydrate(() => {
  const d = createMemo(() => n() + 1);
  setN(1);
  return [d(), Show, For, Loading, Errored, Page];
}, document.body);
