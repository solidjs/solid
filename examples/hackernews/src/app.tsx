// The client side of the server-components twin. Compare with
// ../hackernews-spa/src/app.tsx: same router, same routes, same boundary. What
// is missing here is the app itself — there are no story, comment, or list
// templates on this side, because that markup is returned by server components
// and arrives as HTML. All that ships is the router, the boundary, and the one
// component that owns state (Toggle).
//
// Note there is no server-component API in this file. `dynamic()` over a
// `"use server"` call is the entire client surface (see the routes); the
// transport install lives in the generated entry.
import { createRouter, defineRoute } from "@solidjs/router";
import { Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { navView } from "~/lib/views";
import Stories, { preload as preloadStories } from "~/routes/stories";
import Story, { preload as preloadStory } from "~/routes/story";
import User, { preload as preloadUser } from "~/routes/user";
import "./app.css";

// `defineRoute` types each route's component and preload from its own `path`,
// so the `:id` routes read `params.id` as `string` rather than
// `string | undefined`. The preloads make link hover/focus fetch the route's
// server component ahead of the click — same wiring as the SPA twin, and the
// preloaded boundary stays isolated until navigation actually reads it.
const Router = createRouter({
  routes: [
    defineRoute({
      path: ["/", "/top", "/new", "/show", "/ask", "/job"],
      component: Stories,
      preload: preloadStories
    }),
    defineRoute({ path: "/stories/:id", component: Story, preload: preloadStory }),
    defineRoute({ path: "/users/:id", component: User, preload: preloadUser })
  ]
});

export default function App() {
  // The nav is a server component too. It is static chrome, so there is no
  // reason for its markup to ship as client templates at all — and with no
  // reactive input it is never refetched: it renders inline at t=0, the client
  // adopts it, and navigation leaves it alone.
  const Nav = dynamic(() => navView());
  return (
    <Router>
      {props => (
        <>
          <Loading fallback={<div class="news-list-nav">Loading...</div>}>
            <Nav />
          </Loading>
          <Loading fallback={<div class="news-list-nav">Loading...</div>}>{props.children}</Loading>
        </>
      )}
    </Router>
  );
}
