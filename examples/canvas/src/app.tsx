// The app root. One screen and nowhere to navigate, so there is no router:
// the canvas under this tab's identity.
import { Errored } from "solid-js";
import { IdentityProvider } from "~/identity";
import CanvasScreen from "~/canvas";
import "./app.css";

export default function App() {
  return (
    <Errored
      fallback={(err, reset) => (
        <div class="app-error">
          <p>Something went wrong: {String(err())}</p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    >
      <IdentityProvider>
        <CanvasScreen />
      </IdentityProvider>
    </Errored>
  );
}
