// The client side of the SSR-SPA baseline: every template lives here, so the
// comment tree renders in the browser from JSON and all of these components
// must ship to it in order to hydrate. The server-components twin
// (../hackernews) renders the same routes with the same markup — only the
// static parts come back as server components there, so they arrive as HTML
// once and never as data.
import { createRouter, defineRoute, useIsRouting } from "@solidjs/router";
import { Loading } from "solid-js";
import Nav from "~/components/nav";
import Stories, { preload as preloadStories } from "~/routes/stories";
import Story, { preload as preloadStory } from "~/routes/story";
import User, { preload as preloadUser } from "~/routes/user";
import "./app.css";

// Explicit route tree rather than the file routes a metaframework provides:
// this example is plain Vite. The same table as the server-components twin:
// the feed is an optional param the filter limits to the five feed names.
// `defineRoute` types each route's component and preload from its own `path`,
// so the `:id` routes read `params.id` as `string` rather than
// `string | undefined`.
const Router = createRouter({
  routes: [
    defineRoute({
      path: "/:type?",
      matchFilters: { type: ["top", "new", "show", "ask", "job"] },
      component: Stories,
      preload: preloadStories
    }),
    defineRoute({ path: "/stories/:id", component: Story, preload: preloadStory }),
    defineRoute({ path: "/users/:id", component: User, preload: preloadUser })
  ]
});

export default function App() {
  return (
    <Router>
      {props => {
        // A navigation keeps the current page up, dimmed, until the next one
        // is ready, instead of blanking it.
        const isRouting = useIsRouting();
        return (
          <>
            <Nav />
            <div class={["page", { routing: isRouting() }]}>
              <Loading fallback={<div class="news-list-nav">Loading...</div>}>
                {props.children}
              </Loading>
            </div>
          </>
        );
      }}
    </Router>
  );
}
