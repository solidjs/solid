// The app root. One screen and nowhere to navigate, so there is no router:
// the canvas under this tab's identity.
import { Errored, onCleanup } from "solid-js";
import { IdentityProvider } from "~/identity";
import CanvasScreen from "~/canvas";
import "./app.css";

export default function App() {
  return (
    <Errored
      fallback={(err, reset) => {
        // The server's cap (server.js): a full room says when to come back,
        // and coming back is loading the page again, as a new tab would.
        const full = (err() as { status?: number })?.status === 503;
        if (full) {
          const wait = (err() as { retryAfter?: number }).retryAfter ?? 15;
          const timer = setTimeout(() => location.reload(), wait * 1000);
          onCleanup(() => clearTimeout(timer));
          return (
            <div class="app-error" role="status">
              <p>The room is full right now. Trying again in {wait} seconds…</p>
              <button onClick={() => location.reload()}>Try now</button>
            </div>
          );
        }
        return (
          <div class="app-error">
            <p>Something went wrong: {String(err())}</p>
            <button onClick={reset}>Reset</button>
          </div>
        );
      }}
    >
      <IdentityProvider>
        <CanvasScreen />
      </IdentityProvider>
    </Errored>
  );
}
