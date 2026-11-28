// csr-app.js with its lazy route using the store primitives: the eager chunk
// must stay at csr-app.js's size, the store engine going to the lazy chunk.
import { render, Show, For, Loading, Errored } from "@solidjs/web";
import { createSignal, createMemo, lazy } from "solid-js";

const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-store-page.js"));
render(() => {
  const d = createMemo(() => n() + 1);
  setN(1);
  return [d(), Show, For, Loading, Errored, Page];
}, document.body);
