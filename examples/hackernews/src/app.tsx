// The client side of the server-components twin. Compare with
// ../hackernews-spa/src/app.tsx: same router, same routes, same boundary. What
// is missing here is the app itself — there are no story, comment, or list
// templates on this side, because that markup is returned by server components
// and arrives as HTML. All that ships is the router, the boundaries, and the
// thread's collapse fill (routes/story.tsx); there are no client components.
//
// Note there is no server-component API in this file. A `"use server"` call
// mounts as a route (`serverRouteComponent`) or through `dynamic()`; the
// transport install lives in the generated entry.
import { createRouter, defineRoute } from "@solidjs/router";
import { Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import Stories, { searchSchema } from "~/routes/stories";
import Story, { preload as preloadStory } from "~/routes/story";
import User from "~/routes/user";
import "./app.css";

// The nav is a server component too. It is static chrome, so there is no
// reason for its markup to ship as client templates at all — and with no
// reactive input it is never refetched: it renders inline at t=0, the client
// adopts it, and navigation leaves it alone. No `Loading` around it: it does
// no I/O, so the shell waits on it at no cost.
async function getNav() {
  "use server";
  return () => (
    <header class="header">
      <nav class="inner">
        <a href="/">
          <strong>HN</strong>
        </a>
        <a href="/new">
          <strong>New</strong>
        </a>
        <a href="/show">
          <strong>Show</strong>
        </a>
        <a href="/ask">
          <strong>Ask</strong>
        </a>
        <a href="/job">
          <strong>Jobs</strong>
        </a>
        <a class="github" href="http://github.com/solidjs/solid" target="_blank" rel="noreferrer">
          Built with Solid
        </a>
      </nav>
    </header>
  );
}

// The same route table as the SPA twin. The feeds and the user page are
// server routes: the router makes their calls from the match — params, and
// the feeds' `page` through `searchSchema` — on navigation and on link
// hover alike. The story route has a client half (the collapse fill), so it
// is an ordinary route component with its own `preload`.
const Router = createRouter({
  routes: [
    defineRoute({
      path: "/:type?",
      matchFilters: { type: ["top", "new", "show", "ask", "job"] },
      search: searchSchema,
      component: Stories
    }),
    defineRoute({ path: "/stories/:id", component: Story, preload: preloadStory }),
    defineRoute({ path: "/users/:id", component: User })
  ]
});

export default function App() {
  const Nav = dynamic(() => getNav());
  return (
    <Router>
      {props => (
        <>
          <Nav />
          <Loading fallback={<div class="news-list-nav">Loading...</div>}>{props.children}</Loading>
        </>
      )}
    </Router>
  );
}
