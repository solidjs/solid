// `app: compiled CSR`: app.jsx rendered fresh, compiled in client DOM mode
// (`generate: "dom"`, not hydratable) — a plain SPA build.
import { render } from "@solidjs/web";
import App from "./app.jsx";

render(() => <App />, document.getElementById("app"));
