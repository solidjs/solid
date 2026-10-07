// The base server-component page: a hydrating client (no client stores)
// that installs the frames transport and mounts one server component
// through `dynamicComponent()` over a server-function reference — the
// documented mount (2026-10-07; `dynamic()` would also carry the element
// runtime for its tag arm). This is the whole eager graph such a page ships
// — signals floor, solid-js hydration, the web runtime, the frames client
// and the server-function transport — with the seroval codec left lazy as
// it is in production. Unlike the "frames: eager client consumer" scenario,
// nothing is external here: this measures the page, not the package.
import { hydrate, Show, For, Loading, Errored, dynamicComponent } from "@solidjs/web";
import { createSignal, createMemo, lazy } from "solid-js";
import { installServerComponents } from "@solidjs/web/frames";
import { createServerReference } from "@solidjs/web/server-functions/client";

installServerComponents();
const getStory = createServerReference("story", "getStory");
const Story = dynamicComponent(() => getStory());
const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-page.js"));
hydrate(() => {
  const d = createMemo(() => n() + 1);
  setN(1);
  return [d(), Show, For, Loading, Errored, Page, Story];
}, document.body);
