import { useContext, lazy, ErrorBoundary } from "solid-js";
import { HydrationScript } from "@solidjs/web";
import { Link, RouteHOC, RouterContext } from "../router";
// import stub as main package to allowing fetch as you load
import Profile from "./Profile";
import Home from "./Home";

// const Home = lazy(() => import("./Home"));
const Settings = lazy(() => import("./Settings"));

const App = RouteHOC(() => {
  const [, pending, { matches }] = useContext(RouterContext);
  return (
    <html lang="en">
      <head>
        <title>🔥 Solid SSR 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        <HydrationScript />
      </head>
      <body>
        <div id="app">
          <ul class="inline">
            <li class={{ selected: matches("index") }}>
              <Link path="">Home</Link>
            </li>
            <li class={{ selected: matches("profile") }}>
              <Link path="profile">Profile</Link>
            </li>
            <li class={{ selected: matches("settings") }}>
              <Link path="settings">Settings</Link>
            </li>
          </ul>
          <div class={["tab", { pending: pending() }]}>
            <Switch>
              <Match when={matches("index")}>
                <Home />
              </Match>
              <Match when={matches("profile")}>
                <Profile />
              </Match>
              <Match when={matches("settings")}>
                <Settings />
              </Match>
            </Switch>
          </div>
        </div>
      </body>
      <script type="module" src="/js/index.js" async></script>
    </html>
  );
});

export default App;
