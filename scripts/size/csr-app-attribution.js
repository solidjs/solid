// The CSR app plus the attribution engine, enabled: what an observe-tier
// consumer that actually turns attribution on ships. The delta against the
// observe CSR scenario is the engine's whole cost.
import { render, Show, For, Loading, Errored } from "@solidjs/web";
import { createSignal, createMemo, lazy } from "solid-js";
import { attribution } from "solid-js/attribution";

attribution.enable({ log: false });
attribution.subscribe(e => console.log(attribution.format(e)));
const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-page.js"));
render(() => {
  const d = createMemo(() => n() + 1);
  setN(1);
  return [d(), Show, For, Loading, Errored, Page];
}, document.body);
