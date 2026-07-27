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
import { createRouter } from "@solidjs/router";
import { Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { navView } from "~/lib/views";
import Stories from "~/routes/stories";
import Story from "~/routes/story";
import User from "~/routes/user";
import "./app.css";

const Router = createRouter({
  routes: [
    { path: ["/", "/top", "/new", "/show", "/ask", "/job"], component: Stories },
    { path: "/stories/:id", component: Story },
    { path: "/users/:id", component: User }
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
