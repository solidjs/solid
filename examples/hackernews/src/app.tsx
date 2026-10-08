// The client side of the server-components twin. Compare with
// ../hackernews-spa/src/app.tsx: same router, same routes, same boundary. What
// is missing here is the app itself — there are no story, comment, or list
// templates on this side, because that markup is returned by server components
// and arrives as HTML. All that ships is the router and the loading boundary;
// there are no client components, and the thread's collapse is a native
// `<details>`.
//
// Note there is no server-component API in this file. A `"use server"` call
// mounts as a route (`serverRouteComponent`) or through `dynamicComponent()`;
// the transport install lives in the generated entry.
import { createRouter, defineRoute, intentPreload } from "@solidjs/router";
import { Loading } from "solid-js";
import { dynamicComponent } from "@solidjs/web";
import Stories, { searchSchema } from "~/routes/stories";
import Story from "~/routes/story";
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

// The same route table as the SPA twin. Every screen is a server route: the
// router makes its call from the match — params, and the feeds' `page`
// through `searchSchema` — on navigation and on link hover alike.
// `intentPreload` is that hover (and focus, and touch); link preloading is
// opt-in as of router 2.0.0-next.38.
const Router = createRouter({
  preloadLinks: intentPreload(),
  routes: [
    defineRoute({
      path: "/:type?",
      matchFilters: { type: ["top", "new", "show", "ask", "job"] },
      search: searchSchema,
      component: Stories
    }),
    defineRoute({ path: "/stories/:id", component: Story }),
    defineRoute({ path: "/users/:id", component: User })
  ]
});

export default function App() {
  const Nav = dynamicComponent(() => getNav());
  return (
    <Router>
      {props => (
        <>
          <Nav />
          <div class="page">
            <Loading fallback={<div class="news-list-nav">Loading...</div>}>
              {props.children}
            </Loading>
          </div>
        </>
      )}
    </Router>
  );
}
