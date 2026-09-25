// The app root: a router over routes.ts, under the tab's identity. Nothing
// here fetches; every read on the live page is a memo or projection over a
// server function.
import { createRouter } from "@solidjs/router";
import { Loading } from "solid-js";
import { IdentityProvider } from "~/lib/identity";
import { routes } from "~/routes";
import "./app.css";

const Router = createRouter({ routes });

export default function App() {
  return (
    <IdentityProvider>
      <Router>
        {props => (
          <Loading fallback={<div class="room muted">Loading…</div>}>{props.children}</Loading>
        )}
      </Router>
    </IdentityProvider>
  );
}
