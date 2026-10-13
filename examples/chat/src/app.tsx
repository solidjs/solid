// The app's frame. The router owns navigation; each route is a conversation.
import { Errored, Loading } from "solid-js";
import { dynamicComponent } from "@solidjs/web";
import { getThreads, Router } from "~/router";
import "./app.css";

export default function App() {
  return (
    <Router>
      {props => {
        const Threads = dynamicComponent(() => getThreads());
        return (
          <Errored
            fallback={(err, reset) => (
              <div class="app-error">
                <p>Something went wrong: {String(err())}</p>
                <button onClick={reset}>Reset</button>
              </div>
            )}
          >
            <div class="app">
              <nav class="sidebar">
                <a class="new-chat" href="/">
                  New chat
                </a>
                <Loading>
                  <Threads />
                </Loading>
              </nav>
              <main class="main">
                <Loading fallback={<p class="muted">Loading…</p>}>{props.children}</Loading>
              </main>
            </div>
          </Errored>
        );
      }}
    </Router>
  );
}
