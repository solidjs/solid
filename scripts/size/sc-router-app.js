// The base server-component page under a router: sc-base-app plus what an
// application page ships to route — `@solidjs/router` 2.0 (the Solid 2 line,
// `2.0.0-next.*`, installed by this directory's own package.json; its
// `solid-js` / `@solidjs/web` imports route to the dists through pageAlias
// like every other import here). `createRouter` with two routes — one with a
// `preload`, one whose component is the page's `lazy()` chunk — rendered as
// the hydrated root through the instance with a render-prop layout, and
// `useNavigate` read in a route component. 2.0 has no `<A>`: anchors are
// plain `<a>`, claimed by the router through `registerElementClaim` and
// intercepted by delegation, so the link runtime is the router's own
// (`setupLinkClaims`, `setupNativeEvents`) and is retained by the instance.
// The instance, its routes and the route components are all reachable from
// the root, so the router's runtime — matching, the integration, the
// context, preloading, link claims — is retained, not just its imports.
import { hydrate, Show, For, Loading, Errored, dynamic, createComponent } from "@solidjs/web";
import { createSignal, createMemo, lazy } from "solid-js";
import { installServerComponents } from "@solidjs/web/frames";
import { createServerReference } from "@solidjs/web/server-functions/client";
import { createRouter, useNavigate } from "@solidjs/router";

installServerComponents();
const getStory = createServerReference("story", "getStory");
const Story = dynamic(() => getStory());
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
  const d = createMemo(() => n() + 1);
  setN(1);
  return [
    d(),
    Show,
    For,
    Loading,
    Errored,
    Story,
    createComponent(Router, { children: p => p.children })
  ];
}, document.body);
