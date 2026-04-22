import { Loading } from "solid-js";
import { hydrate } from "@solidjs/web";
import Shell from "../shared/src/components/Shell";
import App from "../shared/src/components/App";

// Mirrors the string server entry: `renderToString` is synchronous, so the
// server wraps `<App />` in a `<Loading>` boundary to produce a fallback page
// for async routes. Hydration must render the same tree shape.
hydrate(
  () => (
    <Shell>
      <Loading fallback={<div>Loading…</div>}>
        <App />
      </Loading>
    </Shell>
  ),
  document
);
