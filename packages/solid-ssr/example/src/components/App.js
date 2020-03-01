import { useContext, lazy } from "solid-js";
import { Link, RouteHOC, RouterContext } from "../router";

const Home = lazy(() => import("./Home"));
const Profile = lazy(() => import("./Profile"));
const Settings = lazy(() => import("./Settings"));

const App = RouteHOC(() => {
  const [, { matches }] = useContext(RouterContext);
  return (
    <>
      <ul class="inline">
        <li classList={{ selected: matches("home") }}>
          <Link path="home">Home</Link>
        </li>
        <li classList={{ selected: matches("profile") }}>
          <Link path="profile">Profile</Link>
        </li>
        <li classList={{ selected: matches("settings") }}>
          <Link path="settings">Settings</Link>
        </li>
      </ul>
      <div class="tab">
        <Suspense fallback="Loading...">
          <Switch>
            <Match when={matches("home")}>
              <Home />
            </Match>
            <Match when={matches("profile")}>
              <Profile />
            </Match>
            <Match when={matches("settings")}>
              <Settings />
            </Match>
          </Switch>
        </Suspense>
      </div>
    </>
  );
});

export default App;
