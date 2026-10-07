// The live server-component page under a router: sc-live-app plus the same
// `@solidjs/router` 2.0 composition as sc-router-app (createRouter with two
// routes — one `preload`, one lazy — the instance as the hydrated root,
// `useNavigate` in a route component). See sc-router-app.js for why the
// router's runtime, not just its imports, is retained.
import {
  hydrate,
  Show,
  For,
  Loading,
  Errored,
  dynamicComponent,
  createComponent
} from "@solidjs/web";
import { createSignal, createMemo, action, isPending, latest, lazy } from "solid-js";
import { installServerComponents } from "@solidjs/web/frames";
import { createServerReference, live, GET } from "@solidjs/web/server-functions/client";
import { createRouter, useNavigate } from "@solidjs/router";

installServerComponents();
const getStory = live(GET(createServerReference("story", "getStory")));
const Story = dynamicComponent(() => getStory());
const send = action(async () => {});
const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-page.js"));
function Home(props) {
  const navigate = useNavigate();
  return [props.children, () => navigate("/story/1")];
}
const Router = createRouter({
  routes: [
    { path: "/", component: Home, preload: ({ params, intent }) => void (params, intent) },
    { path: "/story/:id", component: Page }
  ]
});
hydrate(() => {
  const d = createMemo(() => n() + (isPending(n) ? 1 : 0) + latest(n));
  setN(1);
  return [
    d(),
    Show,
    For,
    Loading,
    Errored,
    Story,
    send,
    createComponent(Router, { children: p => p.children })
  ];
}, document.body);
