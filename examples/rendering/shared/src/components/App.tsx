import { isPending, lazy, Match, Switch } from "solid-js";
import { Link, RouteHOC, useRouter } from "../router";
import Profile from "./Profile";

// vite-plugin-solid's lazy() module-URL pass keys these against the client
// manifest automatically — no hand-written module keys needed.
const Home = lazy(() => import("./Home"));
const Settings = lazy(() => import("./Settings"));
const Stream = lazy(() => import("./Stream"));
const ErrorStream = lazy(() => import("./ErrorStream"));
const RevealPage = lazy(() => import("./Reveal"));
const Skeleton = lazy(() => import("./Skeleton"));

const App = RouteHOC(() => {
  const [location, { matches }] = useRouter();

  return (
    <>
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
        <li class={{ selected: matches("reveal") }}>
          <Link path="reveal">Reveal</Link>
        </li>
        <li class={{ selected: matches("skeleton") }}>
          <Link path="skeleton">Skeleton</Link>
        </li>
      </ul>
      <div class={["tab", { pending: isPending(location) }]}>
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
          <Match when={matches("reveal")}>
            <RevealPage />
          </Match>
          <Match when={matches("skeleton")}>
            <Skeleton />
          </Match>
        </Switch>
      </div>
    </>
  );
});

export default App;
