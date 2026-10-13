// The app's frame. The router owns navigation; each route is a conversation.
import { Errored, Loading } from "solid-js";
import { Router } from "~/router";
import "./app.css";

export default function App() {
  return (
    <Router>
      {props => (
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
            </nav>
            <main class="main">
              <Loading fallback={<p class="muted">Loading…</p>}>{props.children}</Loading>
            </main>
          </div>
        </Errored>
      )}
    </Router>
  );
}
