import { useContext, lazy } from "solid-js";
import { Link, RouteHOC, RouterContext } from "../router";
// import stub as main package to allowing fetch as you load
import Profile from "./Profile";

const Home = lazy(() => import("./Home"));
const Settings = lazy(() => import("./Settings"));

const App = RouteHOC(() => {
  const [, pending, { matches }] = useContext(RouterContext);
  return (
    <>
      <ul class="inline">
        <li classList={{ selected: matches("index") }}>
          <Link path="">Home</Link>
        </li>
        <li classList={{ selected: matches("profile") }}>
          <Link path="profile">Profile</Link>
        </li>
        <li classList={{ selected: matches("settings") }}>
          <Link path="settings">Settings</Link>
        </li>
      </ul>
      <div class="tab" classList={{"pending": pending()}}>
        <Suspense fallback={<span class="loader" style={"opacity: 0"}>Loading...</span>}>
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
        </Suspense>
      </div>
    </>
  );
});

export default App;
