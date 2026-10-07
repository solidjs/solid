// `page: compiled base server components`: the compiled counterpart of
// sc-base-app.js — a hydrating client (no client stores) that installs the
// frames transport and mounts one server component through
// `dynamicComponent()` over a server-function reference, inside the compiled
// shell of sc-shell.jsx (templates with ordinary attributes, a spread, For /
// Show / Loading / Errored, a lazy child). Compiled hydratable by the measured
// checkout's @solidjs/compiler, like the `app: compiled hydrating` scenario.
// The delta against the hand-written page is what the compiled templates
// retain of @solidjs/web — the attribute runtime and the hydratable walk
// helpers — plus the compiled app's own bytes (the `app` package).
import { hydrate, dynamicComponent } from "@solidjs/web";
import { installServerComponents } from "@solidjs/web/frames";
import { createServerReference } from "@solidjs/web/server-functions/client";
import Shell from "./sc-shell.jsx";

installServerComponents();
const getStory = createServerReference("story", "getStory");
const Story = dynamicComponent(() => getStory());

hydrate(
  () => (
    <Shell id={1}>
      <Story id={1} />
    </Shell>
  ),
  document.body
);
