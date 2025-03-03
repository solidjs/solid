import { hydrate } from "@solidjs/web";
import App from "./components/App";

// entry point for browser
hydrate(() => <App />, document);
