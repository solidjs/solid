// `app: compiled hydrating`: the same app.jsx entered through hydrate(),
// compiled hydratable — what the client half of an SSR build ships. The
// delta against the CSR scenario is hydration's cost on a compiled app:
// the runtime's walk helpers plus the compiled output's own growth.
import { hydrate } from "@solidjs/web";
import App from "./app.jsx";

hydrate(() => <App />, document.getElementById("app"));
