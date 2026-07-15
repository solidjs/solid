// A representative CSR app surface: flow components, boundaries, lazy.
import { render, Show, For, Loading, Errored } from "@solidjs/web";
import { createSignal, createMemo, lazy } from "solid-js";

const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-page.js"));
render(() => {
  const d = createMemo(() => n() + 1);
  setN(1);
  return [d(), Show, For, Loading, Errored, Page];
}, document.body);
