import { useContext, isPending, lazy } from "solid-js";
import { HydrationScript } from "@solidjs/web";
import { Link, RouteHOC, RouterContext } from "../router";
import Profile from "./Profile";

const Home = lazy(() => import("./Home"), "./Home");
const Settings = lazy(() => import("./Settings"), "./Settings");
const Stream = lazy(() => import("./Stream"), "./Stream");
const ErrorStream = lazy(() => import("./ErrorStream"), "./ErrorStream");

const App = RouteHOC(() => {
  const [location, { matches }] = useContext(RouterContext);
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
            <li class={{ selected: matches("stream") }}>
              <Link path="stream">Stream</Link>
            </li>
            <li class={{ selected: matches("error-stream") }}>
              <Link path="error-stream">Error Stream</Link>
            </li>
          </ul>
          <div class={["tab", { pending: isPending(location) }]}>
            <Loading fallback={<span class="loader">Loading...</span>}>
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
                <Match when={matches("stream")}>
                  <Stream />
                </Match>
                <Match when={matches("error-stream")}>
                  <ErrorStream />
                </Match>
              </Switch>
            </Loading>
          </div>
        </div>
      </body>
      <script type="module" src="/js/index.js" async></script>
    </html>
  );
});

export default App;
